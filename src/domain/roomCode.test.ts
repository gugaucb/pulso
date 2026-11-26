import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  formatRoomCode,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from './roomCode';

describe('roomCode domain utilities', () => {
  it('excludes visually ambiguous characters (0, O, 1, I, L) from the alphabet', () => {
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(ambiguous);
    }
    expect(ROOM_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  });

  it('generates valid XXXX-XXXX codes using only allowed characters', () => {
    for (let i = 0; i < 30; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('normalizes lowercase, spaces, and hyphens', () => {
    expect(normalizeRoomCode(' a7k9-m2p4 ')).toBe('A7K9M2P4');
    expect(normalizeRoomCode('x9k2p7m4')).toBe('X9K2P7M4');
    expect(formatRoomCode('a7k9m2p4')).toBe('A7K9-M2P4');
    expect(formatRoomCode('a7k9-m2p4-extra')).toBe('A7K9-M2P4');
    expect(formatRoomCode('a7k')).toBe('A7K');
  });

  it('validates room codes strictly against length and alphabet', () => {
    expect(isValidRoomCode('A7K9-M2P4')).toBe(true);
    expect(isValidRoomCode('a7k9m2p4')).toBe(true);
    expect(isValidRoomCode('A7K9-M2P')).toBe(false);
    expect(isValidRoomCode('A7K0-M2P4')).toBe(false); // 0 is ambiguous
    expect(isValidRoomCode('A7KO-M2P4')).toBe(false); // O is ambiguous
    expect(isValidRoomCode('A7K1-M2P4')).toBe(false); // 1 is ambiguous
    expect(isValidRoomCode('A7KI-M2P4')).toBe(false); // I is ambiguous
    expect(isValidRoomCode('A7KL-M2P4')).toBe(false); // L is ambiguous
  });
});
