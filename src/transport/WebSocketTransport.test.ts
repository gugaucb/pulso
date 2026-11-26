import { describe, expect, it } from 'vitest';
import { WS_PROTOCOL_VERSION, type ServerWsMessage } from '../../shared/protocol';
import type { TransportEvent } from '../domain/types';
import { WebSocketTransport, type WebSocketLike } from './WebSocketTransport';

class FakeWebSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  readonly sent: string[] = [];
  closedCount = 0;
  private listeners = new Map<string, Set<(event?: unknown) => void>>();

  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(type: string, listener: (event: never) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event?: unknown) => void);
    this.listeners.set(type, set);
  }

  removeEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  removeEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.get(type)?.delete(listener as (event?: unknown) => void);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closedCount += 1;
    this.readyState = 3; // CLOSED
    this.dispatch('close');
  }

  open(): void {
    this.readyState = 1; // OPEN
    this.dispatch('open');
  }

  receiveServerMessage(message: ServerWsMessage): void {
    this.dispatch('message', { data: JSON.stringify(message) });
  }

  fail(): void {
    this.readyState = 3;
    this.dispatch('error');
    this.dispatch('close');
  }

  private dispatch(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe('WebSocketTransport', () => {
  it('connects, sends create_room, emits room_joined, and omits senderName on wire envelopes', async () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'ws://127.0.0.1:3001/ws',
      webSocketFactory: () => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    });

    const events: TransportEvent[] = [];
    transport.subscribe((e) => events.push(e));

    const createPromise = transport.createRoom({
      roomCode: 'X9K2-P7M4',
      displayName: 'Ana',
      mode: 'normal',
    });

    expect(sockets).toHaveLength(1);
    const ws = sockets[0];
    ws.open();

    expect(JSON.parse(ws.sent[0])).toEqual({
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'X9K2-P7M4',
      displayName: 'Ana',
      mode: 'normal',
    });

    ws.receiveServerMessage({
      type: 'room_joined',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'X9K2-P7M4',
      participant: { id: 'p-1', displayName: 'Ana', role: 'host', online: true },
      participants: [{ id: 'p-1', displayName: 'Ana', role: 'host', online: true }],
      mode: 'normal',
      expiresAt: 1_700_003_600_000,
      sessionToken: 'tok-1',
    });

    await createPromise;
    expect(events[0]).toMatchObject({ type: 'room_joined', roomCode: 'X9K2-P7M4' });

    await transport.sendEncryptedMessage({
      version: 1,
      roomCode: 'X9K2-P7M4',
      senderId: 'p-1',
      senderRole: 'host',
      seq: 1,
      iv: 'iv-1',
      ciphertext: 'cipher-1',
      sentAt: 1_700_000_000_000,
    });

    const sentPayload = JSON.parse(ws.sent[1]);
    expect(sentPayload.type).toBe('encrypted_message');
    expect(sentPayload.envelope).not.toHaveProperty('senderName');
    expect(sentPayload.envelope.ciphertext).toBe('cipher-1');

    await transport.leaveRoom();
    expect(JSON.parse(ws.sent[2])).toEqual({
      type: 'leave_room',
      version: WS_PROTOCOL_VERSION,
    });
    expect(ws.closedCount).toBe(1);
  });

  it('handles React StrictMode leaveRoom() during CONNECTING without leaking sockets or emitting transport_error', async () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'ws://127.0.0.1:3001/ws',
      webSocketFactory: () => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    });

    const events: TransportEvent[] = [];
    transport.subscribe((e) => events.push(e));

    // Mount 1 starts joining while socket is still CONNECTING (readyState === 0)
    const join1 = transport.joinRoom({ roomCode: 'X9K2-P7M4', displayName: 'João' });
    // StrictMode Cleanup 1 aborts before socket opens
    await transport.leaveRoom();
    await join1;

    // When Mount 1's socket eventually finishes opening, it must close immediately and silently
    sockets[0].open();
    expect(sockets[0].closedCount).toBe(1);
    expect(sockets[0].sent).toHaveLength(0);
    expect(events).toEqual([]);

    // Mount 2 retries cleanly
    const join2 = transport.joinRoom({ roomCode: 'X9K2-P7M4', displayName: 'João' });
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    sockets[1].receiveServerMessage({
      type: 'room_joined',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'X9K2-P7M4',
      participant: { id: 'p-2', displayName: 'João', role: 'guest', online: true },
      participants: [
        { id: 'p-1', displayName: 'Ana', role: 'host', online: true },
        { id: 'p-2', displayName: 'João', role: 'guest', online: true },
      ],
      mode: 'normal',
      expiresAt: 1_700_003_600_000,
    });
    await join2;

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('room_joined');
    transport.dispose();
    expect(sockets[1].closedCount).toBe(1);
  });

  it('emits transport_error when socket fails before joining', async () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'ws://127.0.0.1:3001/ws',
      webSocketFactory: () => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    });

    const events: TransportEvent[] = [];
    transport.subscribe((e) => events.push(e));

    const joinPromise = transport.joinRoom({ roomCode: 'X9K2-P7M4', displayName: 'João' });
    sockets[0].fail();
    await joinPromise;

    expect(events).toEqual([{ type: 'room_error', code: 'transport_error' }]);
  });

  it('forwards iceServers in normal mode room_joined, strips them in tor mode, and keeps room socket open on tor_video_blocked', async () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'ws://127.0.0.1:3001/ws',
      webSocketFactory: () => {
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws;
      },
    });

    const events: TransportEvent[] = [];
    transport.subscribe((e) => events.push(e));

    const joinNormal = transport.joinRoom({ roomCode: 'X9K2-P7M4', displayName: 'Ana' });
    sockets[0].open();
    sockets[0].receiveServerMessage({
      type: 'room_joined',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'X9K2-P7M4',
      participant: { id: 'p-1', displayName: 'Ana', role: 'guest', online: true },
      participants: [{ id: 'p-1', displayName: 'Ana', role: 'guest', online: true }],
      mode: 'normal',
      expiresAt: 1_700_003_600_000,
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
    });
    await joinNormal;
    expect(events[0]).toMatchObject({
      type: 'room_joined',
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
    });

    await transport.leaveRoom();

    const joinTor = transport.joinRoom({ roomCode: 'T7R2-M9P4', displayName: 'Ana' });
    sockets[1].open();
    sockets[1].receiveServerMessage({
      type: 'room_joined',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'T7R2-M9P4',
      participant: { id: 'p-2', displayName: 'Ana', role: 'guest', online: true },
      participants: [{ id: 'p-2', displayName: 'Ana', role: 'guest', online: true }],
      mode: 'tor',
      expiresAt: 1_700_003_600_000,
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
    });
    await joinTor;
    expect(events[1]).not.toHaveProperty('iceServers');

    sockets[1].receiveServerMessage({
      type: 'room_error',
      version: WS_PROTOCOL_VERSION,
      code: 'tor_video_blocked',
      message: 'Video calls are blocked in Tor mode',
    });
    expect(events[2]).toEqual({
      type: 'room_error',
      code: 'tor_video_blocked',
      message: 'Video calls are blocked in Tor mode',
    });
    expect(sockets[1].closedCount).toBe(0);

    transport.dispose();
  });
});
