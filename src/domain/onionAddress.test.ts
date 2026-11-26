import { describe, expect, it } from 'vitest';
import {
  formatOnionHost,
  generateOnionAddress,
  isValidV3OnionAddress,
  normalizeOnionAddress,
} from './onionAddress';

describe('onionAddress domain utilities', () => {
  it('generates valid 56-character base32 v3 .onion URLs', () => {
    const first = generateOnionAddress();
    const second = generateOnionAddress();

    expect(first).toMatch(/^http:\/\/[a-z2-7]{56}\.onion$/);
    expect(second).toMatch(/^http:\/\/[a-z2-7]{56}\.onion$/);
    expect(first).not.toBe(second);
    expect(isValidV3OnionAddress(first)).toBe(true);
    expect(formatOnionHost(first)).toMatch(/^[a-z2-7]{56}\.onion$/);
  });

  it('normalizes bare and mixed-case v3 .onion addresses and rejects invalid ones', () => {
    const bare = `${'a'.repeat(56)}.ONION`;
    const normalized = normalizeOnionAddress(bare);

    expect(normalized).toBe(`http://${'a'.repeat(56)}.onion`);
    expect(isValidV3OnionAddress(bare)).toBe(true);

    expect(normalizeOnionAddress('http://short.onion')).toBeNull();
    expect(normalizeOnionAddress('https://example.com')).toBeNull();
    expect(isValidV3OnionAddress(`http://${'0'.repeat(56)}.onion`)).toBe(false);
    expect(isValidV3OnionAddress(`http://${'a'.repeat(55)}.onion`)).toBe(false);
  });
});
