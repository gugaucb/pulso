import { formatRoomCode, isValidRoomCode } from '../domain/roomCode';
import type {
  CallSignal,
  EncryptedEnvelope,
  Participant,
  RoomMode,
  TransportEvent,
} from '../domain/types';
import type { CreateRoomParams, JoinRoomParams, RoomTransport } from './RoomTransport';

const DEFAULT_INACTIVITY_MS = 60 * 60 * 1000;

interface InMemoryRoom {
  roomCode: string;
  mode: RoomMode;
  onionAddress?: string;
  inactivityDurationMs: number;
  expiresAt: number;
  host: InMemoryClient;
  guest: InMemoryClient | null;
}

/**
 * Deterministic in-memory hub producing paired or multi-client RoomTransport
 * instances for Vitest UI integration tests.
 */
export class InMemoryTransportHub {
  private readonly rooms = new Map<string, InMemoryRoom>();
  private clientCounter = 0;

  createTransport(): RoomTransport {
    this.clientCounter += 1;
    const id = `mem-client-${this.clientCounter}`;
    return new InMemoryClient(this, id);
  }

  /** @internal */
  _createRoom(client: InMemoryClient, params: CreateRoomParams): void {
    if (!isValidRoomCode(params.roomCode)) {
      client._emit({ type: 'room_error', code: 'invalid_code' });
      return;
    }

    const code = formatRoomCode(params.roomCode);
    const durationMs = params.inactivityDurationMs ?? DEFAULT_INACTIVITY_MS;
    const expiresAt = Date.now() + durationMs;

    const participant: Participant = {
      id: client.id,
      displayName: params.displayName,
      role: 'host',
      online: true,
    };

    const room: InMemoryRoom = {
      roomCode: code,
      mode: params.mode,
      onionAddress: params.onionAddress,
      inactivityDurationMs: durationMs,
      expiresAt,
      host: client,
      guest: null,
    };

    this.rooms.set(code, room);
    client._setRoom(code, participant);
    client._emit({
      type: 'room_joined',
      roomCode: code,
      participant,
      participants: [participant],
      mode: room.mode,
      onionAddress: room.onionAddress,
      expiresAt: room.expiresAt,
    });
  }

  /** @internal */
  _joinRoom(client: InMemoryClient, params: JoinRoomParams): void {
    if (!isValidRoomCode(params.roomCode)) {
      client._emit({ type: 'room_error', code: 'invalid_code' });
      return;
    }

    const code = formatRoomCode(params.roomCode);
    const room = this.rooms.get(code);
    if (!room) {
      client._emit({ type: 'room_error', code: 'room_not_found' });
      return;
    }

    if (Date.now() >= room.expiresAt) {
      this.rooms.delete(code);
      client._emit({ type: 'room_error', code: 'room_expired' });
      return;
    }

    if (room.guest !== null && room.guest !== client) {
      // Strict 1:1 privacy: reject without leaking messages or participant metadata
      client._emit({ type: 'room_error', code: 'room_full' });
      return;
    }

    const guestParticipant: Participant = {
      id: client.id,
      displayName: params.displayName,
      role: 'guest',
      online: true,
    };

    room.guest = client;
    client._setRoom(code, guestParticipant);

    const participants = this._getParticipants(room);

    client._emit({
      type: 'room_joined',
      roomCode: code,
      participant: guestParticipant,
      participants,
      mode: room.mode,
      onionAddress: room.onionAddress,
      expiresAt: room.expiresAt,
    });

    room.host._emit({
      type: 'participant_joined',
      participant: guestParticipant,
      participants,
    });
  }

  /** @internal */
  _leaveRoom(client: InMemoryClient): void {
    const code = client.currentRoomCode;
    if (!code) return;
    const room = this.rooms.get(code);
    client._clearRoom();
    if (!room) return;

    if (room.host === client) {
      this.rooms.delete(code);
      if (room.guest) {
        room.guest._clearRoom();
        room.guest._emit({ type: 'room_expired' });
      }
      return;
    }

    if (room.guest === client) {
      room.guest = null;
      room.host._emit({
        type: 'participant_left',
        participantId: client.id,
        participants: this._getParticipants(room),
      });
    }
  }

  /** @internal */
  _forwardToPeer(sender: InMemoryClient, event: TransportEvent): void {
    const code = sender.currentRoomCode;
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;

    const peer = room.host === sender ? room.guest : room.guest === sender ? room.host : null;
    if (peer) {
      peer._emit(event);
    }
  }

  /** @internal */
  _notifyActivity(sender: InMemoryClient): void {
    const code = sender.currentRoomCode;
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;
    room.expiresAt = Date.now() + room.inactivityDurationMs;
    const event: TransportEvent = { type: 'activity_reset', expiresAt: room.expiresAt };
    room.host._emit(event);
    room.guest?._emit(event);
  }

  private _getParticipants(room: InMemoryRoom): Participant[] {
    const list: Participant[] = [];
    if (room.host.participant) list.push(room.host.participant);
    if (room.guest?.participant) list.push(room.guest.participant);
    return list;
  }
}

class InMemoryClient implements RoomTransport {
  readonly id: string;
  currentRoomCode: string | null = null;
  participant: Participant | null = null;

  private readonly hub: InMemoryTransportHub;
  private readonly listeners = new Set<(event: TransportEvent) => void>();
  private disposed = false;

  constructor(hub: InMemoryTransportHub, id: string) {
    this.hub = hub;
    this.id = id;
  }

  /** @internal */
  _setRoom(roomCode: string, participant: Participant): void {
    this.currentRoomCode = roomCode;
    this.participant = participant;
  }

  /** @internal */
  _clearRoom(): void {
    this.currentRoomCode = null;
    this.participant = null;
  }

  /** @internal */
  _emit(event: TransportEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: (event: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async createRoom(params: CreateRoomParams): Promise<void> {
    if (this.disposed) return;
    this.hub._createRoom(this, params);
  }

  async joinRoom(params: JoinRoomParams): Promise<void> {
    if (this.disposed) return;
    this.hub._joinRoom(this, params);
  }

  async leaveRoom(): Promise<void> {
    this.hub._leaveRoom(this);
  }

  async sendEncryptedMessage(envelope: EncryptedEnvelope): Promise<void> {
    if (this.disposed) return;
    this.hub._forwardToPeer(this, { type: 'encrypted_message', envelope });
  }

  async sendKeyExchange(publicKeyJwk: JsonWebKey, options?: { hasSecret?: boolean }): Promise<void> {
    if (this.disposed || !this.participant) return;
    this.hub._forwardToPeer(this, {
      type: 'key_exchange',
      senderId: this.participant.id,
      publicKeyJwk,
      hasSecret: options?.hasSecret,
    });
  }

  async setTyping(isTyping: boolean): Promise<void> {
    if (this.disposed || !this.participant) return;
    this.hub._forwardToPeer(this, {
      type: 'typing',
      participantId: this.participant.id,
      isTyping,
    });
  }

  async sendCallSignal(signal: CallSignal): Promise<void> {
    if (this.disposed) return;
    this.hub._forwardToPeer(this, { type: 'call_signal', signal });
  }

  async notifyActivity(): Promise<void> {
    if (this.disposed) return;
    this.hub._notifyActivity(this);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hub._leaveRoom(this);
    this.listeners.clear();
  }
}
