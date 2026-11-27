import type { RuntimeInfo } from '../../shared/protocol';

export type TunnelProvider = NonNullable<RuntimeInfo['tunnelProvider']>;

export type TunnelStatus = 'idle' | 'starting' | 'active' | 'stopped' | 'error';

export interface TunnelState {
  provider: TunnelProvider;
  status: TunnelStatus;
  publicOrigin?: string;
  error?: Error;
}

export interface TunnelStartOptions {
  localPort: number;
  localHost?: string;
}

export interface TunnelExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Decoupled interface for reverse-tunnel connectors (e.g., Cloudflare Quick Tunnels)
 * exposing the local Normal-mode Fastify instance over HTTPS/WSS.
 */
export interface TunnelAdapter {
  readonly provider: TunnelProvider;
  getState(): TunnelState;
  start(options: TunnelStartOptions): Promise<string>;
  stop(): Promise<void>;
  on(event: 'status', listener: (state: TunnelState) => void): this;
  on(event: 'ready', listener: (publicOrigin: string) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (info: TunnelExitInfo) => void): this;
  off(event: 'status', listener: (state: TunnelState) => void): this;
  off(event: 'ready', listener: (publicOrigin: string) => void): this;
  off(event: 'error', listener: (error: Error) => void): this;
  off(event: 'exit', listener: (info: TunnelExitInfo) => void): this;
}

/**
 * Merges the current reverse-tunnel state into a RuntimeInfo object exposed by GET /api/runtime.
 */
export function applyTunnelStateToRuntimeInfo(base: RuntimeInfo, state: TunnelState): RuntimeInfo {
  if (state.status === 'active' && state.publicOrigin) {
    return {
      ...base,
      publicOrigin: state.publicOrigin,
      tunnelActive: true,
      tunnelProvider: state.provider,
    };
  }
  const next: RuntimeInfo = {
    runtimeMode: base.runtimeMode,
    tunnelActive: false,
  };
  if (base.onionAddress !== undefined) {
    next.onionAddress = base.onionAddress;
  }
  if (base.torStatus !== undefined) {
    next.torStatus = base.torStatus;
  }
  if (base.turnConfigured !== undefined) {
    next.turnConfigured = base.turnConfigured;
  }
  return next;
}
