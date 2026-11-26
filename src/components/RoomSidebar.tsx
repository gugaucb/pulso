import { Check, Clock, Copy, Globe, Link2, LogOut, Moon, Settings, Sun, Video } from 'lucide-react';
import type { Locale, Participant } from '../domain/types';
import { DEFAULT_GUEST_NAMES, LOCALE_OPTIONS, useI18n } from '../i18n';
import { useTheme } from '../theme/ThemeContext';
import { getInitials } from '../utils/formatters';
import { PulsoLogo } from './PulsoLogo';

interface RoomSidebarProps {
  roomCode: string;
  localParticipant: Participant;
  participants: Participant[];
  copiedCode: boolean;
  copiedLink: boolean;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onOpenSettings?: () => void;
  onLeaveRoom: () => void;
}

export function RoomSidebar({
  roomCode,
  localParticipant,
  participants,
  copiedCode,
  copiedLink,
  onCopyCode,
  onCopyLink,
  onOpenSettings,
  onLeaveRoom,
}: RoomSidebarProps) {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const onlineCount = participants.filter((p) => p.online).length;
  const onlineText = t.room.peopleOnline(onlineCount);

  return (
    <aside
      aria-label={t.room.sidebarAriaLabel}
      className="hidden md:flex md:w-64 md:shrink-0 flex-col justify-between bg-[#141522] text-slate-200 border-r border-slate-800/80 p-5 select-none"
    >
      <div className="space-y-6">
        <div>
          <PulsoLogo variant="dark" size="sm" />
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            {t.room.currentRoom}
          </p>
          <div className="flex items-center justify-between rounded-xl bg-[#1B1D2C] border border-slate-700/60 px-3.5 py-2.5">
            <span className="font-mono-tabular text-sm font-semibold tracking-wider text-white">
              {roomCode}
            </span>
            <button
              type="button"
              onClick={onCopyCode}
              aria-label={t.room.copyCodeSidebar}
              title={t.room.copyCode}
              className="text-slate-400 hover:text-white transition cursor-pointer"
            >
              {copiedCode ? (
                <Check className="h-4 w-4 text-[#22C55E]" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-300">
            <span className="h-2 w-2 rounded-full bg-[#22C55E]" aria-hidden="true" />
            <span>{onlineText}</span>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
            {t.room.participants}
          </p>
          <ul className="space-y-2">
            {participants.slice(0, 2).map((participant) => {
              const isSelf = participant.id === localParticipant.id;
              const isDefaultAnonymous = DEFAULT_GUEST_NAMES.has(participant.displayName);
              const label = isSelf
                ? !isDefaultAnonymous
                  ? t.room.youWithName(participant.displayName)
                  : t.room.you
                : participant.displayName;
              const avatarBg = isSelf ? 'bg-[#3B82F6]' : 'bg-[#6344F5]';
              const statusLabel = participant.online ? t.room.statusOnline : t.room.statusOffline;

              return (
                <li
                  key={participant.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-100"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarBg}`}
                        aria-hidden="true"
                      >
                        {getInitials(participant.displayName)}
                      </span>
                      <span
                        role="img"
                        aria-label={statusLabel}
                        title={statusLabel}
                        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#141522] ${
                          participant.online ? 'bg-[#22C55E]' : 'bg-slate-500'
                        }`}
                      />
                    </div>
                    <span className="truncate font-medium">{label}</span>
                  </div>
                  <span className="shrink-0 w-4 flex items-center justify-center">
                    {participant.videoEnabled && (
                      <Video
                        className="h-3.5 w-3.5 text-slate-300"
                        aria-label={t.room.videoActive}
                      />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            {t.room.aboutRoom}
          </p>
          <div className="flex items-center gap-2 text-xs text-slate-300 px-1">
            <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <span>{t.room.expiresIn1h}</span>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-slate-800/80 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1">
          {t.room.shortcuts}
        </p>

        <div className="space-y-1">
          <button
            type="button"
            onClick={onCopyLink}
            className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 hover:bg-[#1B1D2C] hover:text-white transition cursor-pointer"
          >
            {copiedLink ? (
              <Check className="h-4 w-4 text-[#22C55E]" />
            ) : (
              <Link2 className="h-4 w-4 text-slate-400" />
            )}
            <span>{copiedLink ? t.room.linkCopied : t.room.copyLink}</span>
          </button>

          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 hover:bg-[#1B1D2C] hover:text-white transition cursor-pointer"
            >
              <Settings className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <span>{t.room.settings}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onLeaveRoom}
            className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 hover:bg-red-500/10 hover:text-red-300 transition cursor-pointer"
          >
            <LogOut className="h-4 w-4 text-slate-400" />
            <span>{t.room.leaveRoom}</span>
          </button>
        </div>

        <div className="pt-2 border-t border-slate-800/60 space-y-2">
          <div className="relative flex items-center">
            <Globe
              className="h-3.5 w-3.5 text-slate-400 pointer-events-none absolute left-2.5"
              aria-hidden="true"
            />
            <select
              aria-label={t.localeSelector.label}
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="w-full rounded-lg border border-slate-700/70 bg-[#1B1D2C] pl-8 pr-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600 focus:border-[#6344F5] focus:outline-none transition cursor-pointer"
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
            role="switch"
            aria-checked={isDark}
            aria-label={t.theme.dark}
            onClick={toggleTheme}
            className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#1B1D2C] hover:text-white transition cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              {isDark ? (
                <Moon className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />
              ) : (
                <Sun className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
              )}
              <span>{isDark ? t.theme.dark : t.theme.light}</span>
            </span>
            <span
              aria-hidden="true"
              className={`inline-flex h-4 w-7 items-center rounded-full p-0.5 transition ${
                isDark ? 'bg-[#5B3DF5] justify-end' : 'bg-slate-700 justify-start'
              }`}
            >
              <span className="h-3 w-3 rounded-full bg-white" />
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
