import { useState, type FormEvent } from 'react';
import { AlertCircle, Globe, Loader2, Moon, PlusCircle, Shield, Sun } from 'lucide-react';
import { formatRoomCode, isValidRoomCode, normalizeRoomCode } from '../domain/roomCode';
import type { ConnectionStatus, Locale, RoomErrorCode, RoomMode } from '../domain/types';
import { LOCALE_OPTIONS, useI18n } from '../i18n';
import { useTheme } from '../theme/ThemeContext';
import { PulsoLogo } from './PulsoLogo';

interface EntryScreenProps {
  status: ConnectionStatus;
  errorCode: RoomErrorCode | null;
  onCreateRoom: (displayName: string, mode?: RoomMode) => Promise<void>;
  onJoinRoom: (roomCode: string, displayName: string) => Promise<void>;
  onClearError: () => void;
}

export function EntryScreen({
  status,
  errorCode,
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
    onClearError();
    await onCreateRoom(displayName, selectedMode);
  };

  const isDark = theme === 'dark';
  const themeAriaLabel = isDark ? t.theme.switchToLight : t.theme.switchToDark;

  return (
    <main className="min-h-screen bg-[#F8F9FC] dark:bg-[#1A1C2A] flex flex-col items-center justify-center p-4 sm:p-6 transition-colors">
      <div className="w-full max-w-md flex items-center justify-end gap-2 mb-3">
        <div className="relative inline-flex items-center">
          <Globe
            className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300 pointer-events-none absolute left-2.5"
            aria-hidden="true"
          />
          <select
            aria-label={t.localeSelector.label}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className="min-h-[44px] sm:min-h-0 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] pl-8 pr-3 py-2 sm:py-1.5 text-xs font-medium text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-[#2B2F45] focus:border-[#5B3DF5] focus:outline-none focus:ring-2 focus:ring-[#5B3DF5]/20 focus-visible:ring-2 focus-visible:ring-[#5B3DF5] transition cursor-pointer"
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
          className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] px-3 py-2 sm:py-1.5 text-xs font-medium text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-[#2B2F45] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5] transition cursor-pointer"
        >
          {isDark ? (
            <Sun className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          ) : (
            <Moon className="h-3.5 w-3.5 text-[#5B3DF5]" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">
            {isDark ? t.theme.light : t.theme.dark}
          </span>
        </button>
      </div>

      <section className="w-full max-w-md bg-white dark:bg-[#232638] rounded-2xl shadow-lg border border-slate-200/80 dark:border-[#2E3248] p-5 sm:p-8 transition-colors">
        <div className="flex flex-col items-center text-center mb-6">
          <PulsoLogo variant={isDark ? 'dark' : 'light'} size="md" />
          <p className="mt-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            {t.brand.slogan}
          </p>
          <h1 className="mt-4 text-2xl font-bold text-[#111827] dark:text-slate-50 tracking-tight">
            {t.entry.title}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {t.entry.subtitle}
          </p>
        </div>

        <form onSubmit={handleJoinSubmit} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="room-code-input"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              {t.entry.roomCodeLabel}
            </label>
            <input
              id="room-code-input"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={t.entry.roomCodePlaceholder}
              value={roomCodeInput}
              onChange={(e) => handleRoomCodeChange(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={isConnecting}
              aria-invalid={visibleError ? 'true' : 'false'}
              className="min-h-[44px] w-full rounded-xl border border-slate-300 dark:border-[#2E3248] bg-slate-50/70 dark:bg-[#141522] px-4 py-3 text-center font-mono-tabular text-base tracking-wider text-[#111827] dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-400 focus:border-[#5B3DF5] dark:focus:border-[#6344F5] focus:bg-white dark:focus:bg-[#1B1D2C] focus:outline-none focus:ring-2 focus:ring-[#5B3DF5]/20 transition"
            />
          </div>

          <div>
            <label
              htmlFor="display-name-input"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
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
              className="min-h-[44px] w-full rounded-xl border border-slate-300 dark:border-[#2E3248] bg-white dark:bg-[#141522] px-4 py-2.5 text-sm text-[#111827] dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-400 focus:border-[#5B3DF5] dark:focus:border-[#6344F5] focus:bg-white dark:focus:bg-[#1B1D2C] focus:outline-none focus:ring-2 focus:ring-[#5B3DF5]/20 transition"
            />
          </div>

          {visibleError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-200"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
              <span>{visibleError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isConnecting}
            className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#5B3DF5] hover:bg-[#4E32D9] active:bg-[#4328C4] disabled:opacity-60 px-4 py-3 text-sm font-semibold text-white shadow-sm transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5] focus-visible:ring-offset-2"
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t.entry.connecting}</span>
              </>
            ) : (
              <span>{t.entry.joinButton}</span>
            )}
          </button>
        </form>

        <div className="relative my-5 flex items-center justify-center">
          <div className="w-full border-t border-slate-200 dark:border-[#2E3248]" />
          <span className="bg-white dark:bg-[#232638] px-3 text-xs font-medium text-slate-400 dark:text-slate-400">
            {t.entry.orDivider}
          </span>
        </div>

        <fieldset
          role="radiogroup"
          aria-labelledby="entry-mode-label"
          className="mb-3"
        >
          <legend
            id="entry-mode-label"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2"
          >
            {t.entry.modeLabel}
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label
              className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition cursor-pointer ${
                selectedMode === 'normal'
                  ? 'border-[#5B3DF5] bg-[#EEF0FF]/70 dark:bg-[#2D2856]/60 dark:border-[#6344F5]'
                  : 'border-slate-200 dark:border-[#2E3248] bg-slate-50/70 dark:bg-[#141522] hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="roomMode"
                value="normal"
                checked={selectedMode === 'normal'}
                onChange={() => setSelectedMode('normal')}
                disabled={isConnecting}
                aria-labelledby="mode-normal-title"
                aria-describedby="mode-normal-desc"
                className="mt-0.5 accent-[#5B3DF5]"
              />
              <span className="min-w-0">
                <span
                  id="mode-normal-title"
                  className="block text-xs font-semibold text-[#111827] dark:text-slate-100"
                >
                  {t.entry.normalMode}
                </span>
                <span
                  id="mode-normal-desc"
                  className="mt-0.5 block text-[11px] leading-snug text-slate-600 dark:text-slate-300"
                >
                  {t.entry.normalModeDescription}
                </span>
              </span>
            </label>

            <label
              className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition cursor-pointer ${
                selectedMode === 'tor'
                  ? 'border-[#5B3DF5] bg-[#EEF0FF]/70 dark:bg-[#2D2856]/60 dark:border-[#6344F5]'
                  : 'border-slate-200 dark:border-[#2E3248] bg-slate-50/70 dark:bg-[#141522] hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="roomMode"
                value="tor"
                checked={selectedMode === 'tor'}
                onChange={() => setSelectedMode('tor')}
                disabled={isConnecting}
                aria-labelledby="mode-tor-title"
                aria-describedby="mode-tor-desc"
                className="mt-0.5 accent-[#5B3DF5]"
              />
              <span className="min-w-0">
                <span
                  id="mode-tor-title"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#111827] dark:text-slate-100"
                >
                  <Shield className="h-3 w-3 text-[#5B3DF5] dark:text-[#818CF8]" aria-hidden="true" />
                  <span>{t.entry.torMode}</span>
                </span>
                <span
                  id="mode-tor-desc"
                  className="mt-0.5 block text-[11px] leading-snug text-slate-600 dark:text-slate-300"
                >
                  {t.entry.torModeDescription}
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <button
          type="button"
          onClick={handleCreateClick}
          disabled={isConnecting}
          className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-[#2E3248] bg-white dark:bg-[#1B1D2C] hover:bg-slate-50 dark:hover:bg-[#2B2F45] active:bg-slate-100 disabled:opacity-60 px-4 py-3 text-sm font-semibold text-[#111827] dark:text-slate-100 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3DF5]"
        >
          <PlusCircle className="h-4 w-4 text-[#5B3DF5] dark:text-[#818CF8]" />
          <span>{t.entry.createButton}</span>
        </button>
      </section>
    </main>
  );
}
