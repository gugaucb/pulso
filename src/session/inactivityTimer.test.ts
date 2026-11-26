import { describe, expect, it } from 'vitest';
import { getDictionary } from '../i18n';
import {
  CRITICAL_THRESHOLD_MS,
  DEFAULT_INACTIVITY_DURATION_MS,
  WARNING_THRESHOLD_MS,
  computeRemainingMs,
  formatCountdownMMSS,
  formatInactivityDisplay,
  getInactivityAlertLevel,
  getVideoCallHeartbeatMs,
} from './inactivityTimer';

describe('inactivityTimer pure helpers', () => {
  it('uses 60 minutes as default duration and exact 5m / 1m alert thresholds', () => {
    expect(DEFAULT_INACTIVITY_DURATION_MS).toBe(60 * 60 * 1000);
    expect(WARNING_THRESHOLD_MS).toBe(5 * 60 * 1000);
    expect(CRITICAL_THRESHOLD_MS).toBe(60 * 1000);

    expect(getInactivityAlertLevel(60 * 60 * 1000)).toBe('normal');
    expect(getInactivityAlertLevel(5 * 60 * 1000)).toBe('normal');
    expect(getInactivityAlertLevel(5 * 60 * 1000 - 1)).toBe('warning');
    expect(getInactivityAlertLevel(60 * 1000)).toBe('warning');
    expect(getInactivityAlertLevel(60 * 1000 - 1)).toBe('critical');
    expect(getInactivityAlertLevel(0)).toBe('critical');
  });

  it('computes clamped remaining milliseconds and MM:SS countdown', () => {
    expect(computeRemainingMs(null, 1000)).toBe(0);
    expect(computeRemainingMs(5000, 1000)).toBe(4000);
    expect(computeRemainingMs(1000, 5000)).toBe(0);

    expect(formatCountdownMMSS(59 * 60 * 1000 + 59 * 1000)).toBe('59:59');
    expect(formatCountdownMMSS(4 * 60 * 1000 + 5 * 1000)).toBe('04:05');
    expect(formatCountdownMMSS(500)).toBe('00:01');
    expect(formatCountdownMMSS(0)).toBe('00:00');
  });

  it('formats full 60m as localized 1h and sub-60m as localized MM:SS', () => {
    const pt = getDictionary('pt-br');
    const en = getDictionary('en');
    const zh = getDictionary('zh-CN');

    expect(formatInactivityDisplay(60 * 60 * 1000, pt)).toEqual({
      isFullHour: true,
      timeText: '1h',
      label: 'Expira em 1h',
    });
    expect(formatInactivityDisplay(59 * 60 * 1000 + 59 * 1000, pt)).toEqual({
      isFullHour: false,
      timeText: '59:59',
      label: 'Expira em 59:59',
    });
    expect(formatInactivityDisplay(60 * 60 * 1000, en)).toEqual({
      isFullHour: true,
      timeText: '1h',
      label: 'Expires in 1h',
    });
    expect(formatInactivityDisplay(4 * 60 * 1000 + 59 * 1000, zh)).toEqual({
      isFullHour: false,
      timeText: '04:59',
      label: '04:59 后过期',
    });
  });

  it('scales video call heartbeat interval safely for standard and custom durations', () => {
    expect(getVideoCallHeartbeatMs(60 * 60 * 1000)).toBe(30_000);
    expect(getVideoCallHeartbeatMs(90_000)).toBe(30_000);
    expect(getVideoCallHeartbeatMs(15_000)).toBe(5_000);
    expect(getVideoCallHeartbeatMs(1_000)).toBe(1_000);
  });
});
