// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { WS_PROTOCOL_VERSION, type ServerWsMessage } from '../shared/protocol';
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

describe('RoomStore (in-RAM 1:1 coordinator)', () => {
  it('creates a room, joins a guest, relays key_exchange, encrypted_message (without senderName), typing, and rejects a 3rd entrant with room_full', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const store = new RoomStore(clock);

    const host = createFakeClient();
    const guest = createFakeClient();
    const intruder = createFakeClient();

    store.handleMessage(host.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'x9k2p7m4',
      displayName: 'Ana',
      mode: 'normal',
      inactivityDurationMs: 60_000,
    });

    expect(host.sent).toHaveLength(1);
    const hostJoined = host.sent[0];
    expect(hostJoined.type).toBe('room_joined');
    if (hostJoined.type !== 'room_joined') throw new Error('Expected room_joined');
    expect(hostJoined.roomCode).toBe('X9K2-P7M4');
    expect(hostJoined.participant.role).toBe('host');
    expect(hostJoined.participant.displayName).toBe('Ana');
    expect(hostJoined.expiresAt).toBe(1_700_000_060_000);

    clock.advanceBy(5_000);

    store.handleMessage(guest.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'X9K2-P7M4',
      displayName: 'João',
    });

    const guestJoined = guest.sent[0];
    expect(guestJoined.type).toBe('room_joined');
    if (guestJoined.type !== 'room_joined') throw new Error('Expected room_joined');
    expect(guestJoined.participant.role).toBe('guest');
    expect(guestJoined.participants).toHaveLength(2);

    const hostPeerJoined = host.sent.find((m) => m.type === 'participant_joined');
    expect(hostPeerJoined).toBeDefined();

    // Intruder gets room_full without leaking anything to host or guest
    const hostCountBefore = host.sent.length;
    const guestCountBefore = guest.sent.length;
    store.handleMessage(intruder.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'X9K2-P7M4',
      displayName: 'Intruso',
    });
    expect(intruder.sent).toEqual([
      {
        type: 'room_error',
        version: WS_PROTOCOL_VERSION,
        code: 'room_full',
      },
    ]);
    expect(host.sent).toHaveLength(hostCountBefore);
    expect(guest.sent).toHaveLength(guestCountBefore);

    // Key exchange relay
    store.handleMessage(host.client, {
      type: 'key_exchange',
      version: WS_PROTOCOL_VERSION,
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' },
      hasSecret: true,
    });
    expect(guest.sent.at(-1)).toMatchObject({
      type: 'key_exchange',
      senderId: hostJoined.participant.id,
      hasSecret: true,
    });

    // Typing relay
    store.handleMessage(guest.client, {
      type: 'typing',
      version: WS_PROTOCOL_VERSION,
      isTyping: true,
    });
    expect(host.sent.at(-1)).toEqual({
      type: 'typing',
      version: WS_PROTOCOL_VERSION,
      participantId: guestJoined.participant.id,
      isTyping: true,
    });

    // Encrypted message relay strips any extra senderName and preserves opaque payload
    const maliciousEnvelope = {
      version: 1,
      roomCode: 'X9K2-P7M4',
      senderId: 'spoofed-id',
      senderName: 'LEAKED_NAME',
      senderRole: 'guest' as const,
      seq: 1,
      iv: 'iv-1',
      ciphertext: 'opaque-cipher',
      sentAt: 1_700_000_005_500,
    };
    store.handleMessage(host.client, {
      type: 'encrypted_message',
      version: WS_PROTOCOL_VERSION,
      envelope: maliciousEnvelope,
    });

    const relayed = guest.sent.find((m) => m.type === 'encrypted_message');
    expect(relayed).toBeDefined();
    if (!relayed || relayed.type !== 'encrypted_message') throw new Error('Expected encrypted_message');
    expect(relayed.envelope).not.toHaveProperty('senderName');
    expect(relayed.envelope.senderId).toBe(hostJoined.participant.id);
    expect(relayed.envelope.senderRole).toBe('host');
    expect(relayed.envelope.ciphertext).toBe('opaque-cipher');
  });

  it('rejects unknown rooms with room_not_found and invalid codes with invalid_code', () => {
    const store = new RoomStore(new ManualClock(1_000_000));
    const client = createFakeClient();

    store.handleMessage(client.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'A7K9-M2P4',
      displayName: 'Visitante',
    });
    expect(client.sent).toEqual([
      { type: 'room_error', version: WS_PROTOCOL_VERSION, code: 'room_not_found' },
    ]);

    store.handleMessage(client.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'BAD',
      displayName: 'Visitante',
    });
    expect(client.sent[1]).toEqual({
      type: 'room_error',
      version: WS_PROTOCOL_VERSION,
      code: 'invalid_code',
    });
  });

  it('keeps room open when guest leaves and expires room when host leaves', () => {
    const store = new RoomStore(new ManualClock(1_000_000));
    const host = createFakeClient();
    const guest1 = createFakeClient();
    const guest2 = createFakeClient();

    store.handleMessage(host.client, {
      type: 'create_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'A7K9-M2P4',
      displayName: 'Ana',
      mode: 'normal',
    });
    store.handleMessage(guest1.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'A7K9-M2P4',
      displayName: 'João',
    });

    store.handleMessage(guest1.client, {
      type: 'leave_room',
      version: WS_PROTOCOL_VERSION,
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: 'participant_left',
    });

    // A new guest can now join the vacated slot
    store.handleMessage(guest2.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'A7K9-M2P4',
      displayName: 'Maria',
    });
    expect(guest2.sent.at(-1)).toMatchObject({
      type: 'room_joined',
      roomCode: 'A7K9-M2P4',
    });

    // Host leaving destroys the room and notifies guest2
    store.handleMessage(host.client, {
      type: 'leave_room',
      version: WS_PROTOCOL_VERSION,
    });
    expect(guest2.sent.at(-1)).toMatchObject({
      type: 'room_expired',
    });

    // Subsequent join fails with room_not_found
    const latecomer = createFakeClient();
    store.handleMessage(latecomer.client, {
      type: 'join_room',
      version: WS_PROTOCOL_VERSION,
      roomCode: 'A7K9-M2P4',
      displayName: 'Tarde',
    });
    expect(latecomer.sent).toEqual([
      { type: 'room_error', version: WS_PROTOCOL_VERSION, code: 'room_not_found' },
    ]);
  });
});
