// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { WS_PROTOCOL_VERSION, type CallSignal, type ServerWsMessage } from '../shared/protocol';
import { createServer } from './app';
import { ManualClock } from './clock';
import { RoomStore, type ClientSession } from './roomStore';

function createFakeClient() {
  const sent: ServerWsMessage[] = [];
  const client: ClientSession = {
    send(message) {
      sent.push(message);
    },
  };
  return { client, sent };
}

function nextWsMessage(ws: {
  once: (event: string, cb: (data: Buffer) => void) => void;
}): Promise<ServerWsMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString('utf8')) as ServerWsMessage);
    });
  });
}

describe('WebRTC signaling & Tor blocking (RoomStore)', () => {
  it('delivers iceServers in Normal mode room_joined, forwards all call_signal types, and resets inactivity timer', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const customIce = [{ urls: ['stun:stun.l.google.com:19302'] }];
    const store = new RoomStore(clock, {
      iceServersProvider: () => customIce,
    });

    const host = createFakeClient();
    const guest = createFakeClient();

    store.handleMessage(host.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'X9K2-P7M4',
      displayName: 'Ana',
      mode: 'normal',
      inactivityDurationMs: 60_000,
    });

    const hostJoined = host.sent[0];
    expect(hostJoined.type).toBe('room_joined');
    if (hostJoined.type !== 'room_joined') throw new Error('Expected room_joined');
    expect(hostJoined.iceServers).toEqual(customIce);

    clock.advanceBy(10_000);

    store.handleMessage(guest.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'X9K2-P7M4',
      displayName: 'João',
    });

    const guestJoined = guest.sent[0];
    expect(guestJoined.type).toBe('room_joined');
    if (guestJoined.type !== 'room_joined') throw new Error('Expected room_joined');
    expect(guestJoined.iceServers).toEqual(customIce);

    const signals: Array<{
      from: typeof host;
      to: typeof guest;
      expectedFromId: string;
      signal: CallSignal;
    }> = [
      {
        from: host,
        to: guest,
        expectedFromId: hostJoined.participant.id,
        signal: { type: 'offer', fromId: 'spoofed', payload: { type: 'offer', sdp: 'v=0-offer' } },
      },
      {
        from: guest,
        to: host,
        expectedFromId: guestJoined.participant.id,
        signal: {
          type: 'answer',
          fromId: 'spoofed',
          payload: { type: 'answer', sdp: 'v=0-answer' },
        },
      },
      {
        from: host,
        to: guest,
        expectedFromId: hostJoined.participant.id,
        signal: { type: 'ice', fromId: 'spoofed', payload: { candidate: 'cand-1', sdpMid: '0' } },
      },
      {
        from: guest,
        to: host,
        expectedFromId: guestJoined.participant.id,
        signal: {
          type: 'media_state',
          fromId: 'spoofed',
          payload: { inCall: true, micEnabled: true, cameraEnabled: false, screenSharing: false },
        },
      },
      {
        from: host,
        to: guest,
        expectedFromId: hostJoined.participant.id,
        signal: { type: 'hangup', fromId: 'spoofed' },
      },
    ];

    for (const entry of signals) {
      clock.advanceBy(15_000);
      const expectedExpiresAt = clock.now() + 60_000;

      store.handleMessage(entry.from.client, {
        type: 'call_signal',
        version: WS_PROTOCOL_VERSION,
        signal: entry.signal,
      });

      const relayed = entry.to.sent.find(
        (m): m is Extract<ServerWsMessage, { type: 'call_signal' }> =>
          m.type === 'call_signal' && m.signal.type === entry.signal.type,
      );
      expect(relayed).toBeDefined();
      expect(relayed?.signal).toEqual({
        ...entry.signal,
        fromId: entry.expectedFromId,
      });

      expect(host.sent.at(-1)).toEqual({
        type: 'activity_reset',
        version: WS_PROTOCOL_VERSION,
        expiresAt: expectedExpiresAt,
      });
      expect(guest.sent.at(-1)).toEqual({
        type: 'activity_reset',
        version: WS_PROTOCOL_VERSION,
        expiresAt: expectedExpiresAt,
      });
    }
  });

  it('omits iceServers in Tor mode room_joined and rejects call_signal with tor_video_blocked without forwarding or resetting activity', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const store = new RoomStore(clock, {
      iceServersProvider: () => [{ urls: ['stun:stun.l.google.com:19302'] }],
    });

    const host = createFakeClient();
    const guest = createFakeClient();

    store.handleMessage(host.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'T7R2-M9P4',
      displayName: 'Ana',
      mode: 'tor',
      onionAddress: 'http://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.onion',
      inactivityDurationMs: 60_000,
    });

    const hostJoined = host.sent[0];
    expect(hostJoined.type).toBe('room_joined');
    expect(hostJoined).not.toHaveProperty('iceServers');

    store.handleMessage(guest.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'T7R2-M9P4',
      displayName: 'João',
    });

    const guestJoined = guest.sent[0];
    expect(guestJoined.type).toBe('room_joined');
    expect(guestJoined).not.toHaveProperty('iceServers');

    const guestCountBefore = guest.sent.length;
    const hostCountBefore = host.sent.length;

    clock.advanceBy(10_000);

    const blockedSignals: CallSignal[] = [
      { type: 'offer', fromId: 'h', payload: { type: 'offer', sdp: 'v=0' } },
      { type: 'answer', fromId: 'h', payload: { type: 'answer', sdp: 'v=0' } },
      { type: 'ice', fromId: 'h', payload: { candidate: 'cand' } },
      { type: 'media_state', fromId: 'h', payload: { inCall: true } },
      { type: 'hangup', fromId: 'h' },
    ];

    for (const signal of blockedSignals) {
      store.handleMessage(host.client, {
        type: 'call_signal',
        version: WS_PROTOCOL_VERSION,
        signal,
      });

      expect(host.sent.at(-1)).toEqual({
        type: 'room_error',
        version: WS_PROTOCOL_VERSION,
        code: 'tor_video_blocked',
        message: 'Video calls are blocked in Tor mode',
      });
    }

    expect(host.sent).toHaveLength(hostCountBefore + blockedSignals.length);
    expect(guest.sent).toHaveLength(guestCountBefore);
    expect(guest.sent.some((m) => m.type === 'call_signal' || m.type === 'activity_reset')).toBe(
      false,
    );
  });
});

describe('WebRTC signaling & Tor blocking (Fastify injectWS)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  it('delivers iceServers, relays call_signal, and broadcasts activity_reset in Normal mode over /ws', async () => {
    const clock = new ManualClock(1_700_000_000_000);
    const app = await createServer({
      clock,
      iceServersProvider: () => [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      ],
    });
    await app.ready();
    cleanups.push(() => app.close());

    const hostWs = await app.injectWS('/ws');
    const guestWs = await app.injectWS('/ws');
    cleanups.push(() => hostWs.close());
    cleanups.push(() => guestWs.close());

    const hostJoinedPromise = nextWsMessage(hostWs);
    hostWs.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'X9K2-P7M4',
        displayName: 'Ana',
        mode: 'normal',
        inactivityDurationMs: 60_000,
      }),
    );
    const hostJoined = await hostJoinedPromise;
    expect(hostJoined.type).toBe('room_joined');
    if (hostJoined.type !== 'room_joined') throw new Error('Expected room_joined');
    expect(hostJoined.iceServers).toEqual([
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ]);

    const guestJoinedPromise = nextWsMessage(guestWs);
    const hostPeerJoinedPromise = nextWsMessage(hostWs);
    guestWs.send(
      JSON.stringify({
        type: 'join_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'X9K2-P7M4',
        displayName: 'João',
      }),
    );
    const [guestJoined] = await Promise.all([guestJoinedPromise, hostPeerJoinedPromise]);
    if (guestJoined.type !== 'room_joined') throw new Error('Expected room_joined');
    expect(guestJoined.iceServers).toEqual([
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ]);

    clock.advanceBy(12_000);
    const guestCallSignalPromise = nextWsMessage(guestWs);
    const hostResetPromise = nextWsMessage(hostWs);

    hostWs.send(
      JSON.stringify({
        type: 'call_signal',
        version: WS_PROTOCOL_VERSION,
        signal: {
          type: 'offer',
          fromId: 'ignored',
          payload: { type: 'offer', sdp: 'v=0' },
        },
      }),
    );

    const [guestCallSignal, hostReset] = await Promise.all([
      guestCallSignalPromise,
      hostResetPromise,
    ]);
    expect(guestCallSignal).toEqual({
      type: 'call_signal',
      version: WS_PROTOCOL_VERSION,
      signal: {
        type: 'offer',
        fromId: hostJoined.participant.id,
        payload: { type: 'offer', sdp: 'v=0' },
      },
    });
    expect(hostReset).toEqual({
      type: 'activity_reset',
      version: WS_PROTOCOL_VERSION,
      expiresAt: 1_700_000_072_000,
    });
  });

  it('omits iceServers and rejects call_signal with tor_video_blocked in Tor mode over /ws', async () => {
    const app = await createServer({
      clock: new ManualClock(1_700_000_000_000),
      iceServersProvider: () => [{ urls: ['stun:stun.l.google.com:19302'] }],
    });
    await app.ready();
    cleanups.push(() => app.close());

    const hostWs = await app.injectWS('/ws');
    const guestWs = await app.injectWS('/ws');
    cleanups.push(() => hostWs.close());
    cleanups.push(() => guestWs.close());

    const hostJoinedPromise = nextWsMessage(hostWs);
    hostWs.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'T7R2-M9P4',
        displayName: 'Ana',
        mode: 'tor',
      }),
    );
    const hostJoined = await hostJoinedPromise;
    expect(hostJoined).not.toHaveProperty('iceServers');

    const guestJoinedPromise = nextWsMessage(guestWs);
    const hostPeerPromise = nextWsMessage(hostWs);
    guestWs.send(
      JSON.stringify({
        type: 'join_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'T7R2-M9P4',
        displayName: 'João',
      }),
    );
    const [guestJoined] = await Promise.all([guestJoinedPromise, hostPeerPromise]);
    expect(guestJoined).not.toHaveProperty('iceServers');

    const guestMessages: ServerWsMessage[] = [];
    guestWs.on('message', (data: Buffer) => {
      guestMessages.push(JSON.parse(data.toString('utf8')) as ServerWsMessage);
    });

    const hostErrorPromise = nextWsMessage(hostWs);
    hostWs.send(
      JSON.stringify({
        type: 'call_signal',
        version: WS_PROTOCOL_VERSION,
        signal: {
          type: 'offer',
          fromId: 'host',
          payload: { type: 'offer', sdp: 'v=0' },
        },
      }),
    );

    const hostError = await hostErrorPromise;
    expect(hostError).toEqual({
      type: 'room_error',
      version: WS_PROTOCOL_VERSION,
      code: 'tor_video_blocked',
      message: 'Video calls are blocked in Tor mode',
    });

    await new Promise((r) => setTimeout(r, 25));
    expect(guestMessages).toEqual([]);
  });
});
