export type DesktopFlavor = 'tor' | 'local';
export type TorBridgeMode = 'direct' | 'snowflake' | 'custom';
export type TorBootstrapPhase =
  | 'starting'
  | 'conn_pt'
  | 'conn_done_pt'
  | 'handshake_pt'
  | 'bootstrap'
  | 'hs_desc'
  | 'ready'
  | 'error';

export type SidecarEvent =
  | {
      event: 'listening';
      mode: DesktopFlavor;
      port: number;
      localUrl: string;
      dataDir?: string;
      tunnelEnabled?: boolean;
    }
  | {
      event: 'tor_progress';
      phase: TorBootstrapPhase;
      progress: number;
      bridgeMode: TorBridgeMode;
      tag?: string;
      summary?: string;
      hsDescAction?: string;
    }
  | {
      event: 'tor_stall';
      reason: 'bootstrap_stalled' | 'warn_bootstrap';
      bridgeMode: TorBridgeMode;
      progress: number;
      tag?: string;
      summary?: string;
      bootstrapReason?: string;
    }
  | {
      event: 'tor_ready';
      onionAddress: string;
      bridgeMode: TorBridgeMode;
    }
  | {
      event: 'tunnel_starting';
      provider: 'cloudflare';
    }
  | {
      event: 'tunnel_ready';
      provider: 'cloudflare';
      publicOrigin: string;
    }
  | {
      event: 'tunnel_error';
      provider: 'cloudflare';
      message: string;
    }
  | {
      event: 'error';
      message: string;
      code?: string;
    }
  | {
      event: 'stopping';
    }
  | {
      event: 'stopped';
      purgedDataDir?: boolean;
    };

export type DesktopLifecycleEvent =
  | {
      event: 'window_minimized_to_tray';
    }
  | {
      event: 'instance_reset';
    };

export interface DesktopFlavorInfo {
  flavor: DesktopFlavor;
  appVersion: string;
  torVersion?: string;
}

export interface DesktopTurnConfig {
  turnUrls?: string[];
  turnUsername?: string;
  turnCredential?: string;
  turnSecret?: string;
}

export interface StartTorInstanceInput {
  bridgeMode: TorBridgeMode;
  customBridges?: string;
}

export interface StartLocalInstanceInput {
  enableTunnel: boolean;
  turnConfig?: DesktopTurnConfig;
}

export interface DesktopUpdateCheckResult {
  latestVersion: string;
  releaseUrl: string;
  updateAvailable: boolean;
}

export interface DesktopBridge {
  getFlavorInfo: () => Promise<DesktopFlavorInfo>;
  startTorInstance: (input: StartTorInstanceInput) => Promise<void>;
  restartTorWithSnowflake: () => Promise<void>;
  startLocalInstance: (input: StartLocalInstanceInput) => Promise<void>;
  stopAndPurge: () => Promise<{ purgedDataDir?: boolean }>;
  openInBrowser: (url: string) => Promise<void>;
  checkUpdatesManual?: () => Promise<DesktopUpdateCheckResult | null>;
  subscribeSidecarEvents: (listener: (event: SidecarEvent) => void) => () => void;
  subscribeLifecycleEvents: (listener: (event: DesktopLifecycleEvent) => void) => () => void;
}
