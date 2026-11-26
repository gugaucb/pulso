import {
  WS_PROTOCOL_VERSION,
  type ClientWsMessage,
  type ServerWsMessage,
  type WireEncryptedEnvelope,
} from '../../shared/protocol';
import { formatRoomCode, isValidRoomCode } from '../domain/roomCode';
import type {
  CallSignal,
  EncryptedEnvelope,
  TransportEvent,
} from '../domain/types';
import type { CreateRoomParams, JoinRoomParams, RoomTransport } from './RoomTransport';

const WS_READY_STATE_CONNECTING = 0;
const WS_READY_STATE_OPEN = 1;
const DEFAULT_RECONNECT_WINDOW_MS = 30_000;
const DEFAULT_RECONNECT_BACKOFF_BASE_MS = 300;
const DEFAULT_RECONNECT_BACKOFF_MAX_MS = 5_000;

export interface WebSocketMessageEventLike {
  data: unknown;
}

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: WebSocketMessageEventLike) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  removeEventListener(type: 'open', listener: () => void): void;
  removeEventListener(type: 'message', listener: (event: WebSocketMessageEventLike) => void): void;
  removeEventListener(type: 'close', listener: () => void): void;
  removeEventListener(type: 'error', listener: () => void): void;
}

export interface WebSocketTransportOptions {
  url?: string;
  webSocketFactory?: (url: string) => WebSocketLike;
  reconnectWindowMs?: number;
  reconnectBackoffBaseMs?: number;
  reconnectBackoffMaxMs?: number;
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  return new globalThis.WebSocket(url) as unknown as WebSocketLike;
}

function resolveDefaultWsUrl(): string {
  if (typeof window !== 'undefined' && window.location?.host) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }
  return 'ws://127.0.0.1:3001/ws';
}

function toWireEnvelope(envelope: EncryptedEnvelope): WireEncryptedEnvelope {
  return {
    version: envelope.version,
    roomCode: envelope.roomCode,
    senderId: envelope.senderId,
    senderRole: envelope.senderRole,
    seq: envelope.seq,
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
    sentAt: envelope.sentAt,
  };
}

/**
 * Same-origin WebSocket RoomTransport adapter.
 * Holds any sessionToken strictly in RAM and handles React StrictMode cleanups safely.
 */
export class WebSocketTransport implements RoomTransport {
  private readonly configuredUrl?: string;
  private readonly webSocketFactory: (url: string) => WebSocketLike;
  private readonly reconnectWindowMs: number;
  private readonly reconnectBackoffBaseMs: number;
  private readonly reconnectBackoffMaxMs: number;
  private readonly listeners = new Set<(event: TransportEvent) => void>();

  private socket: WebSocketLike | null = null;
  private socketCleanup: (() => void) | null = null;
  private inRoom = false;
  private connectGen = 0;
  private pendingJoinResolve: (() => void) | null = null;
  private disposed = false;

  // Ephemeral session credentials held strictly in RAM for 30s silent reconnect
  private activeRoomCode: string | null = null;
  private sessionToken: string | null = null;
  private explicitLeave = false;
  private reconnecting = false;
  private reconnectDeadlineMs: number | null = null;
  private reconnectAttempt = 0;
  private reconnectRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDeadlineTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: WebSocketTransportOptions = {}) {
    this.configuredUrl = options.url;
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.reconnectWindowMs = options.reconnectWindowMs ?? DEFAULT_RECONNECT_WINDOW_MS;
    this.reconnectBackoffBaseMs = options.reconnectBackoffBaseMs ?? DEFAULT_RECONNECT_BACKOFF_BASE_MS;
    this.reconnectBackoffMaxMs = options.reconnectBackoffMaxMs ?? DEFAULT_RECONNECT_BACKOFF_MAX_MS;
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

  private settlePendingJoin(): void {
    const resolve = this.pendingJoinResolve;
    this.pendingJoinResolve = null;
    resolve?.();
  }

  private clearReconnectTimers(): void {
    if (this.reconnectRetryTimer !== null) {
      clearTimeout(this.reconnectRetryTimer);
      this.reconnectRetryTimer = null;
    }
    if (this.reconnectDeadlineTimer !== null) {
      clearTimeout(this.reconnectDeadlineTimer);
      this.reconnectDeadlineTimer = null;
    }
  }

  private clearReconnectState(): void {
    this.clearReconnectTimers();
    this.reconnecting = false;
    this.reconnectDeadlineMs = null;
    this.reconnectAttempt = 0;
  }

  private clearSessionCredentials(): void {
    this.activeRoomCode = null;
    this.sessionToken = null;
  }

  private closeCurrentSocket(): void {
    const ws = this.socket;
    const cleanup = this.socketCleanup;
    this.socket = null;
    this.socketCleanup = null;
    cleanup?.();

    if (!ws) return;

    if (ws.readyState === WS_READY_STATE_CONNECTING) {
      // Wait for open before closing to avoid half-open socket errors/leaks under StrictMode
      const onError = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
      };
      const onOpen = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        try {
          ws.close(1000, 'Aborted');
        } catch {
          // Ignore close errors during abort
        }
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      return;
    }

    if (ws.readyState === WS_READY_STATE_OPEN) {
      try {
        ws.close(1000, 'Closed');
      } catch {
        // Ignore close errors
      }
    }
  }

  private sendClientMessage(message: ClientWsMessage): void {
    if (!this.socket || this.socket.readyState !== WS_READY_STATE_OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private handleReconnectWindowExpired(): void {
    if (!this.reconnecting || this.disposed || this.explicitLeave) return;
    this.clearReconnectState();
    this.clearSessionCredentials();
    this.inRoom = false;
    this.connectGen += 1;
    this.closeCurrentSocket();
    this.emit({ type: 'room_expired', reason: 'grace_timeout' });
  }

  private scheduleNextReconnectAttempt(): void {
    if (
      !this.reconnecting ||
      this.disposed ||
      this.explicitLeave ||
      !this.activeRoomCode ||
      !this.sessionToken
    ) {
      return;
    }
    if (this.reconnectRetryTimer !== null) {
      clearTimeout(this.reconnectRetryTimer);
      this.reconnectRetryTimer = null;
    }
    const remaining = (this.reconnectDeadlineMs ?? 0) - Date.now();
    if (remaining <= 0) {
      this.handleReconnectWindowExpired();
      return;
    }
    const backoff = Math.min(
      this.reconnectBackoffBaseMs * Math.pow(2, this.reconnectAttempt),
      this.reconnectBackoffMaxMs,
    );
    const delay = Math.min(backoff, remaining);
    this.reconnectAttempt += 1;
    this.reconnectRetryTimer = setTimeout(() => {
      this.reconnectRetryTimer = null;
      this.attemptReconnect();
    }, delay);
  }

  private attemptReconnect(): void {
    if (
      !this.reconnecting ||
      this.disposed ||
      this.explicitLeave ||
      !this.activeRoomCode ||
      !this.sessionToken
    ) {
      return;
    }
    void this.openSocketAndSend(
      {
        type: 'reconnect_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: this.activeRoomCode,
        sessionToken: this.sessionToken,
      },
      false,
    );
  }

  private openSocketAndSend(
    initialMessage: ClientWsMessage,
    awaitReady: boolean,
  ): Promise<void> {
    this.connectGen += 1;
    const gen = this.connectGen;
    this.settlePendingJoin();
    this.inRoom = false;
    this.closeCurrentSocket();

    const url = this.configuredUrl ?? resolveDefaultWsUrl();
    const ws = this.webSocketFactory(url);
    this.socket = ws;

    return new Promise<void>((resolve) => {
      if (awaitReady) {
        this.pendingJoinResolve = resolve;
      } else {
        resolve();
      }
      let failed = false;

      const detach = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('message', onMessage);
        ws.removeEventListener('close', onClose);
        ws.removeEventListener('error', onError);
      };

      const handleFailure = () => {
        if (failed || this.connectGen !== gen || this.socket !== ws) return;
        failed = true;
        const wasInRoom = this.inRoom;
        this.inRoom = false;
        this.socket = null;
        this.socketCleanup = null;
        detach();
        this.settlePendingJoin();

        if (this.disposed || this.explicitLeave) {
          return;
        }

        if ((wasInRoom || this.reconnecting) && this.activeRoomCode && this.sessionToken) {
          const startedReconnecting = !this.reconnecting;
          this.reconnecting = true;
          if (startedReconnecting) {
            this.reconnectDeadlineMs = Date.now() + this.reconnectWindowMs;
            this.reconnectAttempt = 0;
            this.reconnectDeadlineTimer = setTimeout(() => {
              this.handleReconnectWindowExpired();
            }, this.reconnectWindowMs);
            this.emit({ type: 'reconnecting' });
          }
          this.scheduleNextReconnectAttempt();
          return;
        }

        this.clearReconnectState();
        this.clearSessionCredentials();
        this.emit({ type: 'room_error', code: 'transport_error' });
      };

      const onOpen = () => {
        if (this.connectGen !== gen || this.socket !== ws) return;
        ws.send(JSON.stringify(initialMessage));
      };

      const onMessage = (event: WebSocketMessageEventLike) => {
        if (this.connectGen !== gen || this.socket !== ws) return;
        this.handleRawServerMessage(event.data);
      };

      const onClose = () => {
        handleFailure();
      };

      const onError = () => {
        handleFailure();
      };

      this.socketCleanup = detach;
      ws.addEventListener('open', onOpen);
      ws.addEventListener('message', onMessage);
      ws.addEventListener('close', onClose);
      ws.addEventListener('error', onError);

      if (ws.readyState === WS_READY_STATE_OPEN) {
        onOpen();
      }
    });
  }

  private handleRawServerMessage(rawData: unknown): void {
    if (typeof rawData !== 'string') return;

    let msg: ServerWsMessage;
    try {
      msg = JSON.parse(rawData) as ServerWsMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'room_joined': {
        this.inRoom = true;
        this.activeRoomCode = msg.roomCode;
        this.sessionToken = msg.sessionToken ?? null;
        this.clearReconnectState();
        this.settlePendingJoin();
        this.emit({
          type: 'room_joined',
          roomCode: msg.roomCode,
          participant: msg.participant,
          participants: msg.participants,
          mode: msg.mode,
          onionAddress: msg.onionAddress,
          expiresAt: msg.expiresAt,
          iceServers: msg.iceServers,
        });
        break;
      }
      case 'reconnected': {
        this.inRoom = true;
        this.activeRoomCode = msg.roomCode;
        this.clearReconnectState();
        this.settlePendingJoin();
        this.emit({
          type: 'reconnected',
          roomCode: msg.roomCode,
          participant: msg.participant,
          participants: msg.participants,
          mode: msg.mode,
          onionAddress: msg.onionAddress,
          expiresAt: msg.expiresAt,
          iceServers: msg.iceServers,
        });
        break;
      }
      case 'reconnecting': {
        this.emit({
          type: 'reconnecting',
          participantId: msg.participantId,
        });
        break;
      }
      case 'participant_reconnected': {
        this.emit({
          type: 'participant_reconnected',
          participant: msg.participant,
          participants: msg.participants,
        });
        break;
      }
      case 'participant_joined': {
        this.emit({
          type: 'participant_joined',
          participant: msg.participant,
          participants: msg.participants,
        });
        break;
      }
      case 'participant_left': {
        this.emit({
          type: 'participant_left',
          participantId: msg.participantId,
          participants: msg.participants,
        });
        break;
      }
      case 'encrypted_message': {
        this.emit({
          type: 'encrypted_message',
          envelope: toWireEnvelope(msg.envelope),
        });
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
          participantId: msg.participantId,
          isTyping: msg.isTyping,
        });
        break;
      }
      case 'call_signal': {
        this.emit({
          type: 'call_signal',
          signal: msg.signal,
        });
        break;
      }
      case 'activity_reset': {
        this.emit({
          type: 'activity_reset',
          expiresAt: msg.expiresAt,
        });
        break;
      }
      case 'room_expired': {
        this.inRoom = false;
        this.clearReconnectState();
        this.clearSessionCredentials();
        this.settlePendingJoin();
        this.closeCurrentSocket();
        this.emit({ type: 'room_expired', reason: msg.reason });
        break;
      }
      case 'room_error': {
        const isFatal =
          msg.code === 'room_not_found' ||
          msg.code === 'room_expired' ||
          msg.code === 'invalid_code' ||
          msg.code === 'room_full';

        if (!this.inRoom) {
          this.closeCurrentSocket();
        }
        if (this.reconnecting && !isFatal) {
          this.scheduleNextReconnectAttempt();
          return;
        }
        if (isFatal || !this.inRoom) {
          this.inRoom = false;
          this.clearReconnectState();
          this.clearSessionCredentials();
        }
        this.settlePendingJoin();
        this.emit({
          type: 'room_error',
          code: msg.code,
          message: msg.message,
        });
        break;
      }
    }
  }

  async createRoom(params: CreateRoomParams): Promise<void> {
    if (this.disposed) return;
    if (!isValidRoomCode(params.roomCode)) {
      this.emit({ type: 'room_error', code: 'invalid_code' });
      return;
    }

    this.explicitLeave = false;
    this.clearReconnectState();
    this.clearSessionCredentials();

    await this.openSocketAndSend(
      {
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: formatRoomCode(params.roomCode),
        displayName: params.displayName,
        mode: params.mode,
        ...(params.onionAddress ? { onionAddress: params.onionAddress } : {}),
        ...(params.inactivityDurationMs !== undefined
          ? { inactivityDurationMs: params.inactivityDurationMs }
          : {}),
      },
      true,
    );
  }

  async joinRoom(params: JoinRoomParams): Promise<void> {
    if (this.disposed) return;
    if (!isValidRoomCode(params.roomCode)) {
      this.emit({ type: 'room_error', code: 'invalid_code' });
      return;
    }

    this.explicitLeave = false;
    this.clearReconnectState();
    this.clearSessionCredentials();

    await this.openSocketAndSend(
      {
        type: 'join_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: formatRoomCode(params.roomCode),
        displayName: params.displayName,
      },
      true,
    );
  }

  async leaveRoom(): Promise<void> {
    this.explicitLeave = true;
    this.connectGen += 1;
    this.clearReconnectState();
    this.settlePendingJoin();
    if (this.inRoom) {
      this.sendClientMessage({
        type: 'leave_room',
        version: WS_PROTOCOL_VERSION,
      });
    }
    this.inRoom = false;
    this.clearSessionCredentials();
    this.closeCurrentSocket();
  }

  async sendEncryptedMessage(envelope: EncryptedEnvelope): Promise<void> {
    if (this.disposed || !this.inRoom) return;
    this.sendClientMessage({
      type: 'encrypted_message',
      version: WS_PROTOCOL_VERSION,
      envelope: toWireEnvelope(envelope),
    });
  }

  async sendKeyExchange(
    publicKeyJwk: JsonWebKey,
    options?: { hasSecret?: boolean },
  ): Promise<void> {
    if (this.disposed || !this.inRoom) return;
    this.sendClientMessage({
      type: 'key_exchange',
      version: WS_PROTOCOL_VERSION,
      publicKeyJwk,
      ...(options?.hasSecret !== undefined ? { hasSecret: options.hasSecret } : {}),
    });
  }

  async setTyping(isTyping: boolean): Promise<void> {
    if (this.disposed || !this.inRoom) return;
    this.sendClientMessage({
      type: 'typing',
      version: WS_PROTOCOL_VERSION,
      isTyping,
    });
  }

  async sendCallSignal(signal: CallSignal): Promise<void> {
    if (this.disposed || !this.inRoom) return;
    this.sendClientMessage({
      type: 'call_signal',
      version: WS_PROTOCOL_VERSION,
      signal,
    });
  }

  async notifyActivity(): Promise<void> {
    if (this.disposed || !this.inRoom) return;
    this.sendClientMessage({
      type: 'notify_activity',
      version: WS_PROTOCOL_VERSION,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.leaveRoom();
    this.listeners.clear();
  }
}
