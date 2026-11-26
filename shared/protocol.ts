export const WS_PROTOCOL_VERSION = 1 as const;

export type RoomMode = 'normal' | 'tor';

export type ParticipantRole = 'host' | 'guest';

export interface Participant {
  id: string;
  displayName: string;
  role: ParticipantRole;
  online: boolean;
  videoEnabled?: boolean;
}

/**
 * Encrypted envelope transmitted over the WebSocket relay.
 * Intentionally omits plaintext displayName to minimize relay-observable metadata.
 */
export interface WireEncryptedEnvelope {
  version: number;
  roomCode: string;
  senderId: string;
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

export interface CallSignal {
  type: 'offer' | 'answer' | 'ice' | 'media_state' | 'hangup';
  fromId: string;
  payload?: unknown;
}

export interface RuntimeInfo {
  runtimeMode: 'normal' | 'tor';
  onionAddress?: string;
  torStatus?: 'bootstrapping' | 'ready' | 'error';
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type RoomExpiryReason = 'inactivity' | 'hard_ttl' | 'host_left' | 'grace_timeout';

/**
 * Structural subset of Web Crypto JsonWebKey compatible with both Node and DOM TypeScript libs.
 */
export interface PublicKeyJwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  ext?: boolean;
  key_ops?: string[];
  alg?: string;
  use?: string;
}

export type ClientWsMessage =
  | {
      type: 'create_room';
      version: number;
      roomCode: string;
      displayName: string;
      mode: RoomMode;
      onionAddress?: string;
      inactivityDurationMs?: number;
    }
  | {
      type: 'join_room';
      version: number;
      roomCode: string;
      displayName: string;
    }
  | {
      type: 'reconnect_room';
      version: number;
      roomCode: string;
      sessionToken: string;
    }
  | {
      type: 'leave_room';
      version: number;
    }
  | {
      type: 'encrypted_message';
      version: number;
      envelope: WireEncryptedEnvelope;
    }
  | {
      type: 'key_exchange';
      version: number;
      publicKeyJwk: PublicKeyJwk;
      hasSecret?: boolean;
    }
  | {
      type: 'typing';
      version: number;
      isTyping: boolean;
    }
  | {
      type: 'call_signal';
      version: number;
      signal: CallSignal;
    }
  | {
      type: 'notify_activity';
      version: number;
    };

export type ServerWsMessage =
  | {
      type: 'room_joined';
      version: number;
      roomCode: string;
      participant: Participant;
      participants: Participant[];
      mode: RoomMode;
      onionAddress?: string;
      expiresAt: number;
      sessionToken?: string;
      iceServers?: IceServerConfig[];
    }
  | {
      type: 'participant_joined';
      version: number;
      participant: Participant;
      participants: Participant[];
    }
  | {
      type: 'participant_left';
      version: number;
      participantId: string;
      participants: Participant[];
    }
  | {
      type: 'encrypted_message';
      version: number;
      envelope: WireEncryptedEnvelope;
    }
  | {
      type: 'key_exchange';
      version: number;
      senderId: string;
      publicKeyJwk: PublicKeyJwk;
      hasSecret?: boolean;
    }
  | {
      type: 'typing';
      version: number;
      participantId: string;
      isTyping: boolean;
    }
  | {
      type: 'call_signal';
      version: number;
      signal: CallSignal;
    }
  | {
      type: 'activity_reset';
      version: number;
      expiresAt: number;
    }
  | {
      type: 'room_expired';
      version: number;
      reason?: RoomExpiryReason;
    }
  | {
      type: 'room_error';
      version: number;
      code: RoomErrorCode;
      message?: string;
    }
  | {
      type: 'reconnecting';
      version: number;
      participantId?: string;
    }
  | {
      type: 'reconnected';
      version: number;
      roomCode: string;
      participant: Participant;
      participants: Participant[];
      mode: RoomMode;
      onionAddress?: string;
      expiresAt: number;
      iceServers?: IceServerConfig[];
    };
