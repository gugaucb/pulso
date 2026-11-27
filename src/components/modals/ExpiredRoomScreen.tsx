import type { CSSProperties } from 'react';
import { ArrowLeft, Eraser } from 'lucide-react';
import type { RoomExpiryReason } from '../../domain/types';
import { useI18n } from '../../i18n';
import { PulseLine } from '../PulseLine';
import { PulsoLogo } from '../PulsoLogo';

interface ExpiredRoomScreenProps {
  reason?: RoomExpiryReason | null;
  onReturnToEntry: () => void;
}

/** Content follows the flatline: it lands as the trace goes flat (~640ms). */
const beat = (delayMs: number, durMs = 520): CSSProperties =>
  ({ '--delay': `${delayMs}ms`, '--dur': `${durMs}ms` }) as CSSProperties;

export function ExpiredRoomScreen({ reason, onReturnToEntry }: ExpiredRoomScreenProps) {
  const { t } = useI18n();

  const bodyText =
    reason === 'hard_ttl'
      ? t.room.expiredReasonHardTtl
      : reason === 'host_left'
        ? t.room.expiredReasonHostLeft
        : reason === 'grace_timeout'
          ? t.room.expiredReasonGraceTimeout
          : t.room.expiredBody;

  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-canvas text-ink">
      <div className="pulso-atmosphere -z-10" data-tone="quiet" aria-hidden="true" />

      <header className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-8 sm:py-7">
        <PulsoLogo variant="auto" size="sm" />
      </header>

      <div className="flex flex-1 items-center justify-center px-5 pb-16 sm:px-8">
        <section aria-labelledby="expired-room-title" className="w-full max-w-lg text-center">
          <PulseLine
            variant="flatline"
            className="mx-auto h-12 w-full max-w-xs text-ink-3/60 sm:h-14"
          />

          <h1
            id="expired-room-title"
            className="type-title enter-materialize mt-10 text-ink"
            style={beat(520, 600)}
          >
            {t.room.expiredTitle}
          </h1>
          <p className="type-lead enter-materialize mx-auto mt-4 max-w-md text-ink-2" style={beat(600)}>
            {bodyText}
          </p>

          <p
            role="status"
            className="enter-materialize mx-auto mt-8 flex max-w-md items-start justify-center gap-2.5 border-y border-line py-4 text-left text-xs leading-relaxed text-ink-3"
            style={beat(660)}
          >
            <Eraser className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t.inactivity.expiredPurgeNotice}</span>
          </p>

          <button
            type="button"
            onClick={onReturnToEntry}
            className="enter-materialize mt-8 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-canvas shadow-[0_8px_24px_-12px_rgb(16_17_38/0.5)] hover:opacity-90 cursor-pointer"
            style={beat(720)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{t.room.expiredAction}</span>
          </button>
        </section>
      </div>
    </main>
  );
}
