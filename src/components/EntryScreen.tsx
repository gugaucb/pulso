import { useState, type CSSProperties, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  Hourglass,
  Loader2,
  LockKeyhole,
  Moon,
  Plus,
  Shield,
  Sun,
  Terminal,
  UserX,
} from 'lucide-react';
import { formatRoomCode, isValidRoomCode, normalizeRoomCode } from '../domain/roomCode';
import type {
  ConnectionStatus,
  Locale,
  RoomErrorCode,
  RoomMode,
  RuntimeInfo,
} from '../domain/types';
import { LOCALE_OPTIONS, useI18n } from '../i18n';
import type { CreateRoomOptions } from '../session/useRoomSession';
import { useTheme } from '../theme/ThemeContext';
import { PulseLine } from './PulseLine';
import { PulsoLogo } from './PulsoLogo';

const DEFAULT_RUNTIME_INFO: RuntimeInfo = { runtimeMode: 'normal' };

/** Per-element entrance timing (see choreograph timeline in the visual audit). */
const beat = (delayMs: number, rise = 12, durMs = 600): CSSProperties =>
  ({ '--delay': `${delayMs}ms`, '--rise': `${rise}px`, '--dur': `${durMs}ms` }) as CSSProperties;

const FIELD_CLASS =
  'min-h-[44px] w-full rounded-2xl border border-line-strong bg-surface-2/70 text-ink placeholder:text-ink-3 transition-[border-color,background-color,box-shadow] duration-150 ease-out hover:border-ink-3/40 focus:border-accent focus:bg-surface focus:outline-none focus:ring-4 focus:ring-accent/12 disabled:opacity-60';

const CHROME_BUTTON_CLASS =
  'min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded-full border border-line bg-surface/70 backdrop-blur-md px-3.5 text-xs font-medium text-ink-2 hover:text-ink hover:border-line-strong cursor-pointer';

interface EntryScreenProps {
  status: ConnectionStatus;
  errorCode: RoomErrorCode | null;
  runtimeInfo?: RuntimeInfo;
  onCreateRoom: (
    displayName: string,
    mode?: RoomMode,
    options?: CreateRoomOptions,
  ) => Promise<void>;
  onJoinRoom: (roomCode: string, displayName: string) => Promise<void>;
  onClearError: () => void;
}

export function EntryScreen({
  status,
  errorCode,
  runtimeInfo = DEFAULT_RUNTIME_INFO,
  onCreateRoom,
  onJoinRoom,
  onClearError,
}: EntryScreenProps) {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedMode, setSelectedMode] = useState<RoomMode>('normal');
  const [touched, setTouched] = useState(false);

  const isConnecting = status === 'connecting';
  const isTorRuntime = runtimeInfo.runtimeMode === 'tor';
  const effectiveMode: RoomMode = isTorRuntime ? 'tor' : selectedMode;
  const torStatus =
    runtimeInfo.torStatus ?? (runtimeInfo.onionAddress ? 'ready' : 'bootstrapping');
  const isTorGuidanceInNormal = !isTorRuntime && effectiveMode === 'tor';
  const isCreateDisabled =
    isConnecting ||
    isTorGuidanceInNormal ||
    (isTorRuntime && torStatus !== 'ready');
  const normalizedLength = normalizeRoomCode(roomCodeInput).length;
  const hasInvalidFormat =
    touched && normalizedLength > 0 && !isValidRoomCode(roomCodeInput);

  const visibleError =
    errorCode !== null
      ? t.errors[errorCode]
      : hasInvalidFormat
        ? t.errors.invalid_code
        : null;

  const handleRoomCodeChange = (value: string) => {
    setRoomCodeInput(formatRoomCode(value));
    if (errorCode) {
      onClearError();
    }
  };

  const handleJoinSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    await onJoinRoom(roomCodeInput, displayName);
  };

  const handleCreateClick = async () => {
    if (isCreateDisabled) return;
    onClearError();
    if (isTorRuntime) {
      await onCreateRoom(displayName, 'tor', {
        mode: 'tor',
        onionAddress: runtimeInfo.onionAddress,
      });
      return;
    }
    await onCreateRoom(displayName, 'normal');
  };

  const isDark = theme === 'dark';
  const themeAriaLabel = isDark ? t.theme.switchToLight : t.theme.switchToDark;

  const guarantees = [
    { icon: LockKeyhole, label: t.entry.guaranteeEncrypted },
    { icon: UserX, label: t.entry.guaranteeNoSignup },
    { icon: Hourglass, label: t.entry.guaranteeEphemeral },
  ];

  const modeCardClass = (selected: boolean, locked = false) =>
    `group relative flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 ease-out ${
      locked
        ? 'border-line bg-surface-2/50 opacity-55 cursor-not-allowed'
        : selected
          ? 'border-accent bg-accent-soft shadow-[0_0_0_3px_var(--accent-soft)] cursor-pointer'
          : 'border-line bg-surface hover:border-line-strong cursor-pointer'
    }`;

  const radioClass =
    'mt-0.5 h-4 w-4 shrink-0 appearance-none rounded-full border border-line-strong bg-surface transition-[border-color,border-width] duration-150 ease-out checked:border-[5px] checked:border-accent disabled:cursor-not-allowed cursor-pointer';

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-canvas text-ink">
      <div className="pulso-atmosphere -z-10" aria-hidden="true" />

      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 sm:px-8">
        <header className="flex items-center justify-between gap-3 py-5 sm:py-7">
          <PulsoLogo variant="auto" size="sm" />
          <div className="flex items-center gap-2">
            <div className="relative inline-flex items-center">
              <Globe
                className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-ink-3"
                aria-hidden="true"
              />
              <select
                aria-label={t.localeSelector.label}
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                className={`${CHROME_BUTTON_CLASS} appearance-none pl-8 pr-4`}
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
              aria-label={themeAriaLabel}
              aria-pressed={isDark}
              title={themeAriaLabel}
              className={`${CHROME_BUTTON_CLASS} min-w-[44px] sm:min-w-0`}
            >
              {isDark ? (
                <Sun className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Moon className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{isDark ? t.theme.light : t.theme.dark}</span>
            </button>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-10 pb-10 pt-2 sm:pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-20 lg:pb-16">
          {/* Hero — the one place the signature is drawn. */}
          <section className="max-w-xl">
            <PulseLine variant="draw" className="h-10 w-full max-w-sm sm:h-14" />

            <p
              className="type-eyebrow enter-rise mt-6 text-accent-ink sm:mt-8"
              style={beat(40, 8, 500)}
            >
              {t.brand.slogan}
            </p>
            <h1 className="type-display enter-rise mt-4 text-ink" style={beat(80)}>
              {t.entry.title}
            </h1>
            <p
              className="type-lead enter-rise mt-5 max-w-md text-ink-2"
              style={beat(160, 10, 560)}
            >
              {t.entry.subtitle}
            </p>

            <ul className="mt-8 hidden gap-3 sm:grid">
              {guarantees.map(({ icon: Icon, label }, index) => (
                <li
                  key={label}
                  className="enter-rise flex items-center gap-3 text-sm text-ink-2"
                  style={beat(240 + [0, 60, 100][index], 6, 500)}
                >
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface/70 text-accent-ink">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Action panel */}
          <section
            className="enter-rise w-full rounded-[28px] border border-line bg-surface p-5 shadow-(--shadow-panel) sm:p-7"
            style={beat(140, 8, 560)}
          >
            <form onSubmit={handleJoinSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="room-code-input"
                  className="mb-2 block text-xs font-medium text-ink-2"
                >
                  {t.entry.roomCodeLabel}
                </label>
                <input
                  id="room-code-input"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder={t.entry.roomCodePlaceholder}
                  value={roomCodeInput}
                  onChange={(e) => handleRoomCodeChange(e.target.value)}
                  onBlur={() => setTouched(true)}
                  disabled={isConnecting}
                  aria-invalid={visibleError ? 'true' : 'false'}
                  className={`${FIELD_CLASS} font-mono-tabular px-4 py-3.5 text-center text-xl font-semibold tracking-[0.18em] placeholder:font-normal placeholder:tracking-[0.06em] placeholder:text-base aria-[invalid=true]:border-red-400`}
                />
              </div>

              <div>
                <label
                  htmlFor="display-name-input"
                  className="mb-2 block text-xs font-medium text-ink-2"
                >
                  {t.entry.displayNameLabel}
                </label>
                <input
                  id="display-name-input"
                  type="text"
                  autoComplete="off"
                  maxLength={32}
                  placeholder={t.entry.displayNamePlaceholder}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={isConnecting}
                  className={`${FIELD_CLASS} px-4 py-3 text-sm`}
                />
              </div>

              {visibleError && (
                <div
                  role="alert"
                  className="enter-in flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs leading-relaxed text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
                >
                  <AlertCircle className="mt-px h-4 w-4 shrink-0 text-red-500 dark:text-red-400" aria-hidden="true" />
                  <span>{visibleError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isConnecting}
                className="min-h-[48px] w-full inline-flex items-center justify-center gap-2.5 rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(16_17_38/0.2),0_8px_20px_-8px_var(--accent)] hover:bg-accent-strong disabled:cursor-wait disabled:opacity-80 cursor-pointer"
              >
                {isConnecting ? (
                  <>
                    <PulseLine variant="scan" tone="muted" strokeWidth={2} className="h-4 w-9 text-white" />
                    <span>{t.entry.connecting}</span>
                  </>
                ) : (
                  <span>{t.entry.joinButton}</span>
                )}
              </button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" aria-hidden="true" />
              <span className="type-eyebrow text-ink-3">{t.entry.orDivider}</span>
              <span className="h-px flex-1 bg-line" aria-hidden="true" />
            </div>

            <fieldset role="radiogroup" aria-labelledby="entry-mode-label" className="mb-3">
              <legend id="entry-mode-label" className="mb-2 block text-xs font-medium text-ink-2">
                {t.entry.modeLabel}
              </legend>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <label className={modeCardClass(effectiveMode === 'normal', isTorRuntime)}>
                  <input
                    type="radio"
                    name="roomMode"
                    value="normal"
                    checked={effectiveMode === 'normal'}
                    onChange={() => setSelectedMode('normal')}
                    disabled={isConnecting || isTorRuntime}
                    aria-labelledby="mode-normal-title"
                    aria-describedby="mode-normal-desc"
                    className={radioClass}
                  />
                  <span className="min-w-0">
                    <span id="mode-normal-title" className="block text-[13px] font-semibold text-ink">
                      {t.entry.normalMode}
                    </span>
                    <span id="mode-normal-desc" className="mt-1 block text-[11.5px] leading-snug text-ink-2">
                      {t.entry.normalModeDescription}
                    </span>
                  </span>
                </label>

                <label className={modeCardClass(effectiveMode === 'tor')}>
                  <input
                    type="radio"
                    name="roomMode"
                    value="tor"
                    checked={effectiveMode === 'tor'}
                    onChange={() => setSelectedMode('tor')}
                    disabled={isConnecting}
                    aria-labelledby="mode-tor-title"
                    aria-describedby="mode-tor-desc"
                    className={radioClass}
                  />
                  <span className="min-w-0">
                    <span
                      id="mode-tor-title"
                      className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink"
                    >
                      <Shield className="h-3 w-3 text-accent-ink" aria-hidden="true" />
                      <span>{t.entry.torMode}</span>
                    </span>
                    <span id="mode-tor-desc" className="mt-1 block text-[11.5px] leading-snug text-ink-2">
                      {t.entry.torModeDescription}
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            {isTorGuidanceInNormal && (
              <div
                role="status"
                aria-live="polite"
                className="enter-in mb-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-3.5 text-left dark:border-amber-400/20 dark:bg-amber-400/[0.07]"
              >
                <div className="flex items-start gap-2.5">
                  <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-xs font-semibold text-amber-950 dark:text-amber-100">
                      {t.entry.torLauncherRequiredTitle}
                    </p>
                    <p className="text-xs leading-relaxed text-amber-900/90 dark:text-amber-200/85">
                      {t.entry.torLauncherRequiredBody}
                    </p>
                    <code className="font-mono-tabular block select-all rounded-xl bg-[#0d0e1a] px-3 py-2 text-xs text-slate-100">
                      {t.entry.torLauncherCommand}
                    </code>
                  </div>
                </div>
              </div>
            )}

            {isTorRuntime && (
              <div className="mb-3 space-y-2 text-left">
                <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
                  <Shield className="h-3.5 w-3.5 shrink-0 text-accent-ink" aria-hidden="true" />
                  <span>{t.entry.torRuntimeLockedNotice}</span>
                </p>
                {torStatus === 'error' ? (
                  <div
                    role="alert"
                    className="enter-in flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
                  >
                    <AlertCircle className="mt-px h-4 w-4 shrink-0 text-red-500 dark:text-red-400" aria-hidden="true" />
                    <span>{t.entry.torStatusError}</span>
                  </div>
                ) : (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-start gap-2.5 rounded-2xl border border-line bg-accent-soft px-3.5 py-3 text-xs text-ink"
                  >
                    {torStatus === 'ready' ? (
                      <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    ) : (
                      <Loader2 className="mt-px h-4 w-4 shrink-0 animate-spin text-accent-ink" aria-hidden="true" />
                    )}
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">
                        {torStatus === 'ready' ? t.entry.torStatusReady : t.entry.torStatusBootstrapping}
                      </p>
                      {torStatus === 'ready' && runtimeInfo.onionAddress && (
                        <p className="font-mono-tabular break-all text-[11px] text-ink-2">
                          {runtimeInfo.onionAddress}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleCreateClick}
              disabled={isCreateDisabled}
              className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-line-strong bg-surface px-4 py-3 text-sm font-semibold text-ink hover:border-ink-3/50 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
            >
              <Plus className="h-4 w-4 text-accent-ink" aria-hidden="true" />
              <span>{t.entry.createButton}</span>
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}
