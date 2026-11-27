import { useId } from 'react';

/** Beat geometry, shared with the logo mark (logo spans x 4–60; here it sits mid-line). */
const TRACE_PATH = 'M0 26H92L96 31L102 19L107 33L113 8L119 40L125 16L130 26H240';
const FLAT_PATH = 'M0 26H240';

export type PulseLineVariant = 'static' | 'draw' | 'flatline' | 'scan';

interface PulseLineProps {
  /**
   * - `static`: resting signature.
   * - `draw`: traced once on mount (first-visit moment).
   * - `flatline`: peaks collapse into a flat line (room ended).
   * - `scan`: a segment travels the trace while a connection is in progress.
   */
  variant?: PulseLineVariant;
  /** `signal` uses the brand gradient; `muted` uses the current text color. */
  tone?: 'signal' | 'muted';
  strokeWidth?: number;
  className?: string;
}

/**
 * The PULSO signature: the logo's heartbeat stretched into a full-width trace.
 * Purely presentational and aria-hidden — state is always also conveyed in text.
 */
export function PulseLine({
  variant = 'static',
  tone = 'signal',
  strokeWidth = 2.5,
  className = '',
}: PulseLineProps) {
  const gradientId = `pulse-${useId().replace(/:/g, '')}`;
  const stroke = tone === 'signal' ? `url(#${gradientId})` : 'currentColor';

  return (
    <svg
      viewBox="0 0 240 48"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-variant={variant}
      className={`pulse-line overflow-visible ${className}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="240" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--signal-a)" stopOpacity="0" />
          <stop offset="30%" stopColor="var(--signal-a)" />
          <stop offset="70%" stopColor="var(--signal-b)" />
          <stop offset="100%" stopColor="var(--signal-b)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {variant === 'scan' && (
        <path className="pulse-ghost" d={TRACE_PATH} stroke="currentColor" strokeWidth={strokeWidth} />
      )}
      {variant === 'flatline' && (
        <path className="pulse-flat" d={FLAT_PATH} stroke="currentColor" strokeWidth={strokeWidth} />
      )}
      <path
        className="pulse-trace"
        d={TRACE_PATH}
        pathLength={1}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}
