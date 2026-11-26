export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 8;
const VALID_ROOM_CODE_REGEX = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * Strips separators/non-alphanumeric characters and converts to uppercase.
 */
export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Formats an input string into up to XXXX-XXXX uppercase representation.
 */
export function formatRoomCode(raw: string): string {
  const clean = normalizeRoomCode(raw).slice(0, ROOM_CODE_LENGTH);
  if (clean.length <= 4) {
    return clean;
  }
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

/**
 * Checks whether the given code has exactly 8 characters from the unambiguous alphabet.
 */
export function isValidRoomCode(raw: string): boolean {
  return VALID_ROOM_CODE_REGEX.test(normalizeRoomCode(raw));
}

/**
 * Generates a cryptographically random 8-character Room Code formatted as XXXX-XXXX.
 */
export function generateRoomCode(): string {
  const alphabetLen = ROOM_CODE_ALPHABET.length;
  // Rejection threshold prevents modulo bias over 256 possible byte values
  const maxValidByte = Math.floor(256 / alphabetLen) * alphabetLen;
  const chars: string[] = [];
  const buf = new Uint8Array(16);

  while (chars.length < ROOM_CODE_LENGTH) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && chars.length < ROOM_CODE_LENGTH; i++) {
      if (buf[i] < maxValidByte) {
        chars.push(ROOM_CODE_ALPHABET[buf[i] % alphabetLen]);
      }
    }
  }

  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}
