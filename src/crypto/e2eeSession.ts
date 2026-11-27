import type { EncryptedEnvelope, ParticipantRole } from '../domain/types';
import type { CreateE2eeSessionOptions, E2eeSession } from './cipherPort';

const ECDH_PARAMS: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };
const ECDH_IMPORT_PARAMS: EcKeyImportParams = { name: 'ECDH', namedCurve: 'P-256' };
const PROTOCOL_VERSION = 1;
const HOST_DIR_ID = 1;
const GUEST_DIR_ID = 2;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Wraps a Uint8Array in a fresh native realm Uint8Array to avoid cross-realm
 * BufferSource TypeErrors when running Web Crypto inside Vitest jsdom + Node.
 */
function toNativeUint8Array(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
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

function decodeSecretKeyBytes(secretKey: string): Uint8Array {
  const normalized = secretKey.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(padded) && padded.length % 4 === 0) {
    try {
      return base64ToBytes(padded);
    } catch {
      // Fallback to UTF-8 bytes if not valid base64url
    }
  }
  return toNativeUint8Array(encoder.encode(secretKey));
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

function buildDeterministicIv(dirId: number, seq: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12);
  const view = new DataView(iv.buffer);
  view.setUint32(0, dirId, false);
  view.setBigUint64(4, BigInt(seq), false);
  return iv;
}

function directionLabel(role: ParticipantRole): string {
  return role === 'host' ? 'host-to-guest' : 'guest-to-host';
}

function directionId(role: ParticipantRole): number {
  return role === 'host' ? HOST_DIR_ID : GUEST_DIR_ID;
}

function buildAad(roomCode: string, role: ParticipantRole, seq: number): Uint8Array<ArrayBuffer> {
  return toNativeUint8Array(encoder.encode(`pulso-v1|${roomCode}|${directionLabel(role)}|${seq}`));
}

function formatSasCode(bytes: Uint8Array): string {
  const hex = Array.from(bytes.slice(0, 6), (b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

function getSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is unavailable in this context');
  }
  return subtle;
}

/**
 * Client-side E2EE session using native Web Crypto API:
 * ECDH P-256 (ephemeral, non-extractable private key) + HKDF-SHA256 + AES-256-GCM.
 */
export function createE2eeSession(options: CreateE2eeSessionOptions): E2eeSession {
  const { role, roomCode } = options;
  let secretKeyBytes: Uint8Array | null = options.secretKey
    ? decodeSecretKeyBytes(options.secretKey)
    : null;

  let keyPair: CryptoKeyPair | null = null;
  let localPublicKeyRaw: Uint8Array<ArrayBuffer> | null = null;
  let encryptKey: CryptoKey | null = null;
  let decryptKey: CryptoKey | null = null;
  let sasCode: string | null = null;
  let outgoingSeq = 0;
  let lastSeenIncomingSeq = 0;
  let destroyed = false;

  function ensureAlive(): void {
    if (destroyed) {
      throw new Error('E2EE session has been destroyed');
    }
  }

  return {
    async init(): Promise<JsonWebKey> {
      ensureAlive();
      const subtle = getSubtleCrypto();

      if (!keyPair) {
        const generated = await subtle.generateKey(ECDH_PARAMS, false, ['deriveBits']);
        if (destroyed) {
          throw new Error('E2EE session has been destroyed');
        }
        keyPair = generated;
        const rawBuf = await subtle.exportKey('raw', generated.publicKey);
        localPublicKeyRaw = toNativeUint8Array(new Uint8Array(rawBuf));
      }

      return subtle.exportKey('jwk', keyPair.publicKey);
    },

    async completeKeyExchange(peerPublicKeyJwk: JsonWebKey, exchangeOptions = {}): Promise<string> {
      ensureAlive();
      if (!keyPair || !localPublicKeyRaw) {
        await this.init();
      }
      ensureAlive();

      if (peerPublicKeyJwk.kty !== 'EC' || peerPublicKeyJwk.crv !== 'P-256') {
        throw new Error('Invalid peer ECDH public key JWK');
      }

      const subtle = getSubtleCrypto();
      const peerPublicKey = await subtle.importKey(
        'jwk',
        peerPublicKeyJwk,
        ECDH_IMPORT_PARAMS,
        true,
        [],
      );
      const peerRawBuf = await subtle.exportKey('raw', peerPublicKey);
      const peerPublicKeyRaw = toNativeUint8Array(new Uint8Array(peerRawBuf));

      const ecdhSharedBuf = await subtle.deriveBits(
        { name: 'ECDH', public: peerPublicKey },
        keyPair!.privateKey,
        256,
      );
      const ecdhBytes = toNativeUint8Array(new Uint8Array(ecdhSharedBuf));

      const useSecret = exchangeOptions.useSecretKey !== false;
      const ikm =
        useSecret && secretKeyBytes && secretKeyBytes.length > 0
          ? concatBytes(ecdhBytes, toNativeUint8Array(secretKeyBytes))
          : toNativeUint8Array(ecdhBytes);

      const hostPubRaw = role === 'host' ? localPublicKeyRaw! : peerPublicKeyRaw;
      const guestPubRaw = role === 'guest' ? localPublicKeyRaw! : peerPublicKeyRaw;
      const saltContext = toNativeUint8Array(encoder.encode(`pulso-e2ee-v1:${roomCode}|`));
      const salt = concatBytes(saltContext, hostPubRaw, guestPubRaw);

      try {
        const hkdfKey = await subtle.importKey('raw', ikm, 'HKDF', false, [
          'deriveKey',
          'deriveBits',
        ]);

        const hostToGuestInfo = toNativeUint8Array(encoder.encode('pulso-dir-host-to-guest'));
        const guestToHostInfo = toNativeUint8Array(encoder.encode('pulso-dir-guest-to-host'));
        const sasInfo = toNativeUint8Array(encoder.encode('pulso-sas-v1'));

        const hostToGuestKey = await subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt, info: hostToGuestInfo },
          hkdfKey,
          { name: 'AES-GCM', length: 256 },
          false,
          role === 'host' ? ['encrypt'] : ['decrypt'],
        );

        const guestToHostKey = await subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt, info: guestToHostInfo },
          hkdfKey,
          { name: 'AES-GCM', length: 256 },
          false,
          role === 'guest' ? ['encrypt'] : ['decrypt'],
        );

        const sasBits = await subtle.deriveBits(
          { name: 'HKDF', hash: 'SHA-256', salt, info: sasInfo },
          hkdfKey,
          48,
        );

        if (destroyed) {
          throw new Error('E2EE session has been destroyed');
        }

        encryptKey = role === 'host' ? hostToGuestKey : guestToHostKey;
        decryptKey = role === 'host' ? guestToHostKey : hostToGuestKey;
        sasCode = formatSasCode(new Uint8Array(sasBits));
        return sasCode;
      } finally {
        ecdhBytes.fill(0);
        ikm.fill(0);
        salt.fill(0);
      }
    },

    isReady(): boolean {
      return !destroyed && encryptKey !== null && decryptKey !== null && sasCode !== null;
    },

    getSasCode(): string | null {
      return destroyed ? null : sasCode;
    },

    async encrypt(plaintext, context): Promise<EncryptedEnvelope> {
      ensureAlive();
      if (!encryptKey) {
        throw new Error('E2EE key exchange is not complete');
      }
      if (context.roomCode !== roomCode || context.senderRole !== role) {
        throw new Error('Envelope context mismatch');
      }

      outgoingSeq += 1;
      const seq = outgoingSeq;
      const iv = buildDeterministicIv(directionId(role), seq);
      const aad = buildAad(roomCode, role, seq);
      const plaintextBytes = toNativeUint8Array(encoder.encode(plaintext));

      const subtle = getSubtleCrypto();
      const cipherBuf = await subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
        encryptKey,
        plaintextBytes,
      );

      return {
        version: PROTOCOL_VERSION,
        roomCode,
        senderId: context.senderId,
        senderRole: role,
        seq,
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
        sentAt: Date.now(),
      };
    },

    async decrypt(envelope): Promise<string> {
      ensureAlive();
      if (!decryptKey) {
        throw new Error('E2EE key exchange is not complete');
      }
      if (envelope.version !== PROTOCOL_VERSION) {
        throw new Error('Unsupported envelope version');
      }
      if (envelope.roomCode !== roomCode) {
        throw new Error('Room code mismatch');
      }
      const expectedPeerRole: ParticipantRole = role === 'host' ? 'guest' : 'host';
      if (envelope.senderRole !== expectedPeerRole) {
        throw new Error('Invalid sender role for incoming envelope');
      }
      if (!Number.isSafeInteger(envelope.seq) || envelope.seq < 1) {
        throw new Error('Invalid envelope sequence number');
      }
      if (envelope.seq <= lastSeenIncomingSeq) {
        throw new Error('Replay or out-of-order envelope rejected');
      }

      const expectedIv = buildDeterministicIv(directionId(expectedPeerRole), envelope.seq);
      if (envelope.iv !== bytesToBase64(expectedIv)) {
        throw new Error('Envelope IV mismatch');
      }

      const aad = buildAad(envelope.roomCode, expectedPeerRole, envelope.seq);
      const cipherBytes = toNativeUint8Array(base64ToBytes(envelope.ciphertext));

      const subtle = getSubtleCrypto();
      const plainBuf = await subtle.decrypt(
        { name: 'AES-GCM', iv: expectedIv, additionalData: aad, tagLength: 128 },
        decryptKey,
        cipherBytes,
      );

      // Advance monotonic counter ONLY after AES-GCM authentication succeeds
      lastSeenIncomingSeq = envelope.seq;
      return decoder.decode(plainBuf);
    },

    destroy(): void {
      destroyed = true;
      if (secretKeyBytes) {
        secretKeyBytes.fill(0);
        secretKeyBytes = null;
      }
      if (localPublicKeyRaw) {
        localPublicKeyRaw.fill(0);
        localPublicKeyRaw = null;
      }
      keyPair = null;
      encryptKey = null;
      decryptKey = null;
      sasCode = null;
      outgoingSeq = 0;
      lastSeenIncomingSeq = 0;
    },
  };
}
