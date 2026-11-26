import { randomBytes, randomUUID } from 'node:crypto';
import {
  WS_PROTOCOL_VERSION,
  type ClientWsMessage,
  type Participant,
  type ParticipantRole,
  type RoomMode,
  type ServerWsMessage,
  type WireEncryptedEnvelope,
} from '../shared/protocol';
import { formatRoomCode, isValidRoomCode } from '../shared/roomCode';
import { systemClock, type Clock } from './clock';

const DEFAULT_INACTIVITY_MS = 60 * 60 * 1000;
const MAX_DISPLAY_NAME_LENGTH = 48;

export interface ClientSession {
  send(message: ServerWsMessage): void;
  close?: () => void;
}

interface RoomMember {
  session: ClientSession;
  participant: Participant;
  sessionToken: string;
}

interface RoomRecord {
  roomCode: string;
  mode: RoomMode;
  onionAddress?: string;
  inactivityDurationMs: number;
  expiresAt: number;
  host: RoomMember;
  guest: RoomMember | null;
}

interface Membership {
  roomCode: string;
  participantId: string;
  role: ParticipantRole;
}

function sanitizeDisplayName(raw: string, fallback: string): string {
  const trimmed = raw.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  return trimmed || fallback;
}

function createSessionToken(): string {
  return randomBytes(24).toString('base64url');
}

function buildParticipantsList(room: RoomRecord): Participant[] {
  const list: Participant[] = [room.host.participant];
  if (room.guest) {
    list.push(room.guest.participant);
  }
  return list;
}

/**
 * Ephemeral in-RAM 1:1 room coordinator.
 * Never persists rooms, participants, or envelopes outside process memory.
 */
export class RoomStore {
  private readonly clock: Clock;
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly memberships = new Map<ClientSession, Membership>();

  constructor(clock: Clock = systemClock) {
    this.clock = clock;
  }

  handleMessage(client: ClientSession, message: ClientWsMessage): void {
    if (!message || typeof message !== 'object') return;
    if (message.version !== WS_PROTOCOL_VERSION) {
      client.send({
        type: 'room_error',
        version: WS_PROTOCOL_VERSION,
        code: 'transport_error',
        message: 'Unsupported protocol version',
      });
      return;
    }

    switch (message.type) {
      case 'create_room':
        this.createRoom(client, message);
        break;
      case 'join_room':
        this.joinRoom(client, message);
        break;
      case 'leave_room':
        this.handleDisconnect(client);
        break;
      case 'key_exchange':
      case 'encrypted_message':
      case 'typing':
      case 'call_signal':
      case 'notify_activity':
        this.handleRoomTraffic(client, message);
        break;
      case 'reconnect_room':
        client.send({
          type: 'room_error',
          version: WS_PROTOCOL_VERSION,
          code: 'room_not_found',
        });
        break;
    }
  }

  handleDisconnect(client: ClientSession): void {
    const membership = this.memberships.get(client);
    if (!membership) return;
    this.memberships.delete(client);

    const room = this.rooms.get(membership.roomCode);
    if (!room) return;

    if (membership.role === 'host') {
      this.rooms.delete(membership.roomCode);
      if (room.guest) {
        this.memberships.delete(room.guest.session);
        room.guest.session.send({
          type: 'room_expired',
          version: WS_PROTOCOL_VERSION,
          reason: 'host_left',
        });
      }
      return;
    }

    if (room.guest?.session === client) {
      room.guest = null;
      room.host.session.send({
        type: 'participant_left',
        version: WS_PROTOCOL_VERSION,
        participantId: membership.participantId,
        participants: buildParticipantsList(room),
      });
    }
  }

  private createRoom(
    client: ClientSession,
    msg: Extract<ClientWsMessage, { type: 'create_room' }>,
  ): void {
    if (!isValidRoomCode(msg.roomCode)) {
      this.sendError(client, 'invalid_code');
      return;
    }

    const code = formatRoomCode(msg.roomCode);
    const existing = this.rooms.get(code);
    if (existing) {
      if (this.clock.now() < existing.expiresAt) {
        this.sendError(client, 'transport_error', 'Room code already active');
        return;
      }
      this.purgeRoom(existing);
    }

    this.handleDisconnect(client);

    const mode: RoomMode = msg.mode === 'tor' ? 'tor' : 'normal';
    const durationMs =
      typeof msg.inactivityDurationMs === 'number' && msg.inactivityDurationMs > 0
        ? msg.inactivityDurationMs
        : DEFAULT_INACTIVITY_MS;
    const expiresAt = this.clock.now() + durationMs;
    const participant: Participant = {
      id: randomUUID(),
      displayName: sanitizeDisplayName(msg.displayName, 'Anfitrião'),
      role: 'host',
      online: true,
    };
    const sessionToken = createSessionToken();

    const room: RoomRecord = {
      roomCode: code,
      mode,
      onionAddress: mode === 'tor' ? msg.onionAddress : undefined,
      inactivityDurationMs: durationMs,
      expiresAt,
      host: { session: client, participant, sessionToken },
      guest: null,
    };

    this.rooms.set(code, room);
    this.memberships.set(client, {
      roomCode: code,
      participantId: participant.id,
      role: 'host',
    });

    client.send({
      type: 'room_joined',
      version: WS_PROTOCOL_VERSION,
      roomCode: code,
      participant,
      participants: [participant],
      mode,
      onionAddress: room.onionAddress,
      expiresAt,
      sessionToken,
    });
  }

  private joinRoom(
    client: ClientSession,
    msg: Extract<ClientWsMessage, { type: 'join_room' }>,
  ): void {
    if (!isValidRoomCode(msg.roomCode)) {
      this.sendError(client, 'invalid_code');
      return;
    }

    const code = formatRoomCode(msg.roomCode);
    const room = this.rooms.get(code);
    if (!room) {
      this.sendError(client, 'room_not_found');
      return;
    }

    if (this.clock.now() >= room.expiresAt) {
      this.purgeRoom(room, 'inactivity');
      this.sendError(client, 'room_expired');
      return;
    }

    if (room.guest !== null) {
      // Strict 1:1 limit: reject without exposing room state or notifying participants
      this.sendError(client, 'room_full');
      return;
    }

    this.handleDisconnect(client);

    const guestParticipant: Participant = {
      id: randomUUID(),
      displayName: sanitizeDisplayName(msg.displayName, 'Visitante'),
      role: 'guest',
      online: true,
    };
    const sessionToken = createSessionToken();

    room.guest = { session: client, participant: guestParticipant, sessionToken };
    room.expiresAt = this.clock.now() + room.inactivityDurationMs;

    this.memberships.set(client, {
      roomCode: code,
      participantId: guestParticipant.id,
      role: 'guest',
    });

    const participants = buildParticipantsList(room);

    client.send({
      type: 'room_joined',
      version: WS_PROTOCOL_VERSION,
      roomCode: code,
      participant: guestParticipant,
      participants,
      mode: room.mode,
      onionAddress: room.onionAddress,
      expiresAt: room.expiresAt,
      sessionToken,
    });

    room.host.session.send({
      type: 'participant_joined',
      version: WS_PROTOCOL_VERSION,
      participant: guestParticipant,
      participants,
    });
  }

  private handleRoomTraffic(
    client: ClientSession,
    msg: Extract<
      ClientWsMessage,
      {
        type:
          | 'key_exchange'
          | 'encrypted_message'
          | 'typing'
          | 'call_signal'
          | 'notify_activity';
      }
    >,
  ): void {
    const membership = this.memberships.get(client);
    if (!membership) return;

    const room = this.rooms.get(membership.roomCode);
    if (!room) {
      this.memberships.delete(client);
      return;
    }

    if (this.clock.now() >= room.expiresAt) {
      this.purgeRoom(room, 'inactivity');
      return;
    }

    const peer = membership.role === 'host' ? room.guest : room.host;

    switch (msg.type) {
      case 'key_exchange':
        peer?.session.send({
          type: 'key_exchange',
          version: WS_PROTOCOL_VERSION,
          senderId: membership.participantId,
          publicKeyJwk: msg.publicKeyJwk,
          hasSecret: msg.hasSecret,
        });
        break;

      case 'encrypted_message': {
        // Reconstruct envelope explicitly so relay never forwards plaintext senderName or spoofed identity
        const wireEnvelope: WireEncryptedEnvelope = {
          version: msg.envelope.version,
          roomCode: room.roomCode,
          senderId: membership.participantId,
          senderRole: membership.role,
          seq: msg.envelope.seq,
          iv: msg.envelope.iv,
          ciphertext: msg.envelope.ciphertext,
          sentAt: msg.envelope.sentAt,
        };
        peer?.session.send({
          type: 'encrypted_message',
          version: WS_PROTOCOL_VERSION,
          envelope: wireEnvelope,
        });
        this.refreshRoomActivity(room);
        break;
      }

      case 'typing':
        peer?.session.send({
          type: 'typing',
          version: WS_PROTOCOL_VERSION,
          participantId: membership.participantId,
          isTyping: Boolean(msg.isTyping),
        });
        break;

      case 'call_signal':
        if (room.mode === 'tor') {
          return;
        }
        peer?.session.send({
          type: 'call_signal',
          version: WS_PROTOCOL_VERSION,
          signal: {
            ...msg.signal,
            fromId: membership.participantId,
          },
        });
        break;

      case 'notify_activity':
        this.refreshRoomActivity(room);
        break;
    }
  }

  private refreshRoomActivity(room: RoomRecord): void {
    room.expiresAt = this.clock.now() + room.inactivityDurationMs;
    const resetMsg: ServerWsMessage = {
      type: 'activity_reset',
      version: WS_PROTOCOL_VERSION,
      expiresAt: room.expiresAt,
    };
    room.host.session.send(resetMsg);
    room.guest?.session.send(resetMsg);
  }

  private purgeRoom(room: RoomRecord, reason?: 'inactivity'): void {
    this.rooms.delete(room.roomCode);
    this.memberships.delete(room.host.session);
    if (reason) {
      room.host.session.send({
        type: 'room_expired',
        version: WS_PROTOCOL_VERSION,
        reason,
      });
    }
    if (room.guest) {
      this.memberships.delete(room.guest.session);
      if (reason) {
        room.guest.session.send({
          type: 'room_expired',
          version: WS_PROTOCOL_VERSION,
          reason,
        });
      }
    }
  }

  private sendError(
    client: ClientSession,
    code: Extract<ServerWsMessage, { type: 'room_error' }>['code'],
    message?: string,
  ): void {
    client.send({
      type: 'room_error',
      version: WS_PROTOCOL_VERSION,
      code,
      ...(message ? { message } : {}),
    });
  }
}
