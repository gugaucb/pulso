import { describe, expect, it } from 'vitest';
import {
  detectInitialLocale,
  formatRelativeTime,
  getDictionary,
  SUPPORTED_LOCALES,
} from './index';

describe('i18n core utilities', () => {
  it('detects supported locales from browser language preferences with pt-br fallback', () => {
    expect(detectInitialLocale(['pt-BR', 'en-US'])).toBe('pt-br');
    expect(detectInitialLocale(['pt'])).toBe('pt-br');
    expect(detectInitialLocale(['en-US', 'pt-BR'])).toBe('en');
    expect(detectInitialLocale(['en-GB'])).toBe('en');
    expect(detectInitialLocale(['es-ES', 'en'])).toBe('es');
    expect(detectInitialLocale(['es-419'])).toBe('es');
    expect(detectInitialLocale(['zh-CN', 'en'])).toBe('zh-CN');
    expect(detectInitialLocale(['zh-Hans'])).toBe('zh-CN');
    expect(detectInitialLocale(['fr-FR', 'de-DE'])).toBe('pt-br');
    expect(detectInitialLocale([])).toBe('pt-br');
  });

  it('provides complete dictionaries and localized default anonymous names for all 4 locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['pt-br', 'en', 'es', 'zh-CN']);

    expect(getDictionary('pt-br').defaultGuestName).toBe('Visitante');
    expect(getDictionary('en').defaultGuestName).toBe('Guest');
    expect(getDictionary('es').defaultGuestName).toBe('Invitado');
    expect(getDictionary('zh-CN').defaultGuestName).toBe('访客');

    for (const locale of SUPPORTED_LOCALES) {
      const dict = getDictionary(locale);
      expect(dict.localeCode).toBe(locale);
      expect(dict.brand.name).toBe('PULSO');
      expect(dict.entry.createButton.length).toBeGreaterThan(0);
      expect(dict.room.peopleOnline(2).length).toBeGreaterThan(0);
      expect(dict.room.statusReconnecting.length).toBeGreaterThan(0);
      expect(dict.room.reconnectingBanner.length).toBeGreaterThan(0);
      expect(dict.room.expiredReasonHardTtl.length).toBeGreaterThan(0);
      expect(dict.room.expiredReasonHostLeft.length).toBeGreaterThan(0);
      expect(dict.room.expiredReasonGraceTimeout.length).toBeGreaterThan(0);
      expect(dict.messages.typingIndicator('Ana').length).toBeGreaterThan(0);
    }
  });

  it('formats relative timestamps with Intl.RelativeTimeFormat across all 4 locales', () => {
    const now = 1_700_000_000_000;
    const twoMinutesAgo = now - 2 * 60 * 1000;

    expect(formatRelativeTime(now, now, 'pt-br')).toBe('agora');
    expect(formatRelativeTime(now, now, 'en')).toBe('now');
    expect(formatRelativeTime(now, now, 'es')).toBe('ahora');
    expect(formatRelativeTime(now, now, 'zh-CN')).toBe('现在');

    expect(formatRelativeTime(twoMinutesAgo, now, 'pt-br')).toMatch(/2\s*min/i);
    expect(formatRelativeTime(twoMinutesAgo, now, 'en')).toMatch(/2\s*min.*ago/i);
    expect(formatRelativeTime(twoMinutesAgo, now, 'es')).toMatch(/hace\s*2\s*min/i);
    expect(formatRelativeTime(twoMinutesAgo, now, 'zh-CN')).toMatch(/2分钟前/);
  });
});
