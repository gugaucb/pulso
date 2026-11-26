export type RoomMode = 'normal' | 'tor';

export type ParticipantRole = 'host' | 'guest';

export interface Participant {
  id: string;
  displayName: string;
  role: ParticipantRole;
  online: boolean;
  videoEnabled?: boolean;
}

export interface EphemeralMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: ParticipantRole;
  text: string;
  createdAt: number;
}

export interface EncryptedEnvelope {
  version: number;
  roomCode: string;
  senderId: string;
  senderName: string;
  senderRole: ParticipantRole;
  seq: number;
  iv: string;
  ciphertext: string;
  sentAt: number;
}

export type RoomErrorCode =
  | 'invalid_code'
  | 'room_not_found'
  | 'room_full'
  | 'room_expired'
  | 'transport_error';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'connected'
  | 'disconnected'
  | 'expired'
  | 'error';

export interface CallSignal {
  type: 'offer' | 'answer' | 'ice' | 'media_state' | 'hangup';
  fromId: string;
  payload?: unknown;
}

export type CallLayout = 'hybrid' | 'pip' | 'focus';

export type Locale = 'pt-br' | 'en' | 'es' | 'zh-CN';

export type Theme = 'light' | 'dark';

export type TransportEvent =
  | {
      type: 'room_joined';
      roomCode: string;
      participant: Participant;
      participants: Participant[];
      mode: RoomMode;
      onionAddress?: string;
      expiresAt: number;
    }
  | {
      type: 'participant_joined';
      participant: Participant;
      participants: Participant[];
    }
  | {
      type: 'participant_left';
      participantId: string;
      participants: Participant[];
    }
  | {
      type: 'encrypted_message';
      envelope: EncryptedEnvelope;
    }
  | {
      type: 'key_exchange';
      senderId: string;
      publicKeyJwk: JsonWebKey;
    }
  | {
      type: 'typing';
      participantId: string;
      isTyping: boolean;
    }
  | {
      type: 'call_signal';
      signal: CallSignal;
    }
  | {
      type: 'activity_reset';
      expiresAt: number;
    }
  | {
      type: 'room_expired';
    }
  | {
      type: 'room_error';
      code: RoomErrorCode;
      message?: string;
    };
