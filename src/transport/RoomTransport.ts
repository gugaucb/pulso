import type {
  CallSignal,
  EncryptedEnvelope,
  RoomMode,
  TransportEvent,
} from '../domain/types';

export interface CreateRoomParams {
  roomCode: string;
  displayName: string;
  mode: RoomMode;
  onionAddress?: string;
  inactivityDurationMs?: number;
}

export interface JoinRoomParams {
  roomCode: string;
  displayName: string;
}

export interface RoomTransport {
  createRoom(params: CreateRoomParams): Promise<void>;
  joinRoom(params: JoinRoomParams): Promise<void>;
  leaveRoom(): Promise<void>;
  sendEncryptedMessage(envelope: EncryptedEnvelope): Promise<void>;
  sendKeyExchange(publicKeyJwk: JsonWebKey): Promise<void>;
  setTyping(isTyping: boolean): Promise<void>;
  sendCallSignal(signal: CallSignal): Promise<void>;
  notifyActivity(): Promise<void>;
  subscribe(listener: (event: TransportEvent) => void): () => void;
  dispose(): void;
}
