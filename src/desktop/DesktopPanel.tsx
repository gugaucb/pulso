import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  Loader2,
  LockKeyhole,
  Moon,
  Power,
  RefreshCw,
  ShieldAlert,
  Sun,
  X,
} from 'lucide-react';
import { PulsoLogo } from '../components/PulsoLogo';
import type { Locale, Theme } from '../domain/types';
import { I18nProvider, LOCALE_OPTIONS, useI18n } from '../i18n';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';
import { getDesktopDictionary } from './i18n';
import { createTauriDesktopBridge } from './tauriBridge';
import type {
  DesktopBridge,
  DesktopFlavorInfo,
  DesktopTurnConfig,
  SidecarEvent,
  TorBootstrapPhase,
  TorBridgeMode,
} from './types';

export interface DesktopPanelProps {
  bridge?: DesktopBridge;
  initialLocale?: Locale;
  initialTheme?: Theme;
}

type UiPhase =
  | 'idle'
  | 'starting'
  | 'bootstrapping'
  | 'ready'
  | 'stalled'
  | 'stopping'
  | 'error';

interface PanelState {
  phase: UiPhase;
  port?: number;
  localUrl?: string;
  onionAddress?: string;
  publicOrigin?: string;
  tunnelEnabled: boolean;
  tunnelActive: boolean;
  tunnelError?: string;
  torPhase: TorBootstrapPhase;
  torProgress: number;
  errorMessage?: string;
  stoppedFeedback?: 'purged' | 'stopped';
}

const INITIAL_STATE: PanelState = {
  phase: 'idle',
  tunnelEnabled: false,
  tunnelActive: false,
  torPhase: 'starting',
  torProgress: 0,
};

function parseTurnInput(input: {
  turnUrlsText: string;
  turnUsername: string;
  turnCredential: string;
  turnSecret: string;
}): DesktopTurnConfig | undefined {
  const turnUrls = input.turnUrlsText
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const turnUsername = input.turnUsername.trim();
  const turnCredential = input.turnCredential.trim();
  const turnSecret = input.turnSecret.trim();

  if (
    turnUrls.length === 0 &&
    !turnUsername &&
    !turnCredential &&
    !turnSecret
  ) {
    return undefined;
  }

  return {
    ...(turnUrls.length > 0 ? { turnUrls } : {}),
    ...(turnUsername ? { turnUsername } : {}),
    ...(turnCredential ? { turnCredential } : {}),
    ...(turnSecret ? { turnSecret } : {}),
  };
}

function DesktopPanelContent({ bridge }: { bridge: DesktopBridge }) {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const dt = getDesktopDictionary(locale);

  const [flavorInfo, setFlavorInfo] = useState<DesktopFlavorInfo>({
    flavor: 'local',
    appVersion: '0.1.0',
  });
  const [state, setState] = useState<PanelState>(INITIAL_STATE);
  const [bridgeMode, setBridgeMode] = useState<TorBridgeMode>('direct');
  const [customBridges, setCustomBridges] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [trayNoticeVisible, setTrayNoticeVisible] = useState(false);

  // Local flavor RAM-only TURN options + manual update check state
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [turnUrlsText, setTurnUrlsText] = useState('');
  const [turnUsername, setTurnUsername] = useState('');
  const [turnCredential, setTurnCredential] = useState('');
  const [turnSecret, setTurnSecret] = useState('');
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void bridge.getFlavorInfo().then((info) => {
      if (active) {
        setFlavorInfo(info);
      }
    });

    const unsubSidecar = bridge.subscribeSidecarEvents((event: SidecarEvent) => {
      setState((prev) => {
        switch (event.event) {
          case 'listening':
            return {
              ...prev,
              phase: event.mode === 'tor' ? 'bootstrapping' : event.tunnelEnabled ? 'starting' : 'ready',
              port: event.port,
              localUrl: event.localUrl,
              tunnelEnabled: Boolean(event.tunnelEnabled),
              stoppedFeedback: undefined,
              errorMessage: undefined,
            };
          case 'tor_progress':
            return {
              ...prev,
              phase: prev.phase === 'ready' ? 'ready' : 'bootstrapping',
              torPhase: event.phase,
              torProgress: event.progress,
            };
          case 'tor_stall':
            return {
              ...prev,
              phase: 'stalled',
              torProgress: event.progress,
            };
          case 'tor_ready':
            return {
              ...prev,
              phase: 'ready',
              torPhase: 'ready',
              torProgress: 100,
              onionAddress: event.onionAddress,
            };
          case 'tunnel_starting':
            return {
              ...prev,
              phase: 'starting',
              tunnelEnabled: true,
              tunnelError: undefined,
            };
          case 'tunnel_ready':
            return {
              ...prev,
              phase: 'ready',
              tunnelEnabled: true,
              tunnelActive: true,
              publicOrigin: event.publicOrigin,
              tunnelError: undefined,
            };
          case 'tunnel_error':
            return {
              ...prev,
              phase: prev.localUrl ? 'ready' : 'error',
              tunnelActive: false,
              tunnelError: event.message,
            };
          case 'stopping':
            return {
              ...prev,
              phase: 'stopping',
            };
          case 'stopped':
            return {
              ...INITIAL_STATE,
              stoppedFeedback: event.purgedDataDir ? 'purged' : 'stopped',
            };
          case 'error':
            return {
              ...prev,
              phase: 'error',
              errorMessage: event.message,
            };
          default:
            return prev;
        }
      });
    });

    const unsubLifecycle = bridge.subscribeLifecycleEvents((event) => {
      if (event.event === 'window_minimized_to_tray') {
        setTrayNoticeVisible(true);
      } else if (event.event === 'instance_reset') {
        setState(INITIAL_STATE);
      }
    });

    return () => {
      active = false;
      unsubSidecar();
      unsubLifecycle();
    };
  }, [bridge]);

  const isTorFlavor = flavorInfo.flavor === 'tor';
  const isRunning =
    state.phase === 'starting' ||
    state.phase === 'bootstrapping' ||
    state.phase === 'ready' ||
    state.phase === 'stalled' ||
    state.phase === 'stopping';
  const canStart = state.phase === 'idle' || state.phase === 'error';

  const handleStartTor = async (event?: FormEvent) => {
    event?.preventDefault();
    setValidationError(null);

    if (bridgeMode === 'custom' && !customBridges.trim()) {
      setValidationError(dt.tor.customBridgesEmptyError);
      return;
    }

    setState({
      ...INITIAL_STATE,
      phase: 'starting',
      torPhase: 'starting',
      torProgress: 0,
    });

    try {
      await bridge.startTorInstance({
        bridgeMode,
        customBridges: bridgeMode === 'custom' ? customBridges.trim() : undefined,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        phase: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const handleRestartWithSnowflake = async () => {
    setValidationError(null);
    setBridgeMode('snowflake');
    setState({
      ...INITIAL_STATE,
      phase: 'bootstrapping',
      torPhase: 'starting',
      torProgress: 0,
    });
    try {
      await bridge.restartTorWithSnowflake();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        phase: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const handleSwitchToCustomBridge = async () => {
    setValidationError(null);
    setBridgeMode('custom');
    try {
      await bridge.stopAndPurge();
    } finally {
      setState(INITIAL_STATE);
    }
  };

  const handleStartLocal = async (enableTunnel: boolean) => {
    setValidationError(null);
    const turnConfig = parseTurnInput({
      turnUrlsText,
      turnUsername,
      turnCredential,
      turnSecret,
    });

    setState({
      ...INITIAL_STATE,
      phase: 'starting',
      tunnelEnabled: enableTunnel,
    });

    try {
      await bridge.startLocalInstance({ enableTunnel, turnConfig });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        phase: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const handleStopAndPurge = async () => {
    setState((prev) => ({ ...prev, phase: 'stopping' }));
    try {
      const result = await bridge.stopAndPurge();
      setTrayNoticeVisible(false);
      setState({
        ...INITIAL_STATE,
        stoppedFeedback: result.purgedDataDir ? 'purged' : 'stopped',
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        phase: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const handleCheckUpdates = async () => {
    if (isTorFlavor || !bridge.checkUpdatesManual || checkingUpdates) return;
    setCheckingUpdates(true);
    setUpdateNotice(null);
    try {
      const result = await bridge.checkUpdatesManual();
      if (!result) {
        setUpdateNotice(dt.local.updateCheckFailedNotice);
        return;
      }
      if (result.updateAvailable) {
        setUpdateNotice(dt.local.updateAvailableNotice(result.latestVersion));
        await bridge.openInBrowser(result.releaseUrl);
      } else {
        setUpdateNotice(dt.local.upToDateNotice(result.latestVersion));
      }
    } catch {
      setUpdateNotice(dt.local.updateCheckFailedNotice);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const statusText = (() => {
    switch (state.phase) {
      case 'idle':
        return dt.statusIdle;
      case 'starting':
        return state.tunnelEnabled ? dt.statusTunnelStarting : dt.statusStarting;
      case 'bootstrapping':
        return dt.statusBootstrapping;
      case 'ready':
        return dt.statusReady;
      case 'stalled':
        return dt.statusStalled;
      case 'stopping':
        return dt.statusStopping;
      case 'error':
        return dt.statusError;
    }
  })();

  const isDark = theme === 'dark';

  return (
    <main className="relative isolate min-h-dvh bg-canvas text-ink px-4 py-4 sm:px-6 sm:py-5">
      <div className="pulso-atmosphere -z-10" aria-hidden="true" />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        {/* Header */}
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <PulsoLogo size="sm" />
            <span className="inline-flex items-center rounded-full border border-line-strong bg-surface/80 px-2.5 py-0.5 text-xs font-semibold text-ink">
              {isTorFlavor ? dt.flavorTorTitle : dt.flavorLocalTitle}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1 rounded-full border border-line bg-surface/75 px-2.5 py-1 text-xs text-ink-2">
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              <select
                aria-label={t.localeSelector.label}
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                className="bg-transparent text-xs font-medium text-ink focus:outline-none cursor-pointer"
              >
                {LOCALE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code} className="bg-surface text-ink">
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? t.theme.switchToLight : t.theme.switchToDark}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface/75 text-ink-2 hover:text-ink cursor-pointer"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Tray minimize notice */}
        {trayNoticeVisible && (
          <section
            role="status"
            className="flex items-start gap-2.5 rounded-2xl border border-accent/30 bg-accent-soft px-3.5 py-3 text-xs text-ink"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden="true" />
            <p className="flex-1 leading-relaxed">{dt.trayMinimizedNotice}</p>
            <button
              type="button"
              aria-label={dt.dismissNotice}
              onClick={() => setTrayNoticeVisible(false)}
              className="rounded-lg p-1 text-ink-2 hover:text-ink cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </section>
        )}

        {/* Main Card */}
        <section
          className="rounded-3xl border border-line bg-surface p-5"
          style={{ boxShadow: 'var(--shadow-panel)' }}
        >
          <p className="text-xs text-ink-2 leading-relaxed">
            {isTorFlavor ? dt.flavorTorSubtitle : dt.flavorLocalSubtitle}
          </p>

          {/* Status Strip */}
          <div className="mt-4 flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface-2/80 px-3.5 py-2.5">
            <div>
              <p className="type-eyebrow text-ink-3">{dt.statusLabel}</p>
              <p className="mt-1 text-sm font-semibold text-ink">{statusText}</p>
            </div>
            {state.phase === 'ready' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" aria-hidden="true" />
            ) : state.phase === 'stalled' || state.phase === 'error' ? (
              <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0" aria-hidden="true" />
            ) : isRunning ? (
              <Loader2 className="h-5 w-5 animate-spin text-accent shrink-0" aria-hidden="true" />
            ) : (
              <LockKeyhole className="h-5 w-5 text-ink-3 shrink-0" aria-hidden="true" />
            )}
          </div>

          {/* Stopped confirmation */}
          {state.stoppedFeedback && (
            <p className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {state.stoppedFeedback === 'purged' ? dt.purgedConfirmation : dt.stoppedConfirmation}
            </p>
          )}

          {/* Error alert */}
          {(validationError || state.errorMessage) && (
            <div
              role="alert"
              className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300"
            >
              {validationError ?? state.errorMessage}
            </div>
          )}

          {/* TOR FLAVOR */}
          {isTorFlavor ? (
            <form onSubmit={handleStartTor} className="mt-4 flex flex-col gap-3">
              <fieldset disabled={!canStart}>
                <legend className="text-xs font-semibold text-ink mb-2">
                  {dt.tor.connectionGroupLabel}
                </legend>
                <div
                  role="radiogroup"
                  aria-label={dt.tor.connectionGroupLabel}
                  className="flex flex-col gap-2"
                >
                  {(
                    [
                      {
                        id: 'direct',
                        label: dt.tor.modeDirectLabel,
                        hint: dt.tor.modeDirectHint,
                      },
                      {
                        id: 'snowflake',
                        label: dt.tor.modeSnowflakeLabel,
                        hint: dt.tor.modeSnowflakeHint,
                      },
                      {
                        id: 'custom',
                        label: dt.tor.modeCustomLabel,
                        hint: dt.tor.modeCustomHint,
                      },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.id}
                      className={`flex items-start gap-2.5 rounded-2xl border p-3 text-left transition-colors ${
                        bridgeMode === option.id
                          ? 'border-accent bg-accent-soft'
                          : 'border-line bg-surface-2/40 hover:border-line-strong'
                      } ${!canStart ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <input
                        type="radio"
                        name="tor-bridge-mode"
                        value={option.id}
                        checked={bridgeMode === option.id}
                        onChange={() => {
                          setBridgeMode(option.id);
                          setValidationError(null);
                        }}
                        disabled={!canStart}
                        className="mt-1 accent-accent"
                      />
                      <span className="flex flex-col">
                        <span className="text-sm font-semibold text-ink">{option.label}</span>
                        <span className="text-xs text-ink-2">{option.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {bridgeMode === 'custom' && (
                <div className="rounded-2xl border border-line bg-surface-2/60 p-3 text-xs">
                  <label htmlFor="custom-bridges-input" className="block font-semibold text-ink">
                    {dt.tor.customBridgesLabel}
                  </label>
                  <textarea
                    id="custom-bridges-input"
                    rows={3}
                    value={customBridges}
                    onChange={(e) => {
                      setCustomBridges(e.target.value);
                      setValidationError(null);
                    }}
                    disabled={!canStart}
                    placeholder={dt.tor.customBridgesPlaceholder}
                    className="mt-1.5 w-full rounded-xl border border-line-strong bg-surface px-2.5 py-2 text-xs font-mono-tabular text-ink focus:outline-none"
                  />
                  <p className="mt-2 font-semibold text-ink-2">{dt.tor.customBridgesHelpTitle}</p>
                  <p className="mt-0.5 text-ink-2 leading-relaxed">{dt.tor.customBridgesHelpBody}</p>
                  <p className="mt-1.5 text-ink-3">{dt.tor.customBridgesRamNotice}</p>
                </div>
              )}

              {/* Tor Progress Stages */}
              {(state.phase === 'bootstrapping' || state.phase === 'starting' || state.phase === 'ready') && (
                <div className="rounded-2xl border border-line bg-surface-2/60 p-3">
                  <div className="flex items-center justify-between text-xs font-medium text-ink">
                    <span>{dt.tor.phases[state.torPhase]}</span>
                    <span className="font-mono-tabular text-ink-2">
                      {dt.tor.progressPercent(state.torProgress)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-200"
                      style={{ width: `${Math.max(4, Math.min(100, state.torProgress))}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Tor Stall Alert */}
              {state.phase === 'stalled' && (
                <div
                  role="alert"
                  className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs"
                >
                  <p className="font-semibold text-amber-800 dark:text-amber-300">
                    {dt.tor.stallTitle}
                  </p>
                  <p className="mt-1 text-ink-2 leading-relaxed">{dt.tor.stallBody}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleRestartWithSnowflake}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-strong cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      {dt.tor.restartSnowflakeButton}
                    </button>
                    <button
                      type="button"
                      onClick={handleSwitchToCustomBridge}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-2 cursor-pointer"
                    >
                      {dt.tor.pasteCustomBridgeButton}
                    </button>
                  </div>
                </div>
              )}

              {canStart && (
                <button
                  type="submit"
                  className="mt-1 inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong cursor-pointer"
                >
                  {dt.tor.startButton}
                </button>
              )}
            </form>
          ) : (
            /* LOCAL / TUNNEL FLAVOR */
            <div className="mt-4 flex flex-col gap-3">
              <div className="rounded-2xl border border-line bg-surface-2/60 p-3 text-xs">
                <p className="font-semibold text-ink">{dt.local.trustModelTitle}</p>
                <p className="mt-1 text-ink-2 leading-relaxed">{dt.local.trustModelBody}</p>
              </div>

              {state.tunnelActive && state.publicOrigin && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                  <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                    {dt.local.tunnelActiveBadge}
                  </p>
                  <p className="mt-1 font-mono-tabular break-all text-ink">
                    {dt.publicOriginLabel}: {state.publicOrigin}
                  </p>
                </div>
              )}

              {state.tunnelError && (
                <div
                  role="alert"
                  className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"
                >
                  {dt.local.tunnelErrorNotice(state.tunnelError)}
                </div>
              )}

              {state.phase === 'ready' && !state.tunnelEnabled && (
                <p className="text-xs text-ink-2">{dt.local.localOnlyReadyNotice}</p>
              )}

              {/* Collapsible Advanced Options (RAM-only TURN) */}
              <div className="rounded-2xl border border-line bg-surface-2/40">
                <button
                  type="button"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((open) => !open)}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-semibold text-ink cursor-pointer"
                >
                  <span>{dt.local.advancedOptionsToggle}</span>
                  {advancedOpen ? (
                    <ChevronUp className="h-4 w-4 text-ink-2" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-ink-2" />
                  )}
                </button>

                {advancedOpen && (
                  <div className="border-t border-line px-3.5 py-3 flex flex-col gap-2.5 text-xs">
                    <p className="text-ink-2">{dt.local.turnRamNotice}</p>
                    <div>
                      <label htmlFor="turn-urls-input" className="block font-medium text-ink">
                        {dt.local.turnUrlsLabel}
                      </label>
                      <input
                        id="turn-urls-input"
                        type="text"
                        value={turnUrlsText}
                        onChange={(e) => setTurnUrlsText(e.target.value)}
                        disabled={!canStart}
                        placeholder={dt.local.turnUrlsPlaceholder}
                        className="mt-1 w-full rounded-xl border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="turn-username-input" className="block font-medium text-ink">
                          {dt.local.turnUsernameLabel}
                        </label>
                        <input
                          id="turn-username-input"
                          type="text"
                          value={turnUsername}
                          onChange={(e) => setTurnUsername(e.target.value)}
                          disabled={!canStart}
                          className="mt-1 w-full rounded-xl border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink"
                        />
                      </div>
                      <div>
                        <label htmlFor="turn-credential-input" className="block font-medium text-ink">
                          {dt.local.turnCredentialLabel}
                        </label>
                        <input
                          id="turn-credential-input"
                          type="password"
                          value={turnCredential}
                          onChange={(e) => setTurnCredential(e.target.value)}
                          disabled={!canStart}
                          className="mt-1 w-full rounded-xl border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="turn-secret-input" className="block font-medium text-ink">
                        {dt.local.turnSecretLabel}
                      </label>
                      <input
                        id="turn-secret-input"
                        type="password"
                        value={turnSecret}
                        onChange={(e) => setTurnSecret(e.target.value)}
                        disabled={!canStart}
                        className="mt-1 w-full rounded-xl border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink"
                      />
                    </div>
                  </div>
                )}
              </div>

              {canStart && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => void handleStartLocal(true)}
                    className="flex-1 inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong cursor-pointer"
                  >
                    {dt.local.startWithTunnelButton}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStartLocal(false)}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-line-strong bg-surface-2 px-4 py-2.5 text-xs font-semibold text-ink hover:bg-surface cursor-pointer"
                  >
                    {dt.local.startLocalOnlyButton}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Active URLs & Lifecycle Actions */}
          {(state.localUrl || state.onionAddress) && (
            <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-line bg-surface-2/70 p-3 text-xs">
              {state.localUrl && (
                <div>
                  <span className="font-semibold text-ink-2">{dt.localUrlLabel}: </span>
                  <span className="font-mono-tabular text-ink">{state.localUrl}</span>
                </div>
              )}
              {state.onionAddress && (
                <div>
                  <span className="font-semibold text-ink-2">{dt.onionUrlLabel}: </span>
                  <span className="font-mono-tabular break-all text-ink">{state.onionAddress}</span>
                </div>
              )}
            </div>
          )}

          {isRunning && (
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              {state.localUrl && (
                <button
                  type="button"
                  onClick={() => void bridge.openInBrowser(state.localUrl!)}
                  className="flex-1 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong cursor-pointer"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {dt.openRoomInBrowser}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleStopAndPurge()}
                disabled={state.phase === 'stopping'}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
              >
                <Power className="h-4 w-4" aria-hidden="true" />
                {dt.stopAndPurge}
              </button>
            </div>
          )}
        </section>

        {/* Version & Update Policy Footer */}
        <footer className="rounded-3xl border border-line bg-surface/85 px-4 py-3.5 text-xs text-ink-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono-tabular font-semibold text-ink">
              v{flavorInfo.appVersion}
              {isTorFlavor && flavorInfo.torVersion
                ? ` · ${dt.tor.torVersionLabel(flavorInfo.torVersion)}`
                : ''}
            </span>

            {!isTorFlavor && bridge.checkUpdatesManual && (
              <button
                type="button"
                onClick={() => void handleCheckUpdates()}
                disabled={checkingUpdates}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-50 cursor-pointer"
              >
                {checkingUpdates ? dt.local.checkingUpdates : dt.local.checkUpdatesButton}
              </button>
            )}
          </div>

          {isTorFlavor ? (
            <div className="mt-2 flex flex-col gap-1 text-ink-2">
              <p className="font-medium text-ink">{dt.tor.zeroClearnetNotice}</p>
              <p>{dt.tor.manualUpdateInstruction}</p>
              <code className="rounded-lg bg-surface-2 px-2 py-1 font-mono-tabular text-[11px] text-ink select-all">
                {dt.tor.manualUpdateMirrorUrl}
              </code>
            </div>
          ) : (
            updateNotice && (
              <p role="status" className="mt-2 font-medium text-ink">
                {updateNotice}
              </p>
            )
          )}
        </footer>
      </div>
    </main>
  );
}

export function DesktopPanel({
  bridge = createTauriDesktopBridge(),
  initialLocale,
  initialTheme,
}: DesktopPanelProps) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <I18nProvider initialLocale={initialLocale}>
        <DesktopPanelContent bridge={bridge} />
      </I18nProvider>
    </ThemeProvider>
  );
}
