import { describe, expect, it } from 'vitest';
import type { TransportEvent } from '../domain/types';
import { BroadcastChannelTransport, type BroadcastChannelLike } from './BroadcastChannelTransport';

function createFakeBroadcastChannelFactory() {
  const channels = new Map<string, Set<FakeChannel>>();

  class FakeChannel implements BroadcastChannelLike {
    onmessage: ((event: MessageEvent) => void) | null = null;
    private readonly name: string;

    constructor(name: string) {
      this.name = name;
      const set = channels.get(name) ?? new Set();
      set.add(this);
      channels.set(name, set);
    }

    postMessage(data: unknown): void {
      const set = channels.get(this.name);
      if (!set) return;
      for (const peer of set) {
        if (peer !== this && peer.onmessage) {
          peer.onmessage({ data } as MessageEvent);
        }
      }
    }

    close(): void {
      channels.get(this.name)?.delete(this);
    }
  }

  return (name: string): BroadcastChannelLike => new FakeChannel(name);
}

describe('BroadcastChannelTransport', () => {
  it('allows Host to create room, Guest to join, and rejects a 3rd intruder with room_full without leaking data', async () => {
    const channelFactory = createFakeBroadcastChannelFactory();
    const host = new BroadcastChannelTransport({ channelFactory, joinTimeoutMs: 50 });
    const guest = new BroadcastChannelTransport({ channelFactory, joinTimeoutMs: 50 });
    const intruder = new BroadcastChannelTransport({ channelFactory, joinTimeoutMs: 50 });

    const hostEvents: TransportEvent[] = [];
    const guestEvents: TransportEvent[] = [];
    const intruderEvents: TransportEvent[] = [];

    host.subscribe((e) => hostEvents.push(e));
    guest.subscribe((e) => guestEvents.push(e));
    intruder.subscribe((e) => intruderEvents.push(e));

    await host.createRoom({
      roomCode: 'X9K2-P7M4',
      displayName: 'Anfitrião Secreto',
      mode: 'normal',
    });

    await guest.joinRoom({
      roomCode: 'X9K2-P7M4',
      displayName: 'João Silva',
    });

    expect(guestEvents.some((e) => e.type === 'room_joined')).toBe(true);
    expect(hostEvents.some((e) => e.type === 'participant_joined')).toBe(true);

    // Send a message between Host and Guest before intruder attempts to join
    await host.sendEncryptedMessage({
      version: 1,
      roomCode: 'X9K2-P7M4',
      senderId: 'host-1',
      senderName: 'Anfitrião Secreto',
      senderRole: 'host',
      seq: 1,
      iv: 'iv-1',
      ciphertext: 'secret-payload',
      sentAt: Date.now(),
    });

    await intruder.joinRoom({
      roomCode: 'X9K2-P7M4',
      displayName: 'Intruso',
    });

    expect(intruderEvents).toEqual([{ type: 'room_error', code: 'room_full' }]);

    host.dispose();
    guest.dispose();
    intruder.dispose();
  });

  it('emits room_not_found when joining a non-existent room', async () => {
    const channelFactory = createFakeBroadcastChannelFactory();
    const guest = new BroadcastChannelTransport({ channelFactory, joinTimeoutMs: 30 });
    const events: TransportEvent[] = [];
    guest.subscribe((e) => events.push(e));

    await guest.joinRoom({
      roomCode: 'A7K9-M2P4',
      displayName: 'Visitante',
    });

    expect(events).toEqual([{ type: 'room_error', code: 'room_not_found' }]);
    guest.dispose();
  });
});
