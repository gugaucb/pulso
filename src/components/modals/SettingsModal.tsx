import { useEffect, useRef } from 'react';
import { Globe, Mic, Moon, ShieldAlert, ShieldCheck, Sun, Video } from 'lucide-react';
import type { Locale } from '../../domain/types';
import { LOCALE_OPTIONS, useI18n } from '../../i18n';
import type { MediaDeviceOption } from '../../media/MediaPort';
import { useTheme } from '../../theme/ThemeContext';

interface SettingsModalProps {
  open: boolean;
  antiPrintscreenEnabled: boolean;
  watermarkEnabled: boolean;
  isTorMode?: boolean;
  cameras?: MediaDeviceOption[];
  microphones?: MediaDeviceOption[];
  selectedCameraId?: string | null;
  selectedMicrophoneId?: string | null;
  onToggleAntiPrintscreen: () => void;
  onToggleWatermark: () => void;
  onClose: () => void;
}

/**
 * Privacy, anti-capture, media summary, and appearance settings modal.
 * All preferences live strictly in React RAM (zero persistent storage).
 */
export function SettingsModal({
  open,
  antiPrintscreenEnabled,
  watermarkEnabled,
  isTorMode = false,
  cameras = [],
  microphones = [],
  selectedCameraId = null,
  selectedMicrophoneId = null,
  onToggleAntiPrintscreen,
  onToggleWatermark,
  onClose,
}: SettingsModalProps) {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const firstControlRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      firstControlRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const selectedCameraLabel =
    cameras.find((c) => c.deviceId === selectedCameraId)?.label ??
    cameras[0]?.label ??
    null;
  const selectedMicLabel =
    microphones.find((m) => m.deviceId === selectedMicrophoneId)?.label ??
    microphones[0]?.label ??
    null;

  return (
    <div
      className="pulso-print-hide fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] shadow-2xl p-5 sm:p-6 space-y-5 transition-colors"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-500/15 text-[#5B3DF5] dark:text-[#818CF8]"
          >
            <ShieldCheck className="h-5 w-5" />
          </span>
          <h2
            id="settings-modal-title"
            className="text-base font-bold text-[#111827] dark:text-slate-50"
          >
            {t.privacy.settingsTitle}
          </h2>
        </div>

        {/* Privacy & anti-capture switches */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-slate-50/70 dark:bg-[#1B1D2C] px-3.5 py-3">
            <label
              htmlFor="anti-printscreen-switch"
              className="text-xs sm:text-sm font-medium text-[#111827] dark:text-slate-100 cursor-pointer"
            >
              {t.privacy.antiPrintscreenToggle}
            </label>
            <button
              ref={firstControlRef}
              id="anti-printscreen-switch"
              type="button"
              role="switch"
              aria-checked={antiPrintscreenEnabled}
              onClick={onToggleAntiPrintscreen}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5] ${
                antiPrintscreenEnabled
                  ? 'bg-[#5B3DF5] justify-end'
                  : 'bg-slate-300 dark:bg-slate-600 justify-start'
              }`}
            >
              <span className="h-5 w-5 rounded-full bg-white shadow-xs" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-slate-50/70 dark:bg-[#1B1D2C] px-3.5 py-3">
            <label
              htmlFor="watermark-switch"
              className="text-xs sm:text-sm font-medium text-[#111827] dark:text-slate-100 cursor-pointer"
            >
              {t.privacy.watermarkToggle}
            </label>
            <button
              id="watermark-switch"
              type="button"
              role="switch"
              aria-checked={watermarkEnabled}
              onClick={onToggleWatermark}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5] ${
                watermarkEnabled
                  ? 'bg-[#5B3DF5] justify-end'
                  : 'bg-slate-300 dark:bg-slate-600 justify-start'
              }`}
            >
              <span className="h-5 w-5 rounded-full bg-white shadow-xs" />
            </button>
          </div>
        </section>

        {/* Honest technical disclaimer */}
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/90 dark:bg-amber-500/10 px-3.5 py-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
        >
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p>{t.privacy.honestDisclaimer}</p>
        </div>

        {/* Media device settings summary */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t.privacy.mediaSectionTitle}
          </h3>
          {isTorMode ? (
            <div className="rounded-xl border border-slate-200 dark:border-[#2E3248] bg-slate-50 dark:bg-[#1B1D2C] px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300">
              {t.privacy.mediaTorBlocked}
            </div>
          ) : cameras.length > 0 || microphones.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-slate-50 dark:bg-[#1B1D2C] px-3 py-2 text-xs text-slate-700 dark:text-slate-200">
                <Video className="h-3.5 w-3.5 shrink-0 text-[#5B3DF5] dark:text-[#818CF8]" aria-hidden="true" />
                <span className="truncate">
                  {selectedCameraLabel ?? t.videoCall.cameraSelectLabel}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-slate-50 dark:bg-[#1B1D2C] px-3 py-2 text-xs text-slate-700 dark:text-slate-200">
                <Mic className="h-3.5 w-3.5 shrink-0 text-[#5B3DF5] dark:text-[#818CF8]" aria-hidden="true" />
                <span className="truncate">
                  {selectedMicLabel ?? t.videoCall.microphoneSelectLabel}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-[#2E3248] bg-slate-50 dark:bg-[#1B1D2C] px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300">
              {t.privacy.mediaNotCheckedYet}
            </div>
          )}
        </section>

        {/* Language & appearance quick controls */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t.privacy.appearanceSectionTitle}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="relative flex items-center">
              <Globe
                className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 pointer-events-none absolute left-3"
                aria-hidden="true"
              />
              <select
                aria-label={t.localeSelector.label}
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                className="w-full min-h-[44px] sm:min-h-0 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#1B1D2C] pl-8 pr-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-100 focus:border-[#5B3DF5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5] transition cursor-pointer"
              >
                {LOCALE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={isDark}
              aria-label={isDark ? t.theme.switchToLight : t.theme.switchToDark}
              className="min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#1B1D2C] hover:bg-slate-50 dark:hover:bg-[#2B2F45] px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-100 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
            >
              {isDark ? (
                <Sun className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-[#5B3DF5]" aria-hidden="true" />
              )}
              <span>{isDark ? t.theme.dark : t.theme.light}</span>
            </button>
          </div>
        </section>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] sm:min-h-0 rounded-xl bg-[#5B3DF5] hover:bg-[#4E32D9] px-4 py-2 text-xs font-semibold text-white transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5] focus-visible:ring-offset-2"
          >
            {t.e2ee.close}
          </button>
        </div>
      </div>
    </div>
  );
}
