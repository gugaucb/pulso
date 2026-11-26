import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  WS_PROTOCOL_VERSION,
  type ClientWsMessage,
  type IceServerConfig,
  type Participant,
  type ParticipantRole,
  type RoomExpiryReason,
  type RoomMode,
  type ServerWsMessage,
  type WireEncryptedEnvelope,
} from '../shared/protocol';
import { formatRoomCode, isValidRoomCode } from '../shared/roomCode';
import { systemClock, type Clock, type TimerHandle } from './clock';
import { buildIceServers } from './iceConfig';
import { DEFAULT_MAX_ROOMS, type SecurityManager } from './security';

export const DEFAULT_INACTIVITY_MS = 60 * 60 * 1000;
export const DEFAULT_HARD_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_GRACE_WINDOW_MS = 30 * 1000;
const MAX_DISPLAY_NAME_LENGTH = 48;

export interface RoomStoreOptions {
  clock?: Clock;
  inactivityDurationMs?: number;
  hardTtlMs?: number;
  graceWindowMs?: number;
  maxRooms?: number;
  security?: SecurityManager;
  iceServersProvider?: () => IceServerConfig[];
  onAllRoomsClosed?: () => void;
}

export interface ClientSession {
  send(message: ServerWsMessage): void;
  close?: () => void;
  originHash?: string;
}

interface RoomMember {
  session: ClientSession | null;
  participant: Participant;
  sessionToken: string;
  graceTimer: TimerHandle | null;
}

interface RoomRecord {
  roomCode: string;
  mode: RoomMode;
  onionAddress?: string;
  createdAt: number;
  hardExpiresAt: number;
  inactivityDurationMs: number;
  expiresAt: number;
  expiryTimer: TimerHandle | null;
  host: RoomMember;
  guest: RoomMember | null;
}

interface Membership {
  roomCode: string;
  participantId: string;
  role: ParticipantRole;
}

function tokensEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function resolveEnvPositiveMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveOptionMs(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
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
  private readonly defaultInactivityMs: number;
  private readonly hardTtlMs: number;
  private readonly graceWindowMs: number;
  private readonly maxRooms: number;
  private readonly security?: SecurityManager;
  private readonly iceServersProvider: () => IceServerConfig[];
  private readonly onAllRoomsClosed?: () => void;
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly memberships = new Map<ClientSession, Membership>();

  constructor(
    clockOrOptions: Clock | RoomStoreOptions = systemClock,
    options: Omit<RoomStoreOptions, 'clock'> = {},
  ) {
    let resolvedOptions: Omit<RoomStoreOptions, 'clock'>;
    if ('now' in clockOrOptions && typeof clockOrOptions.now === 'function') {
      this.clock = clockOrOptions;
      resolvedOptions = options;
    } else {
      const storeOptions = clockOrOptions as RoomStoreOptions;
      this.clock = storeOptions.clock ?? systemClock;
      resolvedOptions = { ...storeOptions, ...options };
    }

    this.defaultInactivityMs = resolveOptionMs(
      resolvedOptions.inactivityDurationMs,
      resolveEnvPositiveMs('PULSO_INACTIVITY_MS', DEFAULT_INACTIVITY_MS),
    );
    this.hardTtlMs = resolveOptionMs(resolvedOptions.hardTtlMs, DEFAULT_HARD_TTL_MS);
    this.graceWindowMs = resolveOptionMs(
      resolvedOptions.graceWindowMs,
      resolveEnvPositiveMs('PULSO_GRACE_WINDOW_MS', DEFAULT_GRACE_WINDOW_MS),
    );
    this.maxRooms = resolveOptionMs(
      resolvedOptions.maxRooms,
      resolveEnvPositiveMs('PULSO_MAX_ROOMS', DEFAULT_MAX_ROOMS),
    );
    this.security = resolvedOptions.security;
    this.iceServersProvider =
      resolvedOptions.iceServersProvider ?? (() => buildIceServers(process.env));
    this.onAllRoomsClosed = resolvedOptions.onAllRoomsClosed;
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
      case 'reconnect_room':
        this.reconnectRoom(client, message);
        break;
      case 'leave_room':
        this.handleExplicitLeave(client);
        break;
      case 'key_exchange':
      case 'encrypted_message':
      case 'typing':
      case 'call_signal':
      case 'notify_activity':
        this.handleRoomTraffic(client, message);
        break;
    }
  }

  handleExplicitLeave(client: ClientSession): void {
    const membership = this.memberships.get(client);
    if (!membership) return;
    this.memberships.delete(client);

    const room = this.rooms.get(membership.roomCode);
    if (!room) return;

    if (membership.role === 'host') {
      this.purgeRoom(room, 'host_left', client);
      return;
    }

    if (room.guest?.session === client) {
      this.clearGraceTimer(room.guest);
      room.guest = null;
      room.host.session?.send({
        type: 'participant_left',
        version: WS_PROTOCOL_VERSION,
        participantId: membership.participantId,
        participants: buildParticipantsList(room),
      });
    }
  }

  handleDisconnect(client: ClientSession): void {
    const membership = this.memberships.get(client);
    if (!membership) return;
    this.memberships.delete(client);

    const room = this.rooms.get(membership.roomCode);
    if (!room) return;

    const member = membership.role === 'host' ? room.host : room.guest;
    if (!member || member.session !== client) return;

    member.session = null;
    member.participant.online = false;
    this.scheduleGraceExpiry(room, membership.role, member);

    const peer = membership.role === 'host' ? room.guest : room.host;
    peer?.session?.send({
      type: 'reconnecting',
      version: WS_PROTOCOL_VERSION,
      participantId: member.participant.id,
    });
  }

  private createRoom(
    client: ClientSession,
    msg: Extract<ClientWsMessage, { type: 'create_room' }>,
  ): void {
    if (this.security && client.originHash && !this.security.allowCreateRoom(client.originHash)) {
      this.sendError(client, 'rate_limited');
      return;
    }

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

    this.handleExplicitLeave(client);

    if (this.rooms.size >= this.maxRooms) {
      this.pruneExpiredRooms();
      if (this.rooms.size >= this.maxRooms) {
        this.sendError(client, 'server_at_capacity');
        return;
      }
    }

    const mode: RoomMode = msg.mode === 'tor' ? 'tor' : 'normal';
    const durationMs = resolveOptionMs(msg.inactivityDurationMs, this.defaultInactivityMs);
    const createdAt = this.clock.now();
    const hardExpiresAt = createdAt + this.hardTtlMs;
    const expiresAt = Math.min(createdAt + durationMs, hardExpiresAt);
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
      createdAt,
      hardExpiresAt,
      inactivityDurationMs: durationMs,
      expiresAt,
      expiryTimer: null,
      host: { session: client, participant, sessionToken, graceTimer: null },
      guest: null,
    };

    this.rooms.set(code, room);
    this.memberships.set(client, {
      roomCode: code,
      participantId: participant.id,
      role: 'host',
    });
    this.scheduleRoomExpiry(room);

    this.emitRoomJoinedOrReconnected(
      client,
      'room_joined',
      room,
      participant,
      [participant],
      sessionToken,
    );
  }

  private resolveExistingRoom(client: ClientSession, rawCode: string): RoomRecord | null {
    if (this.isJoinRateLimited(client)) {
      this.sendError(client, 'rate_limited');
      return null;
    }

    if (!isValidRoomCode(rawCode)) {
      this.recordFailedJoin(client);
      this.sendError(client, 'invalid_code');
      return null;
    }

    const code = formatRoomCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) {
      this.recordFailedJoin(client);
      this.sendError(client, 'room_not_found');
      return null;
    }

    if (this.clock.now() >= room.expiresAt) {
      this.recordFailedJoin(client);
      this.purgeRoom(room, this.resolveExpiryReason(room));
      this.sendError(client, 'room_expired');
      return null;
    }

    return room;
  }

  private emitRoomJoinedOrReconnected(
    client: ClientSession,
    type: 'room_joined' | 'reconnected',
    room: RoomRecord,
    participant: Participant,
    participants: Participant[],
    sessionToken?: string,
  ): void {
    const payload = {
      version: WS_PROTOCOL_VERSION,
      roomCode: room.roomCode,
      participant,
      participants,
      mode: room.mode,
      onionAddress: room.onionAddress,
      expiresAt: room.expiresAt,
      ...(room.mode === 'normal' ? { iceServers: this.iceServersProvider() } : {}),
    };
    if (type === 'room_joined') {
      client.send({ type: 'room_joined', ...payload, sessionToken });
      return;
    }
    client.send({ type: 'reconnected', ...payload });
  }

  private joinRoom(
    client: ClientSession,
    msg: Extract<ClientWsMessage, { type: 'join_room' }>,
  ): void {
    const room = this.resolveExistingRoom(client, msg.roomCode);
    if (!room) return;

    if (room.guest !== null) {
      // Strict 1:1 limit: reject without exposing room state or notifying participants
      this.sendError(client, 'room_full');
      return;
    }

    this.handleExplicitLeave(client);

    const guestParticipant: Participant = {
      id: randomUUID(),
      displayName: sanitizeDisplayName(msg.displayName, 'Visitante'),
      role: 'guest',
      online: true,
    };
    const sessionToken = createSessionToken();

    room.guest = { session: client, participant: guestParticipant, sessionToken, graceTimer: null };
    room.expiresAt = Math.min(this.clock.now() + room.inactivityDurationMs, room.hardExpiresAt);
    this.scheduleRoomExpiry(room);

    this.memberships.set(client, {
      roomCode: room.roomCode,
      participantId: guestParticipant.id,
      role: 'guest',
    });

    const participants = buildParticipantsList(room);
    this.emitRoomJoinedOrReconnected(
      client,
      'room_joined',
      room,
      guestParticipant,
      participants,
      sessionToken,
    );

    room.host.session?.send({
      type: 'participant_joined',
      version: WS_PROTOCOL_VERSION,
      participant: guestParticipant,
      participants,
    });

    room.host.session?.send({
      type: 'activity_reset',
      version: WS_PROTOCOL_VERSION,
      expiresAt: room.expiresAt,
    });
  }

  private reconnectRoom(
    client: ClientSession,
    msg: Extract<ClientWsMessage, { type: 'reconnect_room' }>,
  ): void {
    const room = this.resolveExistingRoom(client, msg.roomCode);
    if (!room) return;

    if (typeof msg.sessionToken !== 'string' || !msg.sessionToken) {
      this.recordFailedJoin(client);
      this.sendError(client, 'room_not_found');
      return;
    }

    let role: ParticipantRole | null = null;
    let member: RoomMember | null = null;

    if (tokensEqual(msg.sessionToken, room.host.sessionToken)) {
      role = 'host';
      member = room.host;
    } else if (room.guest && tokensEqual(msg.sessionToken, room.guest.sessionToken)) {
      role = 'guest';
      member = room.guest;
    }

    if (!role || !member) {
      this.recordFailedJoin(client);
      this.sendError(client, 'room_not_found');
      return;
    }

    if (member.session && member.session !== client) {
      const previousSession = member.session;
      this.memberships.delete(previousSession);
      previousSession.close?.();
    }

    this.clearGraceTimer(member);
    member.session = client;
    member.participant.online = true;

    this.memberships.set(client, {
      roomCode: room.roomCode,
      participantId: member.participant.id,
      role,
    });

    const participants = buildParticipantsList(room);
    this.emitRoomJoinedOrReconnected(client, 'reconnected', room, member.participant, participants);

    const peer = role === 'host' ? room.guest : room.host;
    peer?.session?.send({
      type: 'participant_reconnected',
      version: WS_PROTOCOL_VERSION,
      participant: member.participant,
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
      this.purgeRoom(room, this.resolveExpiryReason(room));
      return;
    }

    const peer = membership.role === 'host' ? room.guest : room.host;

    switch (msg.type) {
      case 'key_exchange':
        peer?.session?.send({
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
        peer?.session?.send({
          type: 'encrypted_message',
          version: WS_PROTOCOL_VERSION,
          envelope: wireEnvelope,
        });
        this.refreshRoomActivity(room);
        break;
      }

      case 'typing':
        peer?.session?.send({
          type: 'typing',
          version: WS_PROTOCOL_VERSION,
          participantId: membership.participantId,
          isTyping: Boolean(msg.isTyping),
        });
        break;

      case 'call_signal':
        if (room.mode === 'tor') {
          this.sendError(client, 'tor_video_blocked', 'Video calls are blocked in Tor mode');
          return;
        }
        peer?.session?.send({
          type: 'call_signal',
          version: WS_PROTOCOL_VERSION,
          signal: {
            ...msg.signal,
            fromId: membership.participantId,
          },
        });
        this.refreshRoomActivity(room);
        break;

      case 'notify_activity':
        this.refreshRoomActivity(room);
        break;
    }
  }

  private resolveExpiryReason(room: RoomRecord): RoomExpiryReason {
    return this.clock.now() >= room.hardExpiresAt ? 'hard_ttl' : 'inactivity';
  }

  private pruneExpiredRooms(): void {
    const now = this.clock.now();
    for (const room of this.rooms.values()) {
      if (now >= room.expiresAt) {
        this.purgeRoom(room, this.resolveExpiryReason(room));
      }
    }
  }

  private clearGraceTimer(member: RoomMember): void {
    if (member.graceTimer !== null) {
      this.clock.clearTimeout(member.graceTimer);
      member.graceTimer = null;
    }
  }

  private scheduleGraceExpiry(
    room: RoomRecord,
    role: ParticipantRole,
    member: RoomMember,
  ): void {
    this.clearGraceTimer(member);
    const code = room.roomCode;
    member.graceTimer = this.clock.setTimeout(() => {
      member.graceTimer = null;
      this.onGraceTimeout(code, role, member);
    }, this.graceWindowMs);
  }

  private onGraceTimeout(roomCode: string, role: ParticipantRole, member: RoomMember): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    if (role === 'host') {
      if (room.host !== member || room.host.participant.online) return;
      this.purgeRoom(room, 'grace_timeout');
      return;
    }

    if (room.guest !== member || room.guest.participant.online) return;
    const guestId = member.participant.id;
    room.guest = null;

    if (!room.host.participant.online && room.host.graceTimer === null) {
      this.purgeRoom(room, 'grace_timeout');
      return;
    }

    room.host.session?.send({
      type: 'participant_left',
      version: WS_PROTOCOL_VERSION,
      participantId: guestId,
      participants: buildParticipantsList(room),
    });
  }

  private scheduleRoomExpiry(room: RoomRecord): void {
    if (room.expiryTimer !== null) {
      this.clock.clearTimeout(room.expiryTimer);
      room.expiryTimer = null;
    }
    const delayMs = Math.max(0, room.expiresAt - this.clock.now());
    const code = room.roomCode;
    room.expiryTimer = this.clock.setTimeout(() => {
      const current = this.rooms.get(code);
      if (!current || current !== room) return;
      current.expiryTimer = null;
      this.purgeRoom(current, this.resolveExpiryReason(current));
    }, delayMs);
  }

  private broadcastActivityReset(room: RoomRecord): void {
    const resetMsg: ServerWsMessage = {
      type: 'activity_reset',
      version: WS_PROTOCOL_VERSION,
      expiresAt: room.expiresAt,
    };
    room.host.session?.send(resetMsg);
    room.guest?.session?.send(resetMsg);
  }

  private refreshRoomActivity(room: RoomRecord): void {
    room.expiresAt = Math.min(this.clock.now() + room.inactivityDurationMs, room.hardExpiresAt);
    this.scheduleRoomExpiry(room);
    this.broadcastActivityReset(room);
  }

  private purgeRoom(
    room: RoomRecord,
    reason?: RoomExpiryReason,
    excludeClient?: ClientSession,
  ): void {
    if (room.expiryTimer !== null) {
      this.clock.clearTimeout(room.expiryTimer);
      room.expiryTimer = null;
    }
    this.clearGraceTimer(room.host);
    if (room.guest) {
      this.clearGraceTimer(room.guest);
    }

    const deleted = this.rooms.delete(room.roomCode);

    const members = room.guest ? [room.host, room.guest] : [room.host];
    for (const member of members) {
      const session = member.session;
      if (!session) continue;
      this.memberships.delete(session);
      if (reason && session !== excludeClient) {
        session.send({
          type: 'room_expired',
          version: WS_PROTOCOL_VERSION,
          reason,
        });
        session.close?.();
      }
    }

    if (deleted && reason && this.rooms.size === 0) {
      this.onAllRoomsClosed?.();
    }
  }

  private isJoinRateLimited(client: ClientSession): boolean {
    if (!this.security || !client.originHash) return false;
    return this.security.isFailedJoinRateLimited(client.originHash);
  }

  private recordFailedJoin(client: ClientSession): void {
    if (!this.security || !client.originHash) return;
    this.security.recordFailedJoin(client.originHash);
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
