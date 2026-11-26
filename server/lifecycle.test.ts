// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { WS_PROTOCOL_VERSION, type ServerWsMessage } from '../shared/protocol';
import { createServer } from './app';
import { ManualClock } from './clock';
import { RoomStore, type ClientSession } from './roomStore';

function createFakeClient() {
  const sent: ServerWsMessage[] = [];
  let closed = false;
  const client: ClientSession = {
    send(message) {
      sent.push(message);
    },
    close() {
      closed = true;
    },
  };
  return {
    client,
    sent,
    isClosed: () => closed,
  };
}

describe('RoomStore lifecycle: authoritative inactivity timer & 24h hard TTL', () => {
  it('expires room by inactivity after 60m, closes sockets, and purges room from RAM', () => {
    const start = 1_700_000_000_000;
    const clock = new ManualClock(start);
    const store = new RoomStore(clock);

    const host = createFakeClient();
    const guest = createFakeClient();

    store.handleMessage(host.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'X9K2-P7M4',
      displayName: 'Ana',
      mode: 'normal',
    });

    const hostJoined = host.sent[0];
    expect(hostJoined).toMatchObject({
      type: 'room_joined',
      expiresAt: start + 60 * 60 * 1000,
    });

    store.handleMessage(guest.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'X9K2-P7M4',
      displayName: 'João',
    });

    // Advance 59m59s -> still active
    clock.advanceBy(60 * 60 * 1000 - 1000);
    expect(host.sent.some((m) => m.type === 'room_expired')).toBe(false);
    expect(host.isClosed()).toBe(false);

    // Advance final 1s -> expires with reason: 'inactivity'
    clock.advanceBy(1000);
    expect(host.sent.at(-1)).toEqual({
      type: 'room_expired',
      version: WS_PROTOCOL_VERSION,
      reason: 'inactivity',
    });
    expect(guest.sent.at(-1)).toEqual({
      type: 'room_expired',
      version: WS_PROTOCOL_VERSION,
      reason: 'inactivity',
    });
    expect(host.isClosed()).toBe(true);
    expect(guest.isClosed()).toBe(true);

    // Room is purged from RAM
    const latecomer = createFakeClient();
    store.handleMessage(latecomer.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'X9K2-P7M4',
      displayName: 'Maria',
    });
    expect(latecomer.sent).toEqual([
      { type: 'room_error', version: WS_PROTOCOL_VERSION, code: 'room_not_found' },
    ]);
  });

  it('recalculates expiresAt and broadcasts activity_reset on join_room, encrypted_message, and notify_activity', () => {
    const start = 1_700_000_000_000;
    const clock = new ManualClock(start);
    const store = new RoomStore(clock, { inactivityDurationMs: 60 * 60 * 1000 });

    const host = createFakeClient();
    const guest = createFakeClient();

    store.handleMessage(host.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'A7K9-M2P4',
      displayName: 'Ana',
      mode: 'normal',
    });

    // Advance 10m before guest joins
    clock.advanceBy(10 * 60 * 1000);
    store.handleMessage(guest.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'A7K9-M2P4',
      displayName: 'João',
    });

    const expectedAfterJoin = clock.now() + 60 * 60 * 1000;
    expect(host.sent.some((m) => m.type === 'activity_reset' && m.expiresAt === expectedAfterJoin)).toBe(true);
    expect(guest.sent[0]).toMatchObject({
      type: 'room_joined',
      expiresAt: expectedAfterJoin,
    });

    // Advance 30m -> send encrypted_message -> resets sliding window
    clock.advanceBy(30 * 60 * 1000);
    store.handleMessage(host.client, {
      type: 'encrypted_message',
      version: WS_PROTOCOL_VERSION,
      envelope: {
        version: 1,
        roomCode: 'A7K9-M2P4',
        senderId: 'ignored',
        senderRole: 'host',
        seq: 1,
        iv: 'iv-1',
        ciphertext: 'cipher-1',
        sentAt: clock.now(),
      },
    });

    const expectedAfterMsg = clock.now() + 60 * 60 * 1000;
    expect(host.sent.at(-1)).toEqual({
      type: 'activity_reset',
      version: WS_PROTOCOL_VERSION,
      expiresAt: expectedAfterMsg,
    });
    expect(guest.sent.at(-1)).toEqual({
      type: 'activity_reset',
      version: WS_PROTOCOL_VERSION,
      expiresAt: expectedAfterMsg,
    });

    // Advance 45m -> original 60m would have expired, but message reset kept it alive; send notify_activity
    clock.advanceBy(45 * 60 * 1000);
    expect(host.sent.some((m) => m.type === 'room_expired')).toBe(false);

    store.handleMessage(guest.client, {
      type: 'notify_activity',
      version: WS_PROTOCOL_VERSION,
    });
    const expectedAfterNotify = clock.now() + 60 * 60 * 1000;
    expect(host.sent.at(-1)).toEqual({
      type: 'activity_reset',
      version: WS_PROTOCOL_VERSION,
      expiresAt: expectedAfterNotify,
    });
    expect(guest.sent.at(-1)).toEqual({
      type: 'activity_reset',
      version: WS_PROTOCOL_VERSION,
      expiresAt: expectedAfterNotify,
    });

    // Advance 60m with no more activity -> expires
    clock.advanceBy(60 * 60 * 1000);
    expect(host.sent.at(-1)).toEqual({
      type: 'room_expired',
      version: WS_PROTOCOL_VERSION,
      reason: 'inactivity',
    });
  });

  it('enforces 24h hard TTL ceiling even with continuous activity and emits reason hard_ttl', () => {
    const start = 1_700_000_000_000;
    const clock = new ManualClock(start);
    const store = new RoomStore(clock);

    const host = createFakeClient();
    const guest = createFakeClient();

    store.handleMessage(host.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'H4RD-24HR',
      displayName: 'Ana',
      mode: 'normal',
    });
    store.handleMessage(guest.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'H4RD-24HR',
      displayName: 'João',
    });

    // Keep room active every 45m until 23h15m
    for (let i = 0; i < 31; i += 1) {
      clock.advanceBy(45 * 60 * 1000);
      store.handleMessage(host.client, {
        type: 'notify_activity',
        version: WS_PROTOCOL_VERSION,
      });
    }
    // 31 * 45m = 1395m = 23h15m
    const hardExpiresAt = start + 24 * 60 * 60 * 1000;
    expect(clock.now()).toBe(start + 23 * 60 * 60 * 1000 + 15 * 60 * 1000);
    expect(host.sent.some((m) => m.type === 'room_expired')).toBe(false);

    // Advance 15m to 23h30m and send activity -> expiresAt must be capped at 24h hardExpiresAt
    clock.advanceBy(15 * 60 * 1000);
    store.handleMessage(guest.client, {
      type: 'notify_activity',
      version: WS_PROTOCOL_VERSION,
    });
    expect(host.sent.at(-1)).toEqual({
      type: 'activity_reset',
      version: WS_PROTOCOL_VERSION,
      expiresAt: hardExpiresAt,
    });

    // Advance 29m59s -> still alive
    clock.advanceBy(30 * 60 * 1000 - 1000);
    expect(host.sent.some((m) => m.type === 'room_expired')).toBe(false);

    // Advance final 1s -> hits 24h hard TTL ceiling
    clock.advanceBy(1000);
    expect(host.sent.at(-1)).toEqual({
      type: 'room_expired',
      version: WS_PROTOCOL_VERSION,
      reason: 'hard_ttl',
    });
    expect(guest.sent.at(-1)).toEqual({
      type: 'room_expired',
      version: WS_PROTOCOL_VERSION,
      reason: 'hard_ttl',
    });
    expect(host.isClosed()).toBe(true);
    expect(guest.isClosed()).toBe(true);
  });

  it('respects PULSO_INACTIVITY_MS environment configuration', () => {
    const prev = process.env.PULSO_INACTIVITY_MS;
    process.env.PULSO_INACTIVITY_MS = '120000';
    try {
      const start = 1_700_000_000_000;
      const clock = new ManualClock(start);
      const store = new RoomStore(clock);
      const host = createFakeClient();

      store.handleMessage(host.client, {
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'ENV2-2345',
        displayName: 'Ana',
        mode: 'normal',
      });

      expect(host.sent[0]).toMatchObject({
        type: 'room_joined',
        expiresAt: start + 120_000,
      });

      clock.advanceBy(120_000);
      expect(host.sent.at(-1)).toEqual({
        type: 'room_expired',
        version: WS_PROTOCOL_VERSION,
        reason: 'inactivity',
      });
    } finally {
      if (prev === undefined) {
        delete process.env.PULSO_INACTIVITY_MS;
      } else {
        process.env.PULSO_INACTIVITY_MS = prev;
      }
    }
  });
});

describe('RoomStore lifecycle: explicit leave vs 30s grace window & reconnect_room', () => {
  it('frees only guest slot on guest leave_room so a 2nd guest can join with fresh ECDH, and purges immediately with host_left when host leaves', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const store = new RoomStore(clock);

    const host = createFakeClient();
    const guest1 = createFakeClient();
    const guest2 = createFakeClient();

    store.handleMessage(host.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'AV23-ABCD',
      displayName: 'Ana',
      mode: 'normal',
    });
    store.handleMessage(guest1.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'AV23-ABCD',
      displayName: 'João',
    });

    // Guest 1 leaves explicitly -> Host receives participant_left, room remains open
    store.handleMessage(guest1.client, {
      type: 'leave_room',
      version: WS_PROTOCOL_VERSION,
    });
    // Subsequent abrupt close of Guest 1 socket must not trigger grace timeout or duplicate event
    store.handleDisconnect(guest1.client);

    const leftMsg = host.sent.at(-1);
    expect(leftMsg).toMatchObject({
      type: 'participant_left',
      participants: [{ role: 'host', displayName: 'Ana', online: true }],
    });

    // Guest 2 joins and establishes fresh ECDH handshake
    store.handleMessage(guest2.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'AV23-ABCD',
      displayName: 'Maria',
    });
    expect(guest2.sent[0]).toMatchObject({
      type: 'room_joined',
      roomCode: 'AV23-ABCD',
      participant: { role: 'guest', displayName: 'Maria' },
    });

    store.handleMessage(guest2.client, {
      type: 'key_exchange',
      version: WS_PROTOCOL_VERSION,
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'new-x', y: 'new-y' },
      hasSecret: true,
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: 'key_exchange',
      publicKeyJwk: { x: 'new-x', y: 'new-y' },
    });

    // Host leaves explicitly -> room purged immediately, Guest 2 notified with reason: 'host_left' and socket closed
    store.handleMessage(host.client, {
      type: 'leave_room',
      version: WS_PROTOCOL_VERSION,
    });
    expect(guest2.sent.at(-1)).toEqual({
      type: 'room_expired',
      version: WS_PROTOCOL_VERSION,
      reason: 'host_left',
    });
    expect(guest2.isClosed()).toBe(true);
  });

  it('preserves slot during 30s grace window on abrupt disconnect and allows reconnect_room with sessionToken', () => {
    const start = 1_700_000_000_000;
    const clock = new ManualClock(start);
    const store = new RoomStore(clock, { graceWindowMs: 30_000 });

    const host = createFakeClient();
    const guest = createFakeClient();

    store.handleMessage(host.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'RC34-ABCD',
      displayName: 'Ana',
      mode: 'normal',
    });
    const hostJoined = host.sent[0];
    if (hostJoined.type !== 'room_joined' || !hostJoined.sessionToken) {
      throw new Error('Expected host sessionToken');
    }

    store.handleMessage(guest.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'RC34-ABCD',
      displayName: 'João',
    });
    const guestJoined = guest.sent[0];
    if (guestJoined.type !== 'room_joined' || !guestJoined.sessionToken) {
      throw new Error('Expected guest sessionToken');
    }

    // Guest drops abruptly at t=0
    store.handleDisconnect(guest.client);
    expect(host.sent.at(-1)).toEqual({
      type: 'reconnecting',
      version: WS_PROTOCOL_VERSION,
      participantId: guestJoined.participant.id,
    });

    // 3rd entrant still cannot steal the reserved guest slot during 30s grace window
    const intruder = createFakeClient();
    store.handleMessage(intruder.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'RC34-ABCD',
      displayName: 'Intruso',
    });
    expect(intruder.sent).toEqual([
      { type: 'room_error', version: WS_PROTOCOL_VERSION, code: 'room_full' },
    ]);

    // Wrong token is rejected
    const badReconnect = createFakeClient();
    store.handleMessage(badReconnect.client, {
      type: 'reconnect_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'RC34-ABCD',
      sessionToken: 'wrong-token',
    });
    expect(badReconnect.sent).toEqual([
      { type: 'room_error', version: WS_PROTOCOL_VERSION, code: 'room_not_found' },
    ]);

    // Guest reconnects at t=20s with valid sessionToken on a fresh socket
    clock.advanceBy(20_000);
    const guestReconnectedSocket = createFakeClient();
    store.handleMessage(guestReconnectedSocket.client, {
      type: 'reconnect_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'RC34-ABCD',
      sessionToken: guestJoined.sessionToken,
    });

    expect(guestReconnectedSocket.sent[0]).toMatchObject({
      type: 'reconnected',
      roomCode: 'RC34-ABCD',
      participant: { id: guestJoined.participant.id, role: 'guest', online: true },
      participants: [
        { id: hostJoined.participant.id, online: true },
        { id: guestJoined.participant.id, online: true },
      ],
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: 'participant_reconnected',
      participant: { id: guestJoined.participant.id, online: true },
    });

    // Advance past 30s from original disconnect -> grace timer was cancelled so guest stays connected
    clock.advanceBy(15_000);
    expect(host.sent.some((m) => m.type === 'participant_left')).toBe(false);

    // Encrypted traffic continues working over reattached socket
    store.handleMessage(guestReconnectedSocket.client, {
      type: 'encrypted_message',
      version: WS_PROTOCOL_VERSION,
      envelope: {
        version: 1,
        roomCode: 'RC34-ABCD',
        senderId: guestJoined.participant.id,
        senderRole: 'guest',
        seq: 2,
        iv: 'iv-2',
        ciphertext: 'after-reconnect',
        sentAt: clock.now(),
      },
    });
    expect(host.sent.some((m) => m.type === 'encrypted_message' && m.envelope.ciphertext === 'after-reconnect')).toBe(true);
  });

  it('removes guest and notifies host with participant_left when guest grace window expires after 30s', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const store = new RoomStore(clock, { graceWindowMs: 30_000 });
    const host = createFakeClient();
    const guest = createFakeClient();

    store.handleMessage(host.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'GR34-GUST',
      displayName: 'Ana',
      mode: 'normal',
    });
    store.handleMessage(guest.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'GR34-GUST',
      displayName: 'João',
    });
    const guestJoined = guest.sent[0];
    if (guestJoined.type !== 'room_joined' || !guestJoined.sessionToken) {
      throw new Error('Expected guest sessionToken');
    }

    store.handleDisconnect(guest.client);
    clock.advanceBy(29_999);
    expect(host.sent.some((m) => m.type === 'participant_left')).toBe(false);

    clock.advanceBy(1);
    expect(host.sent.at(-1)).toMatchObject({
      type: 'participant_left',
      participantId: guestJoined.participant.id,
      participants: [{ role: 'host', displayName: 'Ana', online: true }],
    });

    // Old guest sessionToken can no longer reconnect
    const lateGuest = createFakeClient();
    store.handleMessage(lateGuest.client, {
      type: 'reconnect_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'GR34-GUST',
      sessionToken: guestJoined.sessionToken,
    });
    expect(lateGuest.sent).toEqual([
      { type: 'room_error', version: WS_PROTOCOL_VERSION, code: 'room_not_found' },
    ]);

    // A new guest can now join
    const newGuest = createFakeClient();
    store.handleMessage(newGuest.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'GR34-GUST',
      displayName: 'Clara',
    });
    expect(newGuest.sent[0]).toMatchObject({ type: 'room_joined', roomCode: 'GR34-GUST' });
  });

  it('purges room with reason grace_timeout when host grace window expires or when both disconnect beyond 30s', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const store = new RoomStore(clock, { graceWindowMs: 30_000 });
    const host = createFakeClient();
    const guest = createFakeClient();

    store.handleMessage(host.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'GR34-H2ST',
      displayName: 'Ana',
      mode: 'normal',
    });
    store.handleMessage(guest.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'GR34-H2ST',
      displayName: 'João',
    });

    // Host drops abruptly -> guest stays connected until 30s expires
    store.handleDisconnect(host.client);
    clock.advanceBy(29_999);
    expect(guest.sent.some((m) => m.type === 'room_expired')).toBe(false);

    clock.advanceBy(1);
    expect(guest.sent.at(-1)).toEqual({
      type: 'room_expired',
      version: WS_PROTOCOL_VERSION,
      reason: 'grace_timeout',
    });
    expect(guest.isClosed()).toBe(true);

    // Room is completely purged
    const probe = createFakeClient();
    store.handleMessage(probe.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'GR34-H2ST',
      displayName: 'Probe',
    });
    expect(probe.sent).toEqual([
      { type: 'room_error', version: WS_PROTOCOL_VERSION, code: 'room_not_found' },
    ]);

    // Scenario 2: both disconnect abruptly -> room purged after 30s
    const host2 = createFakeClient();
    const guest2 = createFakeClient();
    store.handleMessage(host2.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'B2TH-G234',
      displayName: 'Ana',
      mode: 'normal',
    });
    store.handleMessage(guest2.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'B2TH-G234',
      displayName: 'João',
    });

    store.handleDisconnect(host2.client);
    clock.advanceBy(5_000);
    store.handleDisconnect(guest2.client);

    clock.advanceBy(25_000);
    // At t=30s host grace expired -> entire room purged
    const probe2 = createFakeClient();
    store.handleMessage(probe2.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'B2TH-G234',
      displayName: 'Probe',
    });
    expect(probe2.sent).toEqual([
      { type: 'room_error', version: WS_PROTOCOL_VERSION, code: 'room_not_found' },
    ]);
  });
});

function createWsReader(ws: { on: (event: string, cb: (data: Buffer) => void) => void }) {
  const queue: ServerWsMessage[] = [];
  const waiters: Array<(msg: ServerWsMessage) => void> = [];

  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString('utf8')) as ServerWsMessage;
    const waiter = waiters.shift();
    if (waiter) {
      waiter(parsed);
    } else {
      queue.push(parsed);
    }
  });

  return {
    next(): Promise<ServerWsMessage> {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
  };
}

describe('Fastify injectWS lifecycle integration with ManualClock', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  it('drives reconnect within 30s grace window and authoritative expiry over /ws via injectWS', async () => {
    const clock = new ManualClock(1_700_000_000_000);
    const app = await createServer({
      clock,
      graceWindowMs: 30_000,
    });
    await app.ready();
    cleanups.push(() => app.close());

    const hostWs = await app.injectWS('/ws');
    const guestWs1 = await app.injectWS('/ws');
    cleanups.push(() => hostWs.terminate());

    const hostReader = createWsReader(hostWs);
    const guest1Reader = createWsReader(guestWs1);

    hostWs.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'WS99-K2P4',
        displayName: 'Ana',
        mode: 'normal',
      }),
    );
    const hostJoined = await hostReader.next();
    expect(hostJoined.type).toBe('room_joined');

    guestWs1.send(
      JSON.stringify({
        type: 'join_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'WS99-K2P4',
        displayName: 'João',
      }),
    );
    const guestJoined = await guest1Reader.next();
    if (guestJoined.type !== 'room_joined' || !guestJoined.sessionToken) {
      throw new Error('Expected guest sessionToken');
    }
    expect((await hostReader.next()).type).toBe('participant_joined');
    expect((await hostReader.next()).type).toBe('activity_reset');

    // Guest disconnects abruptly -> Host sees reconnecting
    guestWs1.terminate();
    expect(await hostReader.next()).toMatchObject({
      type: 'reconnecting',
      participantId: guestJoined.participant.id,
    });

    // Advance 10s -> Guest reconnects via reconnect_room on a new WS
    clock.advanceBy(10_000);
    const guestWs2 = await app.injectWS('/ws');
    cleanups.push(() => guestWs2.terminate());
    const guest2Reader = createWsReader(guestWs2);

    guestWs2.send(
      JSON.stringify({
        type: 'reconnect_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'WS99-K2P4',
        sessionToken: guestJoined.sessionToken,
      }),
    );

    const [guestReconnected, hostPeerReconnected] = await Promise.all([
      guest2Reader.next(),
      hostReader.next(),
    ]);
    expect(guestReconnected).toMatchObject({
      type: 'reconnected',
      roomCode: 'WS99-K2P4',
    });
    expect(hostPeerReconnected).toMatchObject({
      type: 'participant_reconnected',
    });

    // Advance 60m -> authoritative inactivity expiry reaches both sockets
    clock.advanceBy(60 * 60 * 1000);

    const [hostExpired, guestExpired] = await Promise.all([
      hostReader.next(),
      guest2Reader.next(),
    ]);
    expect(hostExpired).toEqual({
      type: 'room_expired',
      version: WS_PROTOCOL_VERSION,
      reason: 'inactivity',
    });
    expect(guestExpired).toEqual({
      type: 'room_expired',
      version: WS_PROTOCOL_VERSION,
      reason: 'inactivity',
    });
  });
});
