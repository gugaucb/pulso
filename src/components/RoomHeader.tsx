import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Globe, Link2, LogOut, Moon, MoreVertical, Sun, Video } from 'lucide-react';
import type { Participant } from '../domain/types';
import { LOCALE_OPTIONS, useI18n } from '../i18n';
import { useTheme } from '../theme/ThemeContext';

interface RoomHeaderProps {
  roomCode: string;
  participants: Participant[];
  copiedCode: boolean;
  copiedLink: boolean;
  isCallActive?: boolean;
  onStartVideoCall?: () => void;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onLeaveRoom: () => void;
}

export function RoomHeader({
  roomCode,
  participants,
  copiedCode,
  copiedLink,
  isCallActive = false,
  onStartVideoCall,
  onCopyCode,
  onCopyLink,
  onLeaveRoom,
}: RoomHeaderProps) {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  const isDark = theme === 'dark';
  const themeAriaLabel = isDark ? t.theme.switchToLight : t.theme.switchToDark;
  const peerPresent = participants.length >= 2;
  const presenceLabel = peerPresent ? t.room.twoPeopleOnline : t.room.waitingForSomeone;

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="shrink-0 bg-white dark:bg-[#1A1C2A] border-b border-slate-200 dark:border-[#2A2D42] px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="font-mono-tabular text-base sm:text-lg font-bold tracking-wider text-[#111827] dark:text-slate-50">
            {roomCode}
          </h1>
          <button
            type="button"
            onClick={onCopyCode}
            aria-label={t.room.copyCodeHeader}
            title={t.room.copyCode}
            className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#232638] hover:text-[#111827] dark:hover:text-slate-100 transition cursor-pointer"
          >
            {copiedCode ? (
              <Check className="h-4 w-4 text-[#22C55E]" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 mt-0.5">
          <span
            className={`h-2 w-2 rounded-full ${peerPresent ? 'bg-[#22C55E]' : 'bg-amber-400'}`}
            aria-hidden="true"
          />
          <span>{presenceLabel}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {onStartVideoCall && (
          <button
            type="button"
            onClick={() => {
              if (!isCallActive) {
                onStartVideoCall();
              }
            }}
            aria-label={t.videoCall.startCall}
            aria-pressed={isCallActive}
            title={t.videoCall.startCall}
            className={`inline-flex items-center justify-center rounded-xl border p-2 transition cursor-pointer ${
              isCallActive
                ? 'border-[#5B3DF5] bg-[#5B3DF5] text-white shadow-sm'
                : 'border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-slate-50 dark:hover:bg-[#2B2F45] text-[#5B3DF5] dark:text-[#818CF8]'
            }`}
          >
            <Video className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={onCopyLink}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-slate-50 dark:hover:bg-[#2B2F45] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 transition cursor-pointer"
        >
          {copiedLink ? (
            <Check className="h-3.5 w-3.5 text-[#22C55E]" />
          ) : (
            <Link2 className="h-3.5 w-3.5 text-[#5B3DF5] dark:text-[#818CF8]" />
          )}
          <span className="hidden sm:inline">
            {copiedLink ? t.room.linkCopied : t.room.copyLink}
          </span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={themeAriaLabel}
          aria-pressed={isDark}
          title={themeAriaLabel}
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-slate-50 dark:hover:bg-[#2B2F45] p-2 text-slate-700 dark:text-slate-200 transition cursor-pointer"
        >
          {isDark ? (
            <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4 text-[#5B3DF5]" aria-hidden="true" />
          )}
        </button>

        <div className="relative" ref={menuContainerRef}>
          <button
            type="button"
            aria-label={t.room.optionsMenu}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-slate-50 dark:hover:bg-[#2B2F45] p-2 text-slate-700 dark:text-slate-200 transition cursor-pointer"
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              aria-label={t.room.optionsMenu}
              className="absolute right-0 mt-2 w-60 rounded-2xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] shadow-xl py-2 z-30"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCopyLink();
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#2B2F45] transition cursor-pointer text-left"
              >
                <Link2 className="h-3.5 w-3.5 text-[#5B3DF5] dark:text-[#818CF8]" aria-hidden="true" />
                <span>{copiedLink ? t.room.linkCopied : t.room.copyLink}</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  toggleTheme();
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#2B2F45] transition cursor-pointer text-left"
              >
                {isDark ? (
                  <Sun className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                ) : (
                  <Moon className="h-3.5 w-3.5 text-[#5B3DF5]" aria-hidden="true" />
                )}
                <span>{themeAriaLabel}</span>
              </button>

              <div className="my-1.5 border-t border-slate-200 dark:border-[#2E3248]" />

              <div role="group" aria-label={t.localeSelector.label}>
                <div className="px-3.5 py-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <Globe className="h-3 w-3" aria-hidden="true" />
                  <span>{t.localeSelector.label}</span>
                </div>
                {LOCALE_OPTIONS.map((option) => {
                  const selected = locale === option.code;
                  return (
                    <button
                      key={option.code}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        setLocale(option.code);
                        setMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#2B2F45] transition cursor-pointer text-left"
                    >
                      <span>{option.label}</span>
                      {selected && (
                        <Check className="h-3.5 w-3.5 text-[#5B3DF5] dark:text-[#818CF8]" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="my-1.5 border-t border-slate-200 dark:border-[#2E3248]" />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onLeaveRoom();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition cursor-pointer text-left"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t.room.leaveRoom}</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onLeaveRoom}
          aria-label={t.room.leaveRoom}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-red-50 dark:hover:bg-red-500/10 hover:border-red-200 dark:hover:border-red-500/40 hover:text-red-700 dark:hover:text-red-300 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 transition cursor-pointer"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t.room.leaveShort}</span>
        </button>
      </div>
    </header>
  );
}
