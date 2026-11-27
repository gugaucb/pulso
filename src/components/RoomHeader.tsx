import { useRef, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Globe,
  Link2,
  Lock,
  LogOut,
  Menu,
  Moon,
  MoreVertical,
  Settings,
  ShieldCheck,
  Sun,
  Video,
  VideoOff,
} from 'lucide-react';
import type { ConnectionStatus, Participant, RoomMode, RuntimeInfo } from '../domain/types';
import { useDismissable } from '../hooks/useDismissable';
import { LOCALE_OPTIONS, useI18n } from '../i18n';
import {
  DEFAULT_INACTIVITY_DURATION_MS,
  formatInactivityDisplay,
  type InactivityAlertLevel,
} from '../session/inactivityTimer';
import { useTheme } from '../theme/ThemeContext';

interface RoomHeaderProps {
  roomCode: string;
  roomMode?: RoomMode;
  tunnelActive?: boolean;
  tunnelProvider?: RuntimeInfo['tunnelProvider'];
  connectionStatus?: ConnectionStatus;
  participants: Participant[];
  copiedCode: boolean;
  copiedLink: boolean;
  isCallActive?: boolean;
  onStartVideoCall?: () => void;
  e2eeReady: boolean;
  inactivityRemainingMs?: number;
  inactivityAlertLevel?: InactivityAlertLevel;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onOpenSas: () => void;
  onOpenSettings?: () => void;
  onLeaveRoom: () => void;
  mobileSidebarOpen?: boolean;
  onToggleMobileSidebar?: () => void;
  mobileSidebarButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export function RoomHeader({
  roomCode,
  roomMode = 'normal',
  tunnelActive = false,
  tunnelProvider,
  connectionStatus,
  participants,
  copiedCode,
  copiedLink,
  isCallActive = false,
  onStartVideoCall,
  e2eeReady,
  inactivityRemainingMs = DEFAULT_INACTIVITY_DURATION_MS,
  inactivityAlertLevel = 'normal',
  onCopyCode,
  onCopyLink,
  onOpenSas,
  onOpenSettings,
  onLeaveRoom,
  mobileSidebarOpen = false,
  onToggleMobileSidebar,
  mobileSidebarButtonRef,
}: RoomHeaderProps) {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const isTorMode = roomMode === 'tor';

  const isDark = theme === 'dark';
  const themeAriaLabel = isDark ? t.theme.switchToLight : t.theme.switchToDark;
  const countdown = formatInactivityDisplay(inactivityRemainingMs, t);
  const countdownBadgeClass =
    inactivityAlertLevel === 'critical'
      ? 'bg-red-50 dark:bg-red-500/15 text-[#B91C1C] dark:text-[#EF4444] border-[#EF4444]/70 font-semibold'
      : inactivityAlertLevel === 'warning'
        ? 'bg-amber-50 dark:bg-amber-500/15 text-[#B45309] dark:text-[#F59E0B] border-[#F59E0B]/60 font-semibold'
        : 'bg-slate-100 dark:bg-[#232638] text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-[#2E3248]';
  const onlineCount = participants.filter((p) => p.online).length;
  const peerPresent = onlineCount >= 2;
  const isConnecting = connectionStatus === 'connecting';
  const isReconnecting = connectionStatus === 'reconnecting';
  const isOnline = !isConnecting && !isReconnecting && peerPresent;
  const presenceLabel = isReconnecting
    ? t.room.statusReconnecting
    : isConnecting
      ? t.entry.connecting
      : peerPresent
        ? t.room.twoPeopleOnline
        : t.room.waitingForSomeone;

  const statusBadge = isReconnecting
    ? {
        dotClass: 'bg-amber-400 animate-pulse',
        pillClass:
          'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-500/30',
        label: t.room.statusReconnecting,
        key: 'reconnecting',
      }
    : isConnecting
      ? {
          dotClass: 'bg-indigo-400 animate-pulse',
          pillClass:
            'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-500/30',
          label: t.entry.connecting,
          key: 'connecting',
        }
      : isOnline
        ? {
            dotClass: 'bg-[#22C55E]',
            pillClass:
              'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-500/30',
            label: t.room.statusOnline,
            key: 'online',
          }
        : {
            dotClass: 'bg-amber-400 animate-pulse',
            pillClass:
              'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-500/30',
            label: t.room.statusWaiting,
            key: 'waiting',
          };

  useDismissable(menuOpen, menuContainerRef, () => setMenuOpen(false));

  return (
    <header className="pulso-print-hide shrink-0 bg-white dark:bg-[#1A1C2A] border-b border-slate-200 dark:border-[#2A2D42] px-3 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-3 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        {onToggleMobileSidebar && (
          <button
            ref={mobileSidebarButtonRef}
            type="button"
            onClick={onToggleMobileSidebar}
            aria-label={t.room.openSidebar}
            aria-expanded={mobileSidebarOpen}
            aria-controls="mobile-room-sidebar"
            className="md:hidden inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-slate-50 dark:hover:bg-[#2B2F45] text-slate-700 dark:text-slate-200 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <h1 className="font-mono-tabular text-sm sm:text-lg font-bold tracking-wider text-[#111827] dark:text-slate-50 truncate">
              {roomCode}
            </h1>
            <button
              type="button"
              onClick={onCopyCode}
              aria-label={t.room.copyCodeHeader}
              title={t.room.copyCode}
              className="inline-flex h-9 w-9 sm:h-auto sm:w-auto items-center justify-center rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#232638] hover:text-[#111827] dark:hover:text-slate-100 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
            >
              {copiedCode ? (
                <Check className="h-4 w-4 text-[#22C55E]" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 mt-0.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${statusBadge.dotClass}`}
                aria-hidden="true"
              />
              <span>{presenceLabel}</span>
            </span>
            <span
              data-connection-status={statusBadge.key}
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${statusBadge.pillClass}`}
            >
              {statusBadge.label}
            </span>
            <span
              data-inactivity-level={inactivityAlertLevel}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium font-mono-tabular leading-none transition-colors ${countdownBadgeClass}`}
            >
              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{countdown.label}</span>
            </span>
            {isTorMode && (
              <span
                data-room-mode="tor"
                className="inline-flex items-center gap-1 rounded-full border border-purple-200 dark:border-purple-500/35 bg-purple-50 dark:bg-purple-500/15 px-2 py-0.5 text-[11px] font-semibold leading-none text-purple-700 dark:text-purple-200"
              >
                <Lock className="h-3 w-3" aria-hidden="true" />
                <span>{t.torMode.badge}</span>
              </span>
            )}
            {!isTorMode && tunnelActive && (
              <span
                data-tunnel-active="true"
                data-tunnel-provider={tunnelProvider ?? 'cloudflare'}
                className="inline-flex items-center gap-1 rounded-full border border-sky-200 dark:border-sky-500/35 bg-sky-50 dark:bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold leading-none text-sky-800 dark:text-sky-200"
              >
                <Globe className="h-3 w-3" aria-hidden="true" />
                <span>{t.tunnel.badge(tunnelProvider === 'cloudflare' || !tunnelProvider ? 'Cloudflare' : tunnelProvider)}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {(isTorMode || onStartVideoCall) && (
          <button
            type="button"
            disabled={isTorMode}
            aria-disabled={isTorMode ? 'true' : undefined}
            aria-describedby={isTorMode ? 'tor-video-blocked-notice' : undefined}
            onClick={() => {
              if (!isTorMode && !isCallActive && onStartVideoCall) {
                onStartVideoCall();
              }
            }}
            aria-label={t.videoCall.startCall}
            aria-pressed={isTorMode ? false : isCallActive}
            title={isTorMode ? t.videoCall.torBlockedNotice : t.videoCall.startCall}
            className={`inline-flex h-11 w-11 sm:h-auto sm:w-auto items-center justify-center rounded-xl border p-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5] ${
              isTorMode
                ? 'border-slate-200 dark:border-[#2E3248] bg-slate-100 dark:bg-[#1B1D2C] text-slate-400 dark:text-slate-500 opacity-60 cursor-not-allowed'
                : isCallActive
                  ? 'border-[#5B3DF5] bg-[#5B3DF5] text-white shadow-sm cursor-pointer'
                  : 'border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-slate-50 dark:hover:bg-[#2B2F45] text-[#5B3DF5] dark:text-[#818CF8] cursor-pointer'
            }`}
          >
            {isTorMode ? (
              <VideoOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Video className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onOpenSas}
          aria-label={t.e2ee.protectedBadge}
          title={t.e2ee.verifyAction}
          className={`hidden sm:inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5] ${
            e2eeReady
              ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/80 dark:bg-emerald-500/10 hover:bg-emerald-100/80 dark:hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
              : 'border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-slate-50 dark:hover:bg-[#2B2F45] text-slate-600 dark:text-slate-300'
          }`}
        >
          <ShieldCheck
            className={`h-3.5 w-3.5 ${
              e2eeReady
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-400 dark:text-slate-400'
            }`}
            aria-hidden="true"
          />
          <span className="hidden md:inline">{t.e2ee.protectedBadge}</span>
        </button>

        <button
          type="button"
          onClick={onCopyLink}
          className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-slate-50 dark:hover:bg-[#2B2F45] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
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
          className="hidden sm:inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-slate-50 dark:hover:bg-[#2B2F45] p-2 text-slate-700 dark:text-slate-200 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
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
            className="inline-flex h-11 w-11 sm:h-auto sm:w-auto items-center justify-center rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-slate-50 dark:hover:bg-[#2B2F45] p-2 text-slate-700 dark:text-slate-200 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
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
                  setMenuOpen(false);
                  onOpenSas();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#2B2F45] transition cursor-pointer text-left"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span>{t.e2ee.verifyAction}</span>
              </button>

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

              {onOpenSettings && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenSettings();
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#2B2F45] transition cursor-pointer text-left"
                >
                  <Settings className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" aria-hidden="true" />
                  <span>{t.room.privacyAndMediaSettings}</span>
                </button>
              )}

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
          className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] hover:bg-red-50 dark:hover:bg-red-500/10 hover:border-red-200 dark:hover:border-red-500/40 hover:text-red-700 dark:hover:text-red-300 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t.room.leaveShort}</span>
        </button>
      </div>
    </header>
  );
}
