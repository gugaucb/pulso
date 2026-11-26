import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Locale } from '../domain/types';
import { en } from './locales/en';
import { es } from './locales/es';
import { ptBr } from './locales/pt-br';
import { zhCN } from './locales/zh-CN';
import type { TranslationDictionary } from './types';

export type { TranslationDictionary } from './types';

export const SUPPORTED_LOCALES: readonly Locale[] = ['pt-br', 'en', 'es', 'zh-CN'] as const;

const DICTIONARIES: Record<Locale, TranslationDictionary> = {
  'pt-br': ptBr,
  en,
  es,
  'zh-CN': zhCN,
};

export const LOCALE_OPTIONS: ReadonlyArray<{ code: Locale; label: string }> = SUPPORTED_LOCALES.map(
  (code) => ({
    code,
    label: DICTIONARIES[code].localeName,
  }),
);

export const DEFAULT_GUEST_NAMES: ReadonlySet<string> = new Set(
  SUPPORTED_LOCALES.map((code) => DICTIONARIES[code].defaultGuestName),
);

function getBrowserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : [];
}

/**
 * Detects the best matching supported locale from browser language preferences,
 * falling back to `pt-br`.
 */
export function detectInitialLocale(languages?: readonly string[]): Locale {
  const candidates = languages ?? getBrowserLanguages();
  for (const raw of candidates) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized.startsWith('pt')) return 'pt-br';
    if (normalized.startsWith('en')) return 'en';
    if (normalized.startsWith('es')) return 'es';
    if (normalized.startsWith('zh')) return 'zh-CN';
  }
  return 'pt-br';
}

export function getDictionary(locale: Locale): TranslationDictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES['pt-br'];
}

/**
 * Formats a timestamp relative to `now` using `Intl.RelativeTimeFormat`.
 */
export function formatRelativeTime(
  timestamp: number,
  now = Date.now(),
  locale: Locale | string = 'pt-br',
): string {
  const diffSeconds = Math.round((timestamp - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });

  if (Math.abs(diffSeconds) < 45) {
    return rtf.format(0, 'second');
  }

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: TranslationDictionary;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  initialLocale?: Locale;
  children: ReactNode;
}

export function I18nProvider({ initialLocale, children }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectInitialLocale());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.lang = locale;
    root.setAttribute('data-locale', locale);
    root.classList.toggle('font-cjk', locale === 'zh-CN');
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: getDictionary(locale),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}
