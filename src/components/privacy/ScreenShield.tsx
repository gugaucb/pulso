import { useEffect, useState, type ReactNode } from 'react';
import { EyeOff } from 'lucide-react';
import { useI18n } from '../../i18n';

interface ScreenShieldProps {
  /** Whether focus-loss blur curtain protection is active for this session. */
  enabled: boolean;
  /** Optional decorative overlay (e.g. dynamic session watermark). */
  overlay?: ReactNode;
  children: ReactNode;
}

/**
 * Deterrent anti-printscreen shield around Ephemeral Messages.
 * Blurs and covers content when the browser window loses focus or the tab is hidden,
 * and suppresses casual text selection and native context menus.
 */
export function ScreenShield({ enabled, overlay, children }: ScreenShieldProps) {
  const { t } = useI18n();
  const [lostFocus, setLostFocus] = useState(false);
  const [tabHidden, setTabHidden] = useState(() =>
    typeof document !== 'undefined'
      ? Boolean(document.hidden || document.visibilityState === 'hidden')
      : false,
  );

  useEffect(() => {
    const handleBlur = () => setLostFocus(true);
    const handleFocus = () => setLostFocus(false);
    const handleVisibilityChange = () => {
      setTabHidden(Boolean(document.hidden || document.visibilityState === 'hidden'));
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const isShielded = enabled && (lostFocus || tabHidden);

  return (
    <div
      className="pulso-print-hide relative flex-1 flex flex-col min-h-0 select-none"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        aria-hidden={isShielded ? 'true' : undefined}
        className={`flex-1 flex flex-col min-h-0 transition duration-150 ${
          isShielded ? 'blur-md pointer-events-none select-none' : ''
        }`}
      >
        {children}
      </div>

      {overlay}

      {isShielded && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-slate-950/75 dark:bg-[#0D0E17]/85 backdrop-blur-md px-6 text-center select-none"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5B3DF5]/20 border border-[#5B3DF5]/40 text-indigo-200"
          >
            <EyeOff className="h-6 w-6" />
          </span>
          <p className="text-base font-bold text-white">
            {t.privacy.blurCurtainTitle}
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-slate-300">
            {t.privacy.blurCurtainHint}
          </p>
        </div>
      )}
    </div>
  );
}
