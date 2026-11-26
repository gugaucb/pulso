import {
  Check,
  Clock,
  Copy,
  Globe,
  Link2,
  Lock,
  LogOut,
  Moon,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { formatOnionHost } from '../domain/onionAddress';
import type { Locale, Participant, RoomMode } from '../domain/types';
import { DEFAULT_GUEST_NAMES, LOCALE_OPTIONS, useI18n } from '../i18n';
import {
  DEFAULT_INACTIVITY_DURATION_MS,
  formatInactivityDisplay,
  type InactivityAlertLevel,
} from '../session/inactivityTimer';
import { useTheme } from '../theme/ThemeContext';
import { getInitials } from '../utils/formatters';
import { PulsoLogo } from './PulsoLogo';

export interface RoomSidebarProps {
  roomCode: string;
  roomMode?: RoomMode;
  onionAddress?: string | null;
  localParticipant: Participant;
  participants: Participant[];
  copiedCode: boolean;
  copiedLink: boolean;
  e2eeReady: boolean;
  inactivityRemainingMs?: number;
  inactivityAlertLevel?: InactivityAlertLevel;
  onRenewActivity?: () => void;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onOpenSas: () => void;
  onOpenSettings?: () => void;
  onLeaveRoom: () => void;
}

interface RoomSidebarContentProps extends RoomSidebarProps {
  onCloseDrawer?: () => void;
  closeButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

/**
 * Shared sidebar body rendered inside both the persistent desktop sidebar
 * and the mobile slide-over drawer.
 */
export function RoomSidebarContent({
  roomCode,
  roomMode = 'normal',
  onionAddress,
  localParticipant,
  participants,
  copiedCode,
  copiedLink,
  e2eeReady,
  inactivityRemainingMs = DEFAULT_INACTIVITY_DURATION_MS,
  inactivityAlertLevel = 'normal',
  onRenewActivity,
  onCopyCode,
  onCopyLink,
  onOpenSas,
  onOpenSettings,
  onLeaveRoom,
  onCloseDrawer,
  closeButtonRef,
}: RoomSidebarContentProps) {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const isTorMode = roomMode === 'tor';

  const onlineCount = participants.filter((p) => p.online).length;
  const onlineText = t.room.peopleOnline(onlineCount);
  const countdown = formatInactivityDisplay(inactivityRemainingMs, t);
  const timerColorClass =
    inactivityAlertLevel === 'critical'
      ? 'text-[#EF4444] font-semibold'
      : inactivityAlertLevel === 'warning'
        ? 'text-[#F59E0B] font-semibold'
        : 'text-slate-300';
  const timerIconColorClass =
    inactivityAlertLevel === 'critical'
      ? 'text-[#EF4444]'
      : inactivityAlertLevel === 'warning'
        ? 'text-[#F59E0B]'
        : 'text-slate-400';

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-2">
          <PulsoLogo variant="dark" size="sm" />
          {onCloseDrawer && (
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onCloseDrawer}
              aria-label={t.room.closeSidebar}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-300 hover:bg-[#1B1D2C] hover:text-white transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6344F5]"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
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
          {isTorMode && (
            <div className="mt-2.5 space-y-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-400/35 bg-purple-500/15 px-2.5 py-1 text-[11px] font-semibold text-purple-200">
                <Lock className="h-3 w-3" aria-hidden="true" />
                <span>{t.torMode.badge}</span>
              </span>
              {onionAddress && (
                <p
                  className="font-mono-tabular text-[10px] text-slate-400 truncate"
                  title={formatOnionHost(onionAddress)}
                >
                  {formatOnionHost(onionAddress)}
                </p>
              )}
            </div>
          )}
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
                  <span className="shrink-0 w-6 flex items-center justify-end">
                    {!isTorMode && participant.videoEnabled && (
                      <span
                        role="img"
                        aria-label={t.videoCall.participantVideoActive}
                        title={t.videoCall.participantVideoActive}
                        className="inline-flex shrink-0 items-center justify-center rounded-md bg-indigo-500/20 p-1 text-indigo-300"
                      >
                        <Video className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
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
          <div
            data-inactivity-level={inactivityAlertLevel}
            className={`flex items-center justify-between gap-2 text-xs px-1 ${timerColorClass}`}
          >
            <span className="inline-flex items-center gap-2 min-w-0">
              <Clock className={`h-4 w-4 shrink-0 ${timerIconColorClass}`} aria-hidden="true" />
              <span className="font-mono-tabular truncate">{countdown.label}</span>
            </span>
            {onRenewActivity && (
              <button
                type="button"
                onClick={onRenewActivity}
                aria-label={t.inactivity.confirmPresence}
                title={t.inactivity.confirmPresence}
                className="shrink-0 inline-flex items-center gap-1 rounded-md bg-[#1B1D2C] hover:bg-slate-700/70 border border-slate-700/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-200 transition cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">{t.inactivity.confirmPresence}</span>
              </button>
            )}
          </div>
          {isTorMode && (
            <div className="mt-2 flex items-center gap-2 text-xs text-purple-200 px-1">
              <VideoOff className="h-3.5 w-3.5 shrink-0 text-purple-300" aria-hidden="true" />
              <span>{t.torMode.textOnlyNotice}</span>
            </div>
          )}
          <button
            type="button"
            onClick={onOpenSas}
            className="mt-2 w-full flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-[#1B1D2C] hover:text-emerald-200 transition cursor-pointer text-left"
          >
            <ShieldCheck
              className={`h-4 w-4 shrink-0 ${e2eeReady ? 'text-emerald-400' : 'text-slate-400'}`}
              aria-hidden="true"
            />
            <span className="truncate">{t.e2ee.verifyAction}</span>
          </button>
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
    </>
  );
}

export function RoomSidebar(props: RoomSidebarProps) {
  const { t } = useI18n();

  return (
    <aside
      aria-label={t.room.sidebarAriaLabel}
      className="pulso-print-hide hidden md:flex md:w-64 md:shrink-0 flex-col justify-between bg-[#141522] text-slate-200 border-r border-slate-800/80 p-5 select-none"
    >
      <RoomSidebarContent {...props} />
    </aside>
  );
}
