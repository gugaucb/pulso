import type {
  CallSignal,
  IceServerConfig,
  Participant,
  ParticipantRole,
  RoomErrorCode,
  RoomExpiryReason,
  RoomMode,
  RuntimeInfo,
  WireEncryptedEnvelope,
} from '../../shared/protocol';

export type {
  CallSignal,
  IceServerConfig,
  Participant,
  ParticipantRole,
  RoomErrorCode,
  RoomExpiryReason,
  RoomMode,
  RuntimeInfo,
  WireEncryptedEnvelope,
};

export interface EphemeralMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: ParticipantRole;
  text: string;
  createdAt: number;
}

export type EncryptedEnvelope = WireEncryptedEnvelope;

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'expired'
  | 'error';

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
      iceServers?: IceServerConfig[];
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
      hasSecret?: boolean;
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
      reason?: RoomExpiryReason;
    }
  | {
      type: 'room_error';
      code: RoomErrorCode;
      message?: string;
    }
  | {
      type: 'reconnecting';
      participantId?: string;
    }
  | {
      type: 'reconnected';
      roomCode: string;
      participant: Participant;
      participants: Participant[];
      mode: RoomMode;
      onionAddress?: string;
      expiresAt: number;
      iceServers?: IceServerConfig[];
    }
  | {
      type: 'participant_reconnected';
      participant: Participant;
      participants: Participant[];
    };
