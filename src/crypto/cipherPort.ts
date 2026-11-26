import type { EncryptedEnvelope, ParticipantRole } from '../domain/types';

export interface E2eeEncryptContext {
  roomCode: string;
  senderId: string;
  senderName: string;
  senderRole: ParticipantRole;
}

export interface E2eeSession {
  encrypt(plaintext: string, context: E2eeEncryptContext): Promise<EncryptedEnvelope>;
  decrypt(envelope: EncryptedEnvelope): Promise<string>;
  destroy(): void;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Lightweight Day-1 codec implementing the E2eeSession boundary so RoomTransport
 * carries EncryptedEnvelope payloads from the tracer bullet onward.
 * Ticket 03 replaces this session implementation with ECDH P-256 + HKDF + AES-256-GCM.
 */
export function createCodecE2eeSession(): E2eeSession {
  let seq = 0;
  let destroyed = false;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return {
    async encrypt(plaintext, context) {
      if (destroyed) {
        throw new Error('E2EE session has been destroyed');
      }
      seq += 1;
      const ivBytes = new Uint8Array(12);
      crypto.getRandomValues(ivBytes);
      const payloadBytes = encoder.encode(plaintext);

      return {
        version: 1,
        roomCode: context.roomCode,
        senderId: context.senderId,
        senderName: context.senderName,
        senderRole: context.senderRole,
        seq,
        iv: bytesToBase64(ivBytes),
        ciphertext: bytesToBase64(payloadBytes),
        sentAt: Date.now(),
      };
    },

    async decrypt(envelope) {
      if (destroyed) {
        throw new Error('E2EE session has been destroyed');
      }
      const bytes = base64ToBytes(envelope.ciphertext);
      return decoder.decode(bytes);
    },

    destroy() {
      destroyed = true;
      seq = 0;
    },
  };
}
