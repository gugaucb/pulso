import type { EncryptedEnvelope, ParticipantRole } from '../domain/types';

export interface E2eeEncryptContext {
  roomCode: string;
  senderId: string;
  senderName: string;
  senderRole: ParticipantRole;
}

export interface CreateE2eeSessionOptions {
  role: ParticipantRole;
  roomCode: string;
  secretKey?: string;
}

export interface KeyExchangeCompletionOptions {
  useSecretKey?: boolean;
}

export interface E2eeSession {
  init(): Promise<JsonWebKey>;
  completeKeyExchange(
    peerPublicKeyJwk: JsonWebKey,
    options?: KeyExchangeCompletionOptions,
  ): Promise<string>;
  isReady(): boolean;
  getSasCode(): string | null;
  encrypt(plaintext: string, context: E2eeEncryptContext): Promise<EncryptedEnvelope>;
  decrypt(envelope: EncryptedEnvelope): Promise<string>;
  destroy(): void;
}

export { createE2eeSession } from './e2eeSession';
