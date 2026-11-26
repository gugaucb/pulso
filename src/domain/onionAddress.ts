const ONION_BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const V3_ONION_HOST_LENGTH = 56;
const V3_ONION_HOST_REGEX = /^[a-z2-7]{56}\.onion$/;

/**
 * Generates a cryptographically random v3-format 56-character base32 `.onion` URL.
 */
export function generateOnionAddress(): string {
  const bytes = new Uint8Array(V3_ONION_HOST_LENGTH);
  crypto.getRandomValues(bytes);

  let host = '';
  for (let i = 0; i < V3_ONION_HOST_LENGTH; i++) {
    // 256 is an exact multiple of 32, so modulo 32 has zero bias
    host += ONION_BASE32_ALPHABET[bytes[i] & 31];
  }

  return `http://${host}.onion`;
}

/**
 * Normalizes a bare or HTTP(S) v3 `.onion` address to `http://<56-base32>.onion`, or returns null.
 */
export function normalizeOnionAddress(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  try {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const url = new URL(candidate);
    if (!V3_ONION_HOST_REGEX.test(url.hostname)) {
      return null;
    }
    return `http://${url.hostname}`;
  } catch {
    return null;
  }
}

/**
 * Checks whether a value is a valid v3 `.onion` address (with or without `http://`).
 */
export function isValidV3OnionAddress(raw: string): boolean {
  return normalizeOnionAddress(raw) !== null;
}

/**
 * Extracts the bare `<56-base32>.onion` hostname for compact display, or returns the original value.
 */
export function formatOnionHost(address: string): string {
  return address.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}
