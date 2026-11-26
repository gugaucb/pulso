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
const DEFAULT_JOIN_TIMEOUT_MS = 600;

export interface BroadcastChannelLike {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(data: unknown): void;
  close(): void;
}

export interface BroadcastChannelTransportOptions {
  channelFactory?: (name: string) => BroadcastChannelLike;
  joinTimeoutMs?: number;
}

type WireMessage =
  | { kind: 'join_request'; requesterId: string; displayName: string }
  | {
      kind: 'join_accepted';
      targetId: string;
      roomCode: string;
      participant: Participant;
      participants: Participant[];
      mode: RoomMode;
      onionAddress?: string;
      expiresAt: number;
      inactivityDurationMs: number;
    }
  | { kind: 'join_rejected'; targetId: string; code: 'room_full' | 'room_expired' }
  | { kind: 'participant_left'; senderId: string }
  | { kind: 'room_expired'; senderId: string }
  | { kind: 'encrypted_message'; senderId: string; envelope: EncryptedEnvelope }
  | { kind: 'key_exchange'; senderId: string; publicKeyJwk: JsonWebKey; hasSecret?: boolean }
  | { kind: 'typing'; senderId: string; isTyping: boolean }
  | { kind: 'call_signal'; senderId: string; signal: CallSignal }
  | { kind: 'activity_reset'; senderId: string; expiresAt: number };

function createVolatileId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Phase 1 multi-tab RoomTransport backed by BroadcastChannel.
 * The Host tab acts as the volatile in-memory 1:1 authority for the room.
 */
export class BroadcastChannelTransport implements RoomTransport {
  private readonly channelFactory: (name: string) => BroadcastChannelLike;
  private readonly joinTimeoutMs: number;
  private readonly listeners = new Set<(event: TransportEvent) => void>();
  private readonly clientId = createVolatileId();

  private channel: BroadcastChannelLike | null = null;
  private roomCode: string | null = null;
  private localParticipant: Participant | null = null;
  private hostParticipant: Participant | null = null;
  private guestParticipant: Participant | null = null;
  private mode: RoomMode = 'normal';
  private onionAddress?: string;
  private inactivityDurationMs = DEFAULT_INACTIVITY_MS;
  private expiresAt = 0;
  private pendingJoinTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingJoinResolve: (() => void) | null = null;
  private disposed = false;

  constructor(options: BroadcastChannelTransportOptions = {}) {
    this.channelFactory =
      options.channelFactory ?? ((name: string) => new BroadcastChannel(name));
    this.joinTimeoutMs = options.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS;
  }

  subscribe(listener: (event: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: TransportEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private getParticipants(): Participant[] {
    const list: Participant[] = [];
    if (this.hostParticipant) list.push(this.hostParticipant);
    if (this.guestParticipant) list.push(this.guestParticipant);
    return list;
  }

  private resetRoomState(): void {
    if (this.pendingJoinTimeout) {
      clearTimeout(this.pendingJoinTimeout);
      this.pendingJoinTimeout = null;
    }
    this.pendingJoinResolve = null;
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }
    this.roomCode = null;
    this.localParticipant = null;
    this.hostParticipant = null;
    this.guestParticipant = null;
  }

  private openChannel(formattedCode: string): BroadcastChannelLike {
    const ch = this.channelFactory(`pulso:room:${formattedCode}`);
    ch.onmessage = (event: MessageEvent) => {
      this.handleWireMessage(event.data as WireMessage);
    };
    this.channel = ch;
    return ch;
  }

  async createRoom(params: CreateRoomParams): Promise<void> {
    if (this.disposed) return;
    if (!isValidRoomCode(params.roomCode)) {
      this.emit({ type: 'room_error', code: 'invalid_code' });
      return;
    }

    this.resetRoomState();
    const formattedCode = formatRoomCode(params.roomCode);
    this.roomCode = formattedCode;
    this.mode = params.mode;
    this.onionAddress = params.onionAddress;
    this.inactivityDurationMs = params.inactivityDurationMs ?? DEFAULT_INACTIVITY_MS;
    this.expiresAt = Date.now() + this.inactivityDurationMs;

    const host: Participant = {
      id: this.clientId,
      displayName: params.displayName,
      role: 'host',
      online: true,
    };

    this.localParticipant = host;
    this.hostParticipant = host;
    this.guestParticipant = null;

    this.openChannel(formattedCode);

    this.emit({
      type: 'room_joined',
      roomCode: formattedCode,
      participant: host,
      participants: this.getParticipants(),
      mode: this.mode,
      onionAddress: this.onionAddress,
      expiresAt: this.expiresAt,
    });
  }

  async joinRoom(params: JoinRoomParams): Promise<void> {
    if (this.disposed) return;
    if (!isValidRoomCode(params.roomCode)) {
      this.emit({ type: 'room_error', code: 'invalid_code' });
      return;
    }

    this.resetRoomState();
    const formattedCode = formatRoomCode(params.roomCode);
    this.roomCode = formattedCode;
    const ch = this.openChannel(formattedCode);

    return new Promise<void>((resolve) => {
      this.pendingJoinResolve = resolve;
      this.pendingJoinTimeout = setTimeout(() => {
        if (this.pendingJoinResolve) {
          const done = this.pendingJoinResolve;
          this.resetRoomState();
          this.emit({ type: 'room_error', code: 'room_not_found' });
          done();
        }
      }, this.joinTimeoutMs);

      ch.postMessage({
        kind: 'join_request',
        requesterId: this.clientId,
        displayName: params.displayName,
      } satisfies WireMessage);
    });
  }

  private settlePendingJoin(): void {
    if (this.pendingJoinTimeout) {
      clearTimeout(this.pendingJoinTimeout);
      this.pendingJoinTimeout = null;
    }
    const resolve = this.pendingJoinResolve;
    this.pendingJoinResolve = null;
    resolve?.();
  }

  private isAuthorizedPeer(senderId: string): boolean {
    if (senderId === this.clientId) return false;
    return (
      senderId === this.hostParticipant?.id || senderId === this.guestParticipant?.id
    );
  }

  private handleWireMessage(msg: WireMessage): void {
    if (!msg || typeof msg !== 'object') return;

    if (msg.kind === 'join_request') {
      // Only the Host authority handles join requests
      if (this.localParticipant?.role !== 'host' || !this.roomCode || !this.channel) {
        return;
      }

      if (Date.now() >= this.expiresAt) {
        this.channel.postMessage({
          kind: 'join_rejected',
          targetId: msg.requesterId,
          code: 'room_expired',
        } satisfies WireMessage);
        return;
      }

      if (this.guestParticipant !== null) {
        // Strict 1:1 limit: reject without leaking any messages or participant info
        this.channel.postMessage({
          kind: 'join_rejected',
          targetId: msg.requesterId,
          code: 'room_full',
        } satisfies WireMessage);
        return;
      }

      const guest: Participant = {
        id: msg.requesterId,
        displayName: msg.displayName,
        role: 'guest',
        online: true,
      };
      this.guestParticipant = guest;
      const participants = this.getParticipants();

      this.channel.postMessage({
        kind: 'join_accepted',
        targetId: msg.requesterId,
        roomCode: this.roomCode,
        participant: guest,
        participants,
        mode: this.mode,
        onionAddress: this.onionAddress,
        expiresAt: this.expiresAt,
        inactivityDurationMs: this.inactivityDurationMs,
      } satisfies WireMessage);

      this.emit({
        type: 'participant_joined',
        participant: guest,
        participants,
      });
      return;
    }

    if (msg.kind === 'join_accepted') {
      if (msg.targetId !== this.clientId || !this.pendingJoinResolve) return;
      this.localParticipant = msg.participant;
      this.hostParticipant = msg.participants.find((p) => p.role === 'host') ?? null;
      this.guestParticipant = msg.participants.find((p) => p.role === 'guest') ?? null;
      this.mode = msg.mode;
      this.onionAddress = msg.onionAddress;
      this.expiresAt = msg.expiresAt;
      this.inactivityDurationMs = msg.inactivityDurationMs;
      this.settlePendingJoin();

      this.emit({
        type: 'room_joined',
        roomCode: msg.roomCode,
        participant: msg.participant,
        participants: msg.participants,
        mode: msg.mode,
        onionAddress: msg.onionAddress,
        expiresAt: msg.expiresAt,
      });
      return;
    }

    if (msg.kind === 'join_rejected') {
      if (msg.targetId !== this.clientId || !this.pendingJoinResolve) return;
      const resolve = this.pendingJoinResolve;
      this.resetRoomState();
      this.emit({ type: 'room_error', code: msg.code });
      resolve();
      return;
    }

    // Ignore all subsequent room traffic unless sender is an authorized participant
    if (!this.localParticipant || !this.isAuthorizedPeer(msg.senderId)) {
      return;
    }

    switch (msg.kind) {
      case 'participant_left': {
        if (msg.senderId === this.hostParticipant?.id) {
          this.resetRoomState();
          this.emit({ type: 'room_expired' });
          return;
        }
        if (msg.senderId === this.guestParticipant?.id) {
          this.guestParticipant = null;
          this.emit({
            type: 'participant_left',
            participantId: msg.senderId,
            participants: this.getParticipants(),
          });
        }
        break;
      }
      case 'room_expired': {
        this.resetRoomState();
        this.emit({ type: 'room_expired' });
        break;
      }
      case 'encrypted_message': {
        this.emit({ type: 'encrypted_message', envelope: msg.envelope });
        break;
      }
      case 'key_exchange': {
        this.emit({
          type: 'key_exchange',
          senderId: msg.senderId,
          publicKeyJwk: msg.publicKeyJwk,
          hasSecret: msg.hasSecret,
        });
        break;
      }
      case 'typing': {
        this.emit({
          type: 'typing',
          participantId: msg.senderId,
          isTyping: msg.isTyping,
        });
        break;
      }
      case 'call_signal': {
        this.emit({ type: 'call_signal', signal: msg.signal });
        break;
      }
      case 'activity_reset': {
        this.expiresAt = msg.expiresAt;
        this.emit({ type: 'activity_reset', expiresAt: msg.expiresAt });
        break;
      }
    }
  }

  async leaveRoom(): Promise<void> {
    if (this.channel && this.localParticipant) {
      this.channel.postMessage({
        kind: 'participant_left',
        senderId: this.localParticipant.id,
      } satisfies WireMessage);
    }
    this.resetRoomState();
  }

  async expireRoom(): Promise<void> {
    if (this.channel && this.localParticipant) {
      this.channel.postMessage({
        kind: 'room_expired',
        senderId: this.localParticipant.id,
      } satisfies WireMessage);
    }
    this.resetRoomState();
  }

  async sendEncryptedMessage(envelope: EncryptedEnvelope): Promise<void> {
    if (!this.channel || !this.localParticipant) return;
    this.channel.postMessage({
      kind: 'encrypted_message',
      senderId: this.localParticipant.id,
      envelope,
    } satisfies WireMessage);
  }

  async sendKeyExchange(publicKeyJwk: JsonWebKey, options?: { hasSecret?: boolean }): Promise<void> {
    if (!this.channel || !this.localParticipant) return;
    this.channel.postMessage({
      kind: 'key_exchange',
      senderId: this.localParticipant.id,
      publicKeyJwk,
      hasSecret: options?.hasSecret,
    } satisfies WireMessage);
  }

  async setTyping(isTyping: boolean): Promise<void> {
    if (!this.channel || !this.localParticipant) return;
    this.channel.postMessage({
      kind: 'typing',
      senderId: this.localParticipant.id,
      isTyping,
    } satisfies WireMessage);
  }

  async sendCallSignal(signal: CallSignal): Promise<void> {
    if (!this.channel || !this.localParticipant) return;
    this.channel.postMessage({
      kind: 'call_signal',
      senderId: this.localParticipant.id,
      signal,
    } satisfies WireMessage);
  }

  async notifyActivity(): Promise<void> {
    if (!this.channel || !this.localParticipant) return;
    this.expiresAt = Date.now() + this.inactivityDurationMs;
    this.channel.postMessage({
      kind: 'activity_reset',
      senderId: this.localParticipant.id,
      expiresAt: this.expiresAt,
    } satisfies WireMessage);
    this.emit({ type: 'activity_reset', expiresAt: this.expiresAt });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.leaveRoom();
    this.listeners.clear();
  }
}
