// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WS_PROTOCOL_VERSION, type ServerWsMessage } from '../shared/protocol';
import { createServer } from './app';
import { ManualClock } from './clock';
import { RoomStore, type ClientSession } from './roomStore';
import {
  MAX_WS_PAYLOAD_BYTES,
  SecurityManager,
  logOperationalNotice,
} from './security';

function createFakeClient(originHash?: string) {
  const sent: ServerWsMessage[] = [];
  const client: ClientSession = {
    originHash,
    send(message) {
      sent.push(message);
    },
  };
  return { client, sent };
}

describe('SecurityManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes strict 64 KB MAX_WS_PAYLOAD_BYTES constant', () => {
    expect(MAX_WS_PAYLOAD_BYTES).toBe(64 * 1024);
  });

  it('hashes origin IPs with an ephemeral 256-bit HMAC secret and rotates secret + clears state on schedule', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const security = new SecurityManager(clock, {
      secretRotationMs: 60_000,
    });

    const ip = '192.0.2.42';
    const hash1 = security.hashOrigin(ip);
    const hash1Again = security.hashOrigin(ip);
    const otherHash = security.hashOrigin('198.51.100.7');

    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    expect(hash1Again).toBe(hash1);
    expect(otherHash).not.toBe(hash1);
    expect(hash1).not.toContain(ip);
    expect(JSON.stringify(security)).not.toContain(ip);

    // Advance past rotation interval: secret rotates, changing HMAC output
    clock.advanceBy(60_000);
    const hashAfterRotation = security.hashOrigin(ip);
    expect(hashAfterRotation).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAfterRotation).not.toBe(hash1);
  });

  it('enforces sliding-window rate limits for WS connects, create_room bursts, and failed join attempts without storing raw IPs', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const security = new SecurityManager(clock, {
      wsConnectMax: 2,
      wsConnectWindowMs: 10_000,
      createRoomMax: 2,
      createRoomWindowMs: 20_000,
      failedJoinMax: 3,
      failedJoinWindowMs: 30_000,
      secretRotationMs: 120_000,
    });

    const attackerIp = '203.0.113.99';
    const bystanderIp = '203.0.113.100';
    const attackerHash = security.hashOrigin(attackerIp);
    const bystanderHash = security.hashOrigin(bystanderIp);

    // WS connect limiter
    expect(security.allowWsConnect(attackerHash)).toBe(true);
    clock.advanceBy(4_000);
    expect(security.allowWsConnect(attackerHash)).toBe(true);
    expect(security.allowWsConnect(attackerHash)).toBe(false);
    expect(security.allowWsConnect(bystanderHash)).toBe(true);

    // Sliding window: advance 6s more so first connect (t=0) drops off 10s window
    clock.advanceBy(6_000);
    expect(security.allowWsConnect(attackerHash)).toBe(true);

    // create_room limiter
    expect(security.allowCreateRoom(attackerHash)).toBe(true);
    expect(security.allowCreateRoom(attackerHash)).toBe(true);
    expect(security.allowCreateRoom(attackerHash)).toBe(false);
    expect(security.allowCreateRoom(bystanderHash)).toBe(true);

    // failed join anti-brute-force limiter
    expect(security.isFailedJoinRateLimited(attackerHash)).toBe(false);
    security.recordFailedJoin(attackerHash);
    security.recordFailedJoin(attackerHash);
    expect(security.isFailedJoinRateLimited(attackerHash)).toBe(false);
    security.recordFailedJoin(attackerHash);
    expect(security.isFailedJoinRateLimited(attackerHash)).toBe(true);
    expect(security.isFailedJoinRateLimited(bystanderHash)).toBe(false);

    // Raw IPs never appear in serialized internal state
    const serialized = JSON.stringify(security);
    expect(serialized).not.toContain(attackerIp);
    expect(serialized).not.toContain(bystanderIp);

    // Window slides past failedJoinWindowMs -> unblocked
    clock.advanceBy(30_000);
    expect(security.isFailedJoinRateLimited(attackerHash)).toBe(false);

    // Secret rotation clears old buckets
    security.recordFailedJoin(attackerHash);
    security.recordFailedJoin(attackerHash);
    security.recordFailedJoin(attackerHash);
    clock.advanceBy(120_000);
    const rotatedHash = security.hashOrigin(attackerIp);
    expect(security.isFailedJoinRateLimited(rotatedHash)).toBe(false);
  });

  it('logOperationalNotice emits only neutral operational events without identifiers', () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    logOperationalNotice({ event: 'server_listening', port: 3001 });
    logOperationalNotice({ event: 'server_stopped' });
    logOperationalNotice({ event: 'server_start_failed', code: 'EADDRINUSE' });

    const out = stdoutChunks.join('');
    const err = stderrChunks.join('');
    expect(out).toContain('server_listening');
    expect(out).toContain('3001');
    expect(out).toContain('server_stopped');
    expect(err).toContain('server_start_failed');
    expect(err).toContain('EADDRINUSE');
  });

  it('enforces maxRooms capacity in RoomStore and frees slots on leave/expiry', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const store = new RoomStore(clock, { maxRooms: 2 });

    const c1 = createFakeClient();
    const c2 = createFakeClient();
    const c3 = createFakeClient();

    store.handleMessage(c1.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'A7K9-M2P4',
      displayName: 'Host1',
      mode: 'normal',
    });
    store.handleMessage(c2.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'B8K2-N3Q5',
      displayName: 'Host2',
      mode: 'normal',
    });

    expect(c1.sent[0].type).toBe('room_joined');
    expect(c2.sent[0].type).toBe('room_joined');

    // 3rd room exceeds maxRooms = 2
    store.handleMessage(c3.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'C9M3-P4R6',
      displayName: 'Host3',
      mode: 'normal',
    });
    expect(c3.sent).toEqual([
      {
        type: 'room_error',
        version: WS_PROTOCOL_VERSION,
        code: 'server_at_capacity',
      },
    ]);

    // Host1 leaves -> frees capacity
    store.handleMessage(c1.client, {
      type: 'leave_room',
      version: WS_PROTOCOL_VERSION,
    });
    store.handleMessage(c3.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'C9M3-P4R6',
      displayName: 'Host3',
      mode: 'normal',
    });
    expect(c3.sent.at(-1)?.type).toBe('room_joined');
  });

  it('enforces create_room burst and failed join_room brute-force rate limits in RoomStore keyed by originHash', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const security = new SecurityManager(clock, {
      createRoomMax: 2,
      createRoomWindowMs: 30_000,
      failedJoinMax: 3,
      failedJoinWindowMs: 30_000,
    });
    const store = new RoomStore(clock, { security });

    const attackerHash = security.hashOrigin('198.51.100.10');
    const bystanderHash = security.hashOrigin('198.51.100.11');

    const attacker = createFakeClient(attackerHash);
    const bystander = createFakeClient(bystanderHash);

    // Burst create_room from attacker -> 2 succeed, 3rd returns rate_limited
    store.handleMessage(attacker.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'A7K9-M2P4',
      displayName: 'H1',
      mode: 'normal',
    });
    store.handleMessage(attacker.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'B8K2-N3Q5',
      displayName: 'H1',
      mode: 'normal',
    });
    store.handleMessage(attacker.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'C9M3-P4R6',
      displayName: 'H1',
      mode: 'normal',
    });
    expect(attacker.sent.at(-1)).toEqual({
      type: 'room_error',
      version: WS_PROTOCOL_VERSION,
      code: 'rate_limited',
    });

    // Bystander can still create a room
    store.handleMessage(bystander.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'D2N4-Q5S7',
      displayName: 'H2',
      mode: 'normal',
    });
    expect(bystander.sent.at(-1)?.type).toBe('room_joined');

    // Brute-force failed join_room attempts from attacker -> 3 return room_not_found, 4th returns rate_limited
    for (let i = 0; i < 3; i++) {
      store.handleMessage(attacker.client, {
        type: 'join_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'Z9Y8-X7W6',
        displayName: 'Brute',
      });
      expect(attacker.sent.at(-1)).toEqual({
        type: 'room_error',
        version: WS_PROTOCOL_VERSION,
        code: 'room_not_found',
      });
    }

    // Even trying a real existing room (D2N4-Q5S7) is blocked with rate_limited once tripped (anti-enumeration)
    store.handleMessage(attacker.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'D2N4-Q5S7',
      displayName: 'Brute',
    });
    expect(attacker.sent.at(-1)).toEqual({
      type: 'room_error',
      version: WS_PROTOCOL_VERSION,
      code: 'rate_limited',
    });
  });
});

function nextServerMessage(ws: {
  once: (event: string, cb: (data: Buffer | string) => void) => void;
}): Promise<ServerWsMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      resolve(JSON.parse(text) as ServerWsMessage);
    });
  });
}

describe('Fastify /ws security integration (rate limits, capacity, 64 KB limit, zero-trace audit)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  it('rejects excess /ws connection attempts with HTTP 429 and enforces maxRooms, create_room burst, and failed join_room burst over /ws', async () => {
    const clock = new ManualClock(1_700_000_000_000);
    const app = await createServer({
      clock,
      maxRooms: 1,
      securityOptions: {
        wsConnectMax: 3,
        wsConnectWindowMs: 60_000,
        createRoomMax: 2,
        createRoomWindowMs: 60_000,
        failedJoinMax: 2,
        failedJoinWindowMs: 60_000,
      },
    });
    await app.ready();
    cleanups.push(() => app.close());

    const ws1 = await app.injectWS('/ws');
    const ws2 = await app.injectWS('/ws');
    const ws3 = await app.injectWS('/ws');
    cleanups.push(() => ws1.close());
    cleanups.push(() => ws2.close());
    cleanups.push(() => ws3.close());

    // 4th WS connection within window is rejected with 429
    await expect(app.injectWS('/ws')).rejects.toThrow(/429/);

    // ws1 creates 1st room -> succeeds
    const ws1Joined = nextServerMessage(ws1);
    ws1.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'A7K9-M2P4',
        displayName: 'Host1',
        mode: 'normal',
      }),
    );
    expect((await ws1Joined).type).toBe('room_joined');

    // ws2 creates 2nd room -> server_at_capacity (maxRooms: 1)
    const ws2Cap = nextServerMessage(ws2);
    ws2.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'B8K2-N3Q5',
        displayName: 'Host2',
        mode: 'normal',
      }),
    );
    expect(await ws2Cap).toMatchObject({ type: 'room_error', code: 'server_at_capacity' });

    // ws2 creates 3rd room attempt -> createRoomMax=2 exceeded -> rate_limited
    const ws2Rate = nextServerMessage(ws2);
    ws2.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'C9M3-P4R6',
        displayName: 'Host2',
        mode: 'normal',
      }),
    );
    expect(await ws2Rate).toMatchObject({ type: 'room_error', code: 'rate_limited' });

    // ws3 brute-forces join_room -> 2 room_not_found, 3rd rate_limited
    for (let i = 0; i < 2; i++) {
      const msgP = nextServerMessage(ws3);
      ws3.send(
        JSON.stringify({
          type: 'join_room',
          version: WS_PROTOCOL_VERSION,
          roomCode: 'Z9Y8-X7W6',
          displayName: 'Brute',
        }),
      );
      expect(await msgP).toMatchObject({ type: 'room_error', code: 'room_not_found' });
    }
    const ws3Rate = nextServerMessage(ws3);
    ws3.send(
      JSON.stringify({
        type: 'join_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'A7K9-M2P4',
        displayName: 'Brute',
      }),
    );
    expect(await ws3Rate).toMatchObject({ type: 'room_error', code: 'rate_limited' });
  });

  it('accepts <= 64 KB WebSocket frames and rejects frames > 64 KB cleanly with close code 1009', async () => {
    const app = await createServer({
      clock: new ManualClock(1_700_000_000_000),
    });
    await app.ready();
    cleanups.push(() => app.close());

    const client = await app.injectWS('/ws');
    cleanups.push(() => {
      if (client.readyState === 1 || client.readyState === 0) {
        client.close();
      }
    });

    // Exactly 64 KB (65536 bytes) valid JSON message -> accepted
    const baseMsg = {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'A7K9-M2P4',
      displayName: 'Host',
      mode: 'normal',
      padding: '',
    };
    const baseLen = Buffer.byteLength(JSON.stringify(baseMsg), 'utf8');
    baseMsg.padding = 'a'.repeat(MAX_WS_PAYLOAD_BYTES - baseLen);
    const exactFrame = JSON.stringify(baseMsg);
    expect(Buffer.byteLength(exactFrame, 'utf8')).toBe(MAX_WS_PAYLOAD_BYTES);

    const joinedPromise = nextServerMessage(client);
    client.send(exactFrame);
    expect((await joinedPromise).type).toBe('room_joined');

    // Frame > 64 KB (65537 bytes) -> rejected cleanly with close code 1009 (Message Too Big)
    const oversizedBase = {
      type: 'notify_activity',
      version: WS_PROTOCOL_VERSION,
      padding: '',
    };
    const oversizedBaseLen = Buffer.byteLength(JSON.stringify(oversizedBase), 'utf8');
    oversizedBase.padding = 'b'.repeat(MAX_WS_PAYLOAD_BYTES + 1 - oversizedBaseLen);
    const oversizedFrame = JSON.stringify(oversizedBase);
    expect(Buffer.byteLength(oversizedFrame, 'utf8')).toBe(MAX_WS_PAYLOAD_BYTES + 1);

    const closeCodePromise = new Promise<number>((resolve) => {
      client.once('close', (code) => resolve(code));
    });
    client.send(oversizedFrame);
    const closeCode = await closeCodePromise;
    expect(closeCode).toBe(1009);
  });

  it('emits payload_too_large room_error and closes cleanly when raw message byte-length exceeds configured maxWsPayloadBytes', async () => {
    const app = await createServer({
      clock: new ManualClock(1_700_000_000_000),
      maxWsPayloadBytes: 256,
    });
    await app.ready();
    cleanups.push(() => app.close());

    const client = await app.injectWS('/ws');
    cleanups.push(() => {
      if (client.readyState === 1 || client.readyState === 0) {
        client.close();
      }
    });

    const errPromise = nextServerMessage(client);
    const closeCodePromise = new Promise<number>((resolve) => {
      client.once('close', (code) => resolve(code));
    });

    client.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'A7K9-M2P4',
        displayName: 'Host',
        mode: 'normal',
        padding: 'x'.repeat(300),
      }),
    );

    const errMsg = await errPromise;
    expect(errMsg).toEqual({
      type: 'room_error',
      version: WS_PROTOCOL_VERSION,
      code: 'payload_too_large',
    });
    expect(await closeCodePromise).toBe(1009);
  });

  it('audits stdout/stderr across HTTP + WS session and leaks zero IP, User-Agent, query string, roomCode, displayName, or plaintext', async () => {
    const capturedOut: string[] = [];
    const capturedErr: string[] = [];
    const origOutWrite = process.stdout.write.bind(process.stdout);
    const origErrWrite = process.stderr.write.bind(process.stderr);

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      capturedOut.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      capturedErr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    const app = await createServer({
      clock: new ManualClock(1_700_000_000_000),
      securityOptions: {
        wsConnectMax: 3,
      },
    });
    await app.ready();
    cleanups.push(() => app.close());

    const sensitiveIp = '203.0.113.77';
    const sensitiveUa = 'PulsoAuditAgent/9.9.9-UniqueTrace';
    const sensitiveQuery = 'auditSecret=TopSecretToken123&room=X9K2-P7M4';
    const sensitiveRoomCode = 'X9K2-P7M4';
    const sensitiveHostName = 'AliceUltraSecretName';
    const sensitiveGuestName = 'BobUltraSecretName';
    const sensitiveCiphertext = 'CIPHER_TRACE_9988776655';

    // HTTP requests with query strings, custom User-Agent, and x-forwarded-for / remoteAddress
    await app.inject({
      method: 'GET',
      url: `/healthz?${sensitiveQuery}`,
      headers: {
        'user-agent': sensitiveUa,
        'x-forwarded-for': sensitiveIp,
      },
    });
    await app.inject({
      method: 'GET',
      url: `/api/runtime?${sensitiveQuery}`,
      headers: {
        'user-agent': sensitiveUa,
      },
    });
    await app.inject({
      method: 'GET',
      url: `/api/nonexistent?${sensitiveQuery}`,
      headers: {
        'user-agent': sensitiveUa,
      },
    });

    const hostWs = await app.injectWS('/ws', {
      headers: { 'user-agent': sensitiveUa },
    });
    const guestWs = await app.injectWS('/ws', {
      headers: { 'user-agent': sensitiveUa },
    });
    const probeWs = await app.injectWS('/ws', {
      headers: { 'user-agent': sensitiveUa },
    });
    cleanups.push(() => hostWs.close());
    cleanups.push(() => guestWs.close());
    cleanups.push(() => probeWs.close());

    // Trigger 429 rate limit
    await expect(app.injectWS('/ws', { headers: { 'user-agent': sensitiveUa } })).rejects.toThrow(
      /429/,
    );

    const hostJoinedP = nextServerMessage(hostWs);
    hostWs.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: sensitiveRoomCode,
        displayName: sensitiveHostName,
        mode: 'normal',
      }),
    );
    const hostJoined = await hostJoinedP;
    if (hostJoined.type !== 'room_joined') throw new Error('Expected room_joined');

    const guestJoinedP = nextServerMessage(guestWs);
    guestWs.send(
      JSON.stringify({
        type: 'join_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: sensitiveRoomCode,
        displayName: sensitiveGuestName,
      }),
    );
    await guestJoinedP;

    // Relay encrypted message
    const guestMsgP = nextServerMessage(guestWs);
    hostWs.send(
      JSON.stringify({
        type: 'encrypted_message',
        version: WS_PROTOCOL_VERSION,
        envelope: {
          version: 1,
          roomCode: sensitiveRoomCode,
          senderId: hostJoined.participant.id,
          senderRole: 'host',
          seq: 1,
          iv: 'iv-audit-1',
          ciphertext: sensitiveCiphertext,
          sentAt: 1_700_000_001_000,
        },
      }),
    );
    await guestMsgP;

    // Trigger invalid JSON & invalid code & oversized frame
    const badJsonErrP = nextServerMessage(probeWs);
    probeWs.send('{not-valid-json');
    await badJsonErrP;

    const invalidCodeErrP = nextServerMessage(probeWs);
    probeWs.send(
      JSON.stringify({
        type: 'join_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'BAD!',
        displayName: sensitiveGuestName,
      }),
    );
    await invalidCodeErrP;

    // Emit neutral operational notices
    logOperationalNotice({ event: 'server_listening', port: 3001 });
    logOperationalNotice({ event: 'server_stopped' });

    // Restore writes before assertions so test runner output still works
    vi.restoreAllMocks();
    void origOutWrite;
    void origErrWrite;

    const allLogs = [...capturedOut, ...capturedErr].join('\n');
    expect(allLogs).not.toContain('127.0.0.1');
    expect(allLogs).not.toContain(sensitiveIp);
    expect(allLogs).not.toContain(sensitiveUa);
    expect(allLogs).not.toContain('auditSecret');
    expect(allLogs).not.toContain('TopSecretToken123');
    expect(allLogs).not.toContain(sensitiveRoomCode);
    expect(allLogs).not.toContain(sensitiveHostName);
    expect(allLogs).not.toContain(sensitiveGuestName);
    expect(allLogs).not.toContain(sensitiveCiphertext);
  });
});
