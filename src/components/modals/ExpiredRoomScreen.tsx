import { ShieldOff } from 'lucide-react';
import type { RoomExpiryReason } from '../../domain/types';
import { useI18n } from '../../i18n';
import { useTheme } from '../../theme/ThemeContext';
import { PulsoLogo } from '../PulsoLogo';

interface ExpiredRoomScreenProps {
  reason?: RoomExpiryReason | null;
  onReturnToEntry: () => void;
}

export function ExpiredRoomScreen({ reason, onReturnToEntry }: ExpiredRoomScreenProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const bodyText =
    reason === 'hard_ttl'
      ? t.room.expiredReasonHardTtl
      : reason === 'host_left'
        ? t.room.expiredReasonHostLeft
        : reason === 'grace_timeout'
          ? t.room.expiredReasonGraceTimeout
          : t.room.expiredBody;

  return (
    <main className="min-h-screen bg-[#F8F9FC] dark:bg-[#1A1C2A] flex flex-col items-center justify-center p-4 transition-colors">
      <section
        aria-labelledby="expired-room-title"
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#232638] border border-slate-200/80 dark:border-[#2E3248] shadow-lg p-8 text-center space-y-5 transition-colors"
      >
        <div className="flex justify-center">
          <PulsoLogo variant={isDark ? 'dark' : 'light'} size="sm" />
        </div>

        <div className="flex justify-center">
          <span
            aria-hidden="true"
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-500/15 text-[#EF4444] dark:text-red-400 border border-red-200/80 dark:border-red-500/30"
          >
            <ShieldOff className="h-6 w-6" />
          </span>
        </div>

        <div className="space-y-2">
          <h1
            id="expired-room-title"
            className="text-xl font-bold text-[#111827] dark:text-slate-50 tracking-tight"
          >
            {t.room.expiredTitle}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {bodyText}
          </p>
        </div>

        <p
          role="status"
          className="rounded-xl bg-slate-50 dark:bg-[#141522] border border-slate-200/80 dark:border-[#2E3248] px-4 py-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed"
        >
          {t.inactivity.expiredPurgeNotice}
        </p>

        <button
          type="button"
          onClick={onReturnToEntry}
          className="w-full inline-flex items-center justify-center rounded-xl bg-[#5B3DF5] hover:bg-[#4E32D9] active:bg-[#4328C4] px-4 py-3 text-sm font-semibold text-white shadow-sm transition cursor-pointer"
        >
          {t.room.expiredAction}
        </button>
      </section>
    </main>
  );
}
