import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopPanel } from './DesktopPanel';
import { fetchLatestReleaseManifest } from './tauriBridge';
import type { DesktopBridge, DesktopFlavor, DesktopLifecycleEvent, SidecarEvent } from './types';

interface MockDesktopBridgeHandle {
  bridge: DesktopBridge;
  emitSidecarEvent: (event: SidecarEvent) => void;
  emitLifecycleEvent: (event: DesktopLifecycleEvent) => void;
  startTorInstance: ReturnType<typeof vi.fn>;
  restartTorWithSnowflake: ReturnType<typeof vi.fn>;
  startLocalInstance: ReturnType<typeof vi.fn>;
  stopAndPurge: ReturnType<typeof vi.fn>;
  openInBrowser: ReturnType<typeof vi.fn>;
  checkUpdatesManual: ReturnType<typeof vi.fn>;
}

function createMockBridge(
  flavor: DesktopFlavor,
  overrides: { appVersion?: string; torVersion?: string } = {},
): MockDesktopBridgeHandle {
  const sidecarListeners = new Set<(event: SidecarEvent) => void>();
  const lifecycleListeners = new Set<(event: DesktopLifecycleEvent) => void>();

  const startTorInstance = vi.fn().mockResolvedValue(undefined);
  const restartTorWithSnowflake = vi.fn().mockResolvedValue(undefined);
  const startLocalInstance = vi.fn().mockResolvedValue(undefined);
  const stopAndPurge = vi.fn().mockResolvedValue({ purgedDataDir: flavor === 'tor' });
  const openInBrowser = vi.fn().mockResolvedValue(undefined);
  const checkUpdatesManual = vi.fn().mockResolvedValue({
    latestVersion: '0.2.0',
    releaseUrl: 'https://github.com/gugaucb/pulso/releases/tag/v0.2.0',
    updateAvailable: true,
  });

  const bridge: DesktopBridge = {
    getFlavorInfo: vi.fn().mockResolvedValue({
      flavor,
      appVersion: overrides.appVersion ?? '0.1.0',
      torVersion: overrides.torVersion ?? (flavor === 'tor' ? '16.0' : undefined),
    }),
    startTorInstance,
    restartTorWithSnowflake,
    startLocalInstance,
    stopAndPurge,
    openInBrowser,
    checkUpdatesManual,
    subscribeSidecarEvents: (listener) => {
      sidecarListeners.add(listener);
      return () => sidecarListeners.delete(listener);
    },
    subscribeLifecycleEvents: (listener) => {
      lifecycleListeners.add(listener);
      return () => lifecycleListeners.delete(listener);
    },
  };

  return {
    bridge,
    emitSidecarEvent: (event) => {
      act(() => {
        for (const listener of sidecarListeners) listener(event);
      });
    },
    emitLifecycleEvent: (event) => {
      act(() => {
        for (const listener of lifecycleListeners) listener(event);
      });
    },
    startTorInstance,
    restartTorWithSnowflake,
    startLocalInstance,
    stopAndPurge,
    openInBrowser,
    checkUpdatesManual,
  };
}

describe('DesktopPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage?.clear?.();
    window.sessionStorage?.clear?.();
  });

  it('handles PULSO Tor pre-boot bridge selection, progress stages, room launch, purge, and zero clearnet requests', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mock = createMockBridge('tor');

    render(<DesktopPanel bridge={mock.bridge} initialLocale="pt-br" />);

    await waitFor(() => {
      expect(screen.getByText(/PULSO Tor/i)).toBeInTheDocument();
    });

    // Version info + zero clearnet guarantee + Tor Browser manual update hint
    expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Tor 16\.0/)).toBeInTheDocument();
    expect(screen.getByText(/zero requisições na clearnet/i)).toBeInTheDocument();
    expect(screen.getByText(/Tor Browser/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /verificar atualizações/i })).not.toBeInTheDocument();

    // 3 pre-boot modes
    const modeGroup = screen.getByRole('radiogroup', { name: /modo de conexão tor/i });
    const directRadio = within(modeGroup).getByRole('radio', { name: /conexão direta/i });
    const snowflakeRadio = within(modeGroup).getByRole('radio', { name: /snowflake embutido/i });
    const customRadio = within(modeGroup).getByRole('radio', { name: /bridge personalizada/i });

    expect(directRadio).toBeChecked();

    // Switch to custom bridge mode and verify BridgeDB/@GetBridgesBot/email hints
    await user.click(customRadio);
    expect(customRadio).toBeChecked();
    expect(screen.getByText(/bridges\.torproject\.org/i)).toBeInTheDocument();
    expect(screen.getByText(/@GetBridgesBot/i)).toBeInTheDocument();
    expect(screen.getByText(/bridges@torproject\.org/i)).toBeInTheDocument();
    expect(screen.getByText(/zero persistência entre sessões/i)).toBeInTheDocument();

    // Validation when custom bridge textarea is empty
    await user.click(screen.getByRole('button', { name: /iniciar instância tor/i }));
    expect(mock.startTorInstance).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/cole ao menos uma linha de bridge/i);

    // Switch to Snowflake and start
    await user.click(snowflakeRadio);
    await user.click(screen.getByRole('button', { name: /iniciar instância tor/i }));
    expect(mock.startTorInstance).toHaveBeenCalledWith({
      bridgeMode: 'snowflake',
      customBridges: undefined,
    });

    // Emit sidecar NDJSON events
    mock.emitSidecarEvent({
      event: 'listening',
      mode: 'tor',
      port: 41234,
      localUrl: 'http://127.0.0.1:41234',
      dataDir: '/tmp/pulso-tor-abc',
    });
    mock.emitSidecarEvent({
      event: 'tor_progress',
      phase: 'conn_pt',
      progress: 15,
      bridgeMode: 'snowflake',
    });

    await waitFor(() => {
      expect(screen.getByText(/conectando à ponte anti-censura/i)).toBeInTheDocument();
      expect(screen.getByText(/15%/)).toBeInTheDocument();
    });

    mock.emitSidecarEvent({
      event: 'tor_progress',
      phase: 'hs_desc',
      progress: 100,
      bridgeMode: 'snowflake',
      hsDescAction: 'UPLOAD',
    });
    await waitFor(() => {
      expect(screen.getByText(/publicando endereço \.onion/i)).toBeInTheDocument();
    });

    const onionUrl = `http://${'a'.repeat(56)}.onion`;
    mock.emitSidecarEvent({
      event: 'tor_ready',
      onionAddress: onionUrl,
      bridgeMode: 'snowflake',
    });

    await waitFor(() => {
      expect(screen.getByText(onionUrl)).toBeInTheDocument();
    });

    // Open in browser
    await user.click(screen.getByRole('button', { name: /abrir sala no navegador/i }));
    expect(mock.openInBrowser).toHaveBeenCalledWith('http://127.0.0.1:41234');

    // Stop and purge
    await user.click(screen.getByRole('button', { name: /encerrar e purgar rastro/i }));
    expect(mock.stopAndPurge).toHaveBeenCalledTimes(1);

    mock.emitSidecarEvent({ event: 'stopped', purgedDataDir: true });
    await waitFor(() => {
      expect(screen.getByText(/rastro temporário purgado/i)).toBeInTheDocument();
    });

    // Zero clearnet requests and zero storage persistence
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage?.length ?? 0).toBe(0);
    expect(window.sessionStorage?.length ?? 0).toBe(0);
  });

  it('passes custom bridges only in RAM and recovers from Tor stall with 1-click Snowflake restart or custom bridge switch', async () => {
    const user = userEvent.setup();
    const mock = createMockBridge('tor');

    render(<DesktopPanel bridge={mock.bridge} initialLocale="pt-br" />);
    await waitFor(() => expect(screen.getByText(/PULSO Tor/i)).toBeInTheDocument());

    // Start in direct mode
    await user.click(screen.getByRole('button', { name: /iniciar instância tor/i }));
    expect(mock.startTorInstance).toHaveBeenCalledWith({
      bridgeMode: 'direct',
      customBridges: undefined,
    });

    // Simulate stall on direct connection
    mock.emitSidecarEvent({
      event: 'tor_stall',
      reason: 'bootstrap_stalled',
      bridgeMode: 'direct',
      progress: 10,
      bootstrapReason: 'connect_failed',
    });

    await waitFor(() => {
      expect(screen.getByText(/a rede pode estar bloqueando o tor/i)).toBeInTheDocument();
    });

    // 1-click restart with Snowflake
    await user.click(
      screen.getByRole('button', { name: /reiniciar com snowflake \(anti-censura\)/i }),
    );
    expect(mock.restartTorWithSnowflake).toHaveBeenCalledTimes(1);

    // Simulate stall again and switch to custom bridge
    mock.emitSidecarEvent({
      event: 'tor_stall',
      reason: 'warn_bootstrap',
      bridgeMode: 'snowflake',
      progress: 20,
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /colar bridge personalizada/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /colar bridge personalizada/i }));
    expect(mock.stopAndPurge).toHaveBeenCalledTimes(1);

    const bridgeLine = 'obfs4 198.51.100.42:443 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA cert=test iat-mode=0';
    const textarea = await screen.findByLabelText(/linhas de bridge/i);
    await user.type(textarea, bridgeLine);
    await user.click(screen.getByRole('button', { name: /iniciar instância tor/i }));

    expect(mock.startTorInstance).toHaveBeenLastCalledWith({
      bridgeMode: 'custom',
      customBridges: bridgeLine,
    });
    expect(window.localStorage?.length ?? 0).toBe(0);
    expect(window.sessionStorage?.length ?? 0).toBe(0);
  });

  it('handles PULSO Local / Tunnel opt-in flow, RAM-only TURN credentials, manual update check, and tray minimize notice', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mock = createMockBridge('local', { appVersion: '0.1.0' });

    render(<DesktopPanel bridge={mock.bridge} initialLocale="pt-br" />);

    await waitFor(() => {
      expect(screen.getByText(/PULSO Local \/ Túnel/i)).toBeInTheDocument();
    });

    // Never performs automatic background update check on mount
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mock.checkUpdatesManual).not.toHaveBeenCalled();
    expect(screen.getByText(/modelo de confiança do túnel/i)).toBeInTheDocument();
    expect(screen.getByText(/cloudflare/i)).toBeInTheDocument();

    // Open collapsible Opções avançadas and enter RAM-only TURN credentials
    await user.click(screen.getByRole('button', { name: /opções avançadas/i }));
    await user.type(screen.getByLabelText(/urls turn/i), 'turn:turn.example.org:3478');
    await user.type(screen.getByLabelText(/usuário turn/i), 'alice');
    await user.type(screen.getByLabelText(/credencial turn/i), 'ram-secret');

    // Opt-in 1-click start with tunnel
    await user.click(screen.getByRole('button', { name: /iniciar instância com túnel/i }));
    expect(mock.startLocalInstance).toHaveBeenCalledWith({
      enableTunnel: true,
      turnConfig: {
        turnUrls: ['turn:turn.example.org:3478'],
        turnUsername: 'alice',
        turnCredential: 'ram-secret',
      },
    });

    mock.emitSidecarEvent({
      event: 'listening',
      mode: 'local',
      port: 39120,
      localUrl: 'http://127.0.0.1:39120',
      tunnelEnabled: true,
    });
    mock.emitSidecarEvent({ event: 'tunnel_starting', provider: 'cloudflare' });
    mock.emitSidecarEvent({
      event: 'tunnel_ready',
      provider: 'cloudflare',
      publicOrigin: 'https://pulso-demo.trycloudflare.com',
    });

    await waitFor(() => {
      expect(screen.getByText(/túnel cloudflare ativo/i)).toBeInTheDocument();
      expect(screen.getByText(/https:\/\/pulso-demo\.trycloudflare\.com/)).toBeInTheDocument();
    });

    // Tray minimize notice
    mock.emitLifecycleEvent({ event: 'window_minimized_to_tray' });
    await waitFor(() => {
      expect(screen.getByText(/bandeja do sistema/i)).toBeInTheDocument();
    });

    // Manual on-demand update check
    await user.click(screen.getByRole('button', { name: /verificar atualizações/i }));
    await waitFor(() => {
      expect(mock.checkUpdatesManual).toHaveBeenCalledTimes(1);
      expect(mock.openInBrowser).toHaveBeenCalledWith(
        'https://github.com/gugaucb/pulso/releases/tag/v0.2.0',
      );
      expect(screen.getByText(/nova versão v0\.2\.0 disponível/i)).toBeInTheDocument();
    });

    // Zero storage persistence for TURN secrets
    expect(window.localStorage?.length ?? 0).toBe(0);
    expect(window.sessionStorage?.length ?? 0).toBe(0);
  });

  it('performs exactly one GET request when fetchLatestReleaseManifest is triggered manually', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v0.3.0',
        html_url: 'https://github.com/gugaucb/pulso/releases/tag/v0.3.0',
      }),
    });

    const result = await fetchLatestReleaseManifest(
      '0.1.0',
      'https://api.github.com/repos/gugaucb/pulso/releases/latest',
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/gugaucb/pulso/releases/latest',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual({
      latestVersion: '0.3.0',
      releaseUrl: 'https://github.com/gugaucb/pulso/releases/tag/v0.3.0',
      updateAvailable: true,
    });
  });

  it('renders canonical GLOSSARY vocabulary across all 4 locales (pt-br, en, es, zh-CN)', async () => {
    const user = userEvent.setup();
    const mock = createMockBridge('local');

    render(<DesktopPanel bridge={mock.bridge} initialLocale="pt-br" />);
    await waitFor(() => expect(screen.getByText(/PULSO Local \/ Túnel/i)).toBeInTheDocument());

    const localeSelect = screen.getByLabelText(/idioma/i);

    await user.selectOptions(localeSelect, 'en');
    expect(screen.getByRole('button', { name: /start instance with tunnel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeInTheDocument();

    await user.selectOptions(localeSelect, 'es');
    expect(screen.getByRole('button', { name: /iniciar instancia con túnel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /buscar actualizaciones/i })).toBeInTheDocument();

    await user.selectOptions(localeSelect, 'zh-CN');
    expect(screen.getByRole('button', { name: /启动实例并开启隧道/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /检查更新/i })).toBeInTheDocument();
  });
});
