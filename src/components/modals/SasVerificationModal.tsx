import { useEffect } from 'react';
import { Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useI18n } from '../../i18n';

interface SasVerificationModalProps {
  open: boolean;
  sasCode: string | null;
  hasLinkSecret: boolean;
  onClose: () => void;
}

export function SasVerificationModal({
  open,
  sasCode,
  hasLinkSecret,
  onClose,
}: SasVerificationModalProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sas-modal-title"
        className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] p-6 shadow-2xl transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2
              id="sas-modal-title"
              className="text-base font-bold text-[#111827] dark:text-slate-50"
            >
              {t.e2ee.sasTitle}
            </h2>
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {t.e2ee.protectedBadge}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {t.e2ee.sasDescription}
        </p>

        {sasCode ? (
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-indigo-200 dark:border-[#393E5B] bg-indigo-50/70 dark:bg-[#1B1D2C] p-4 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                {t.e2ee.sasCodeLabel}
              </p>
              <p className="font-mono-tabular text-2xl font-bold tracking-widest text-[#111827] dark:text-slate-50 select-all">
                {sasCode}
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-xl bg-slate-50 dark:bg-[#1B1D2C]/80 border border-slate-200 dark:border-[#2E3248] px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300">
              <Lock className="h-4 w-4 text-[#5B3DF5] dark:text-[#818CF8] shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                {hasLinkSecret ? t.e2ee.sasLinkSecretActive : t.e2ee.sasManualModeHint}
              </span>
            </div>

            <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{t.e2ee.sasMismatchWarning}</span>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 dark:border-[#393E5B] bg-slate-50 dark:bg-[#1B1D2C] p-5 text-center text-sm text-slate-600 dark:text-slate-300">
            {t.e2ee.sasWaiting}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#5B3DF5] hover:bg-[#4E32D9] dark:hover:bg-[#6344F5] px-4 py-2 text-sm font-semibold text-white transition cursor-pointer"
          >
            {t.e2ee.close}
          </button>
        </div>
      </div>
    </div>
  );
}
