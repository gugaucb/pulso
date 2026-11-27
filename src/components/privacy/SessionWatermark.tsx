import { useEffect, useId, useState } from 'react';

interface SessionWatermarkProps {
  /** Whether the watermark overlay is active. */
  enabled: boolean;
  /** Room Code rendered inside the subtle repeating SVG pattern. */
  roomCode: string;
}

function formatCurrentTimeHHMM(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Optional, non-interactive SVG watermark overlay displaying the Room Code
 * and current HH:MM timestamp as a deterrent against casual screen leaks.
 */
export function SessionWatermark({ enabled, roomCode }: SessionWatermarkProps) {
  const patternId = useId().replace(/:/g, '');
  const [timeLabel, setTimeLabel] = useState(() => formatCurrentTimeHHMM(new Date()));

  useEffect(() => {
    if (!enabled) return;
    setTimeLabel(formatCurrentTimeHHMM(new Date()));
    const interval = setInterval(() => {
      setTimeLabel(formatCurrentTimeHHMM(new Date()));
    }, 30_000);
    return () => clearInterval(interval);
  }, [enabled]);

  if (!enabled) return null;

  const watermarkText = `${roomCode} · ${timeLabel}`;

  return (
    <svg
      data-session-watermark="true"
      aria-hidden="true"
      role="presentation"
      className="pointer-events-none select-none absolute inset-0 z-10 h-full w-full text-slate-900/[0.06] dark:text-slate-100/[0.07]"
    >
      <defs>
        <pattern
          id={`pulso-wm-${patternId}`}
          width="240"
          height="140"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-24)"
        >
          <text
            x="16"
            y="72"
            fill="currentColor"
            fontSize="13"
            fontWeight="600"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
            letterSpacing="0.08em"
          >
            {watermarkText}
          </text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#pulso-wm-${patternId})`} />
    </svg>
  );
}
