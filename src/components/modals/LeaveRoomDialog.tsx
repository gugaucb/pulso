import { useRef } from 'react';
import { LogOut } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';
import { useI18n } from '../../i18n';

interface LeaveRoomDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function LeaveRoomDialog({ open, onCancel, onConfirm }: LeaveRoomDialogProps) {
  const { t } = useI18n();
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  useModalA11y(open, cancelBtnRef, onCancel);

  if (!open) return null;

  return (
    <div
      className="pulso-print-hide fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-room-title"
        aria-describedby="leave-room-description"
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#232638] border border-slate-200 dark:border-[#2E3248] shadow-xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300"
          >
            <LogOut className="h-5 w-5" />
          </span>
          <div>
            <h2
              id="leave-room-title"
              className="text-base font-bold text-[#111827] dark:text-slate-100"
            >
              {t.room.confirmLeaveTitle}
            </h2>
            <p
              id="leave-room-description"
              className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300"
            >
              {t.room.confirmLeaveBody}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            className="min-h-[44px] sm:min-h-0 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#1B1D2C] hover:bg-slate-50 dark:hover:bg-[#2B2F45] px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
          >
            {t.room.confirmLeaveCancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[44px] sm:min-h-0 rounded-xl bg-[#EF4444] hover:bg-red-600 px-3.5 py-2 text-xs font-semibold text-white transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EF4444]"
          >
            {t.room.confirmLeaveConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}