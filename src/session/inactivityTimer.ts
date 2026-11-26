import type { TranslationDictionary } from '../i18n/types';

export const DEFAULT_INACTIVITY_DURATION_MS = 60 * 60 * 1000;
export const WARNING_THRESHOLD_MS = 5 * 60 * 1000;
export const CRITICAL_THRESHOLD_MS = 60 * 1000;

export type InactivityAlertLevel = 'normal' | 'warning' | 'critical';

export interface InactivityDisplay {
  isFullHour: boolean;
  timeText: string;
  label: string;
}

/**
 * Computes remaining milliseconds until `expiresAt`, clamped at zero.
 */
export function computeRemainingMs(expiresAt: number | null, now: number = Date.now()): number {
  if (expiresAt === null) return 0;
  return Math.max(0, expiresAt - now);
}

/**
 * Classifies remaining time into progressive alert thresholds (< 5m warning, < 1m critical).
 */
export function getInactivityAlertLevel(remainingMs: number): InactivityAlertLevel {
  if (remainingMs < CRITICAL_THRESHOLD_MS) return 'critical';
  if (remainingMs < WARNING_THRESHOLD_MS) return 'warning';
  return 'normal';
}

/**
 * Formats remaining milliseconds as tabular MM:SS using ceiling seconds so 00:00 only shows at expiry.
 */
export function formatCountdownMMSS(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Formats the localized countdown label ("Expira em 1h" at full 60m, tabular MM:SS below 1h).
 */
export function formatInactivityDisplay(
  remainingMs: number,
  t: TranslationDictionary,
): InactivityDisplay {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  if (totalSeconds >= 3600) {
    return {
      isFullHour: true,
      timeText: '1h',
      label: t.room.expiresIn1h,
    };
  }
  const timeText = formatCountdownMMSS(remainingMs);
  return {
    isFullHour: false,
    timeText,
    label: t.inactivity.expiresIn(timeText),
  };
}

/**
 * Computes a heartbeat interval for active video calls (30s default, scaled for shorter custom durations).
 */
export function getVideoCallHeartbeatMs(inactivityDurationMs: number): number {
  const safeDuration = Math.max(1000, inactivityDurationMs);
  return Math.max(1000, Math.min(30_000, Math.floor(safeDuration / 3)));
}
