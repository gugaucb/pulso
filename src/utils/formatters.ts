/**
 * Derives 1-2 uppercase initials from a participant display name.
 */
export function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'V';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

/**
 * Formats a timestamp relative to `now` using Intl.RelativeTimeFormat.
 */
export function formatRelativeTime(timestamp: number, now = Date.now(), locale = 'pt-BR'): string {
  const diffSeconds = Math.round((timestamp - now) / 1000);
  if (Math.abs(diffSeconds) < 45) {
    return locale.toLowerCase().startsWith('pt') ? 'agora' : 'now';
  }

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  return rtf.format(diffHours, 'hour');
}
