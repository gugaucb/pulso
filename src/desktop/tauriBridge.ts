import type {
  DesktopBridge,
  DesktopFlavorInfo,
  DesktopLifecycleEvent,
  DesktopUpdateCheckResult,
  SidecarEvent,
  StartLocalInstanceInput,
  StartTorInstanceInput,
} from './types';

export const DEFAULT_RELEASES_API_URL =
  'https://api.github.com/repos/pulso-app/pulso/releases/latest';
export const DEFAULT_RELEASES_PAGE_URL = 'https://github.com/pulso-app/pulso/releases';

interface TauriCoreApi {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

interface TauriEventApi {
  listen: <T = unknown>(
    event: string,
    handler: (event: { payload: T }) => void,
  ) => Promise<() => void>;
}

interface GlobalTauriWindow {
  __TAURI__?: {
    core?: TauriCoreApi;
    event?: TauriEventApi;
  };
}

function getTauriApis(): { core?: TauriCoreApi; event?: TauriEventApi } {
  if (typeof window === 'undefined') return {};
  return (window as GlobalTauriWindow).__TAURI__ ?? {};
}

export function compareSemver(a: string, b: string): number {
  const clean = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const pa = clean(a);
  const pb = clean(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Performs a single on-demand GET request to the release manifest (used ONLY in Local flavor).
 */
export async function fetchLatestReleaseManifest(
  currentVersion: string,
  manifestUrl = DEFAULT_RELEASES_API_URL,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<DesktopUpdateCheckResult | null> {
  const response = await fetchFn(manifestUrl, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as {
    tag_name?: string;
    html_url?: string;
  };
  const rawTag = typeof data.tag_name === 'string' ? data.tag_name.trim() : '';
  if (!rawTag) {
    return null;
  }
  const latestVersion = rawTag.replace(/^v/i, '');
  const releaseUrl =
    typeof data.html_url === 'string' && data.html_url.startsWith('https://')
      ? data.html_url
      : DEFAULT_RELEASES_PAGE_URL;

  return {
    latestVersion,
    releaseUrl,
    updateAvailable: compareSemver(latestVersion, currentVersion) > 0,
  };
}

function subscribeTauriEvent<T>(eventName: string, listener: (payload: T) => void): () => void {
  const { event } = getTauriApis();
  if (!event?.listen) return () => {};
  let disposed = false;
  let unlistenFn: (() => void) | undefined;
  void event
    .listen<T>(eventName, (msg) => {
      if (!disposed && msg?.payload) {
        listener(msg.payload);
      }
    })
    .then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    });
  return () => {
    disposed = true;
    unlistenFn?.();
  };
}

export function createTauriDesktopBridge(): DesktopBridge {
  let cachedFlavorInfo: DesktopFlavorInfo | null = null;

  const invoke = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    const { core } = getTauriApis();
    if (!core?.invoke) {
      throw new Error(`Tauri runtime unavailable for command '${cmd}'`);
    }
    return core.invoke<T>(cmd, args);
  };

  const getFlavorInfo = async (): Promise<DesktopFlavorInfo> => {
    const { core } = getTauriApis();
    if (!core?.invoke) {
      return { flavor: 'local', appVersion: '0.1.0' };
    }
    const info = await core.invoke<DesktopFlavorInfo>('get_flavor_info');
    cachedFlavorInfo = info;
    return info;
  };

  return {
    getFlavorInfo,
    startTorInstance: (input: StartTorInstanceInput) =>
      invoke<void>('start_tor_instance', {
        bridgeMode: input.bridgeMode,
        customBridges: input.customBridges ?? null,
      }),
    restartTorWithSnowflake: () => invoke<void>('restart_tor_with_snowflake'),
    startLocalInstance: (input: StartLocalInstanceInput) =>
      invoke<void>('start_local_instance', {
        enableTunnel: input.enableTunnel,
        turnConfig: input.turnConfig ?? null,
      }),
    stopAndPurge: () => invoke<{ purgedDataDir?: boolean }>('stop_and_purge'),
    openInBrowser: (url: string) => invoke<void>('open_in_browser', { url }),
    checkUpdatesManual: async () => {
      const info = cachedFlavorInfo ?? (await getFlavorInfo());
      if (info.flavor === 'tor') {
        return null;
      }
      return fetchLatestReleaseManifest(info.appVersion);
    },
    subscribeSidecarEvents: (listener) =>
      subscribeTauriEvent<SidecarEvent>('pulso://sidecar-event', listener),
    subscribeLifecycleEvents: (listener) =>
      subscribeTauriEvent<DesktopLifecycleEvent>('pulso://lifecycle-event', listener),
  };
}
