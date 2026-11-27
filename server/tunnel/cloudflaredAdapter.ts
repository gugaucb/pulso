import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { ensureDarwinBinarySigned, isExecutableFile } from '../binaryUtils';
import type {
  TunnelAdapter,
  TunnelExitInfo,
  TunnelStartOptions,
  TunnelState,
  TunnelStatus,
} from './tunnelAdapter';

export const DEFAULT_CLOUDFLARED_STARTUP_TIMEOUT_MS = 30_000;
export const DEFAULT_CLOUDFLARED_STOP_TIMEOUT_MS = 3_000;
const MAX_STDERR_TAIL_CHARS = 2048;
const MAX_SCAN_TAIL_CHARS = 1024;
const IGNORED_TRYCLOUDFLARE_SUBDOMAINS = new Set(['api', 'www']);
const TRYCLOUDFLARE_URL_REGEX = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com(?=$|[\s/|"'`<>])/gi;

export interface ResolveCloudflaredBinaryOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  execPath?: string;
  platform?: NodeJS.Platform;
}

export interface CloudflaredAdapterOptions {
  binaryPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  execPath?: string;
  platform?: NodeJS.Platform;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  spawnFn?: typeof spawn;
  execFileSyncFn?: typeof execFileSync;
}

function missingCloudflaredBinaryError(reason: string, binaryName: string): Error {
  return new Error(
    `${reason}. Expected '${binaryName}'. Set PULSO_CLOUDFLARED_BIN or run \`node scripts/fetch-cloudflared.mjs\`.`,
  );
}

/**
 * Resolves the `cloudflared` executable using precedence:
 * 1. `PULSO_CLOUDFLARED_BIN` environment variable
 * 2. Local project `.cloudflared-bin/` directory
 * 3. Sibling binary next to `process.execPath` (bundled Tauri sidecar layout)
 * 4. Executable found on `PATH`
 */
export function resolveCloudflaredBinary(options: ResolveCloudflaredBinaryOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const binaryName = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

  const envBin = env.PULSO_CLOUDFLARED_BIN?.trim();
  if (envBin) {
    const resolvedEnvBin = path.resolve(cwd, envBin);
    if (!isExecutableFile(resolvedEnvBin, platform)) {
      throw missingCloudflaredBinaryError(
        `PULSO_CLOUDFLARED_BIN points to a missing or non-executable binary: ${resolvedEnvBin}`,
        binaryName,
      );
    }
    return resolvedEnvBin;
  }

  const execDir = path.dirname(execPath);
  const candidateDirs = [
    path.resolve(cwd, '.cloudflared-bin'),
    path.resolve(cwd, '.cloudflared-bin', 'cloudflared'),
    execDir,
    path.join(execDir, 'bin'),
  ];

  for (const dir of candidateDirs) {
    const candidate = path.join(dir, binaryName);
    if (isExecutableFile(candidate, platform)) {
      return candidate;
    }
  }

  const rawPath = env.PATH ?? '';
  const delimiter = platform === 'win32' ? ';' : ':';
  for (const entry of rawPath.split(delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const candidate = path.join(trimmed, binaryName);
    if (isExecutableFile(candidate, platform)) {
      return candidate;
    }
  }

  throw missingCloudflaredBinaryError('cloudflared binary not found', binaryName);
}

/**
 * Extracts a `https://<random>.trycloudflare.com` quick-tunnel origin from cloudflared output,
 * ignoring Cloudflare infrastructure hosts such as `api.trycloudflare.com` or `www.trycloudflare.com`.
 */
export function parseTryCloudflareUrl(text: string): string | null {
  TRYCLOUDFLARE_URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TRYCLOUDFLARE_URL_REGEX.exec(text)) !== null) {
    const subdomain = (match[1] ?? '').toLowerCase();
    if (!subdomain || IGNORED_TRYCLOUDFLARE_SUBDOMAINS.has(subdomain)) {
      continue;
    }
    try {
      const parsed = new URL(match[0]);
      if (parsed.protocol === 'https:' && parsed.origin !== 'null') {
        return parsed.origin.toLowerCase();
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Reverse-tunnel adapter powered by `cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate`.
 */
export class CloudflaredAdapter extends EventEmitter implements TunnelAdapter {
  readonly provider = 'cloudflare' as const;

  private readonly options: CloudflaredAdapterOptions;
  private status: TunnelStatus = 'idle';
  private publicOrigin?: string;
  private currentError?: Error;
  private child?: ChildProcess;
  private startPromise?: Promise<string>;
  private stopPromise?: Promise<void>;
  private stopping = false;

  constructor(options: CloudflaredAdapterOptions = {}) {
    super();
    this.options = options;
  }

  getState(): TunnelState {
    return {
      provider: this.provider,
      status: this.status,
      ...(this.publicOrigin !== undefined ? { publicOrigin: this.publicOrigin } : {}),
      ...(this.currentError !== undefined ? { error: this.currentError } : {}),
    };
  }

  async start(startOptions: TunnelStartOptions): Promise<string> {
    if (this.startPromise) {
      return this.startPromise;
    }
    const { localPort, localHost = '127.0.0.1' } = startOptions;
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
      throw new Error(`Invalid localPort for tunnel: ${String(localPort)}`);
    }

    this.stopping = false;
    this.stopPromise = undefined;
    this.startPromise = this.runStart(localHost, localPort);
    return this.startPromise;
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopping = true;
    this.stopPromise = this.runStop();
    return this.stopPromise;
  }

  private emitStatus(): void {
    this.emit('status', this.getState());
  }

  private async runStart(localHost: string, localPort: number): Promise<string> {
    const platform = this.options.platform ?? process.platform;
    const execFileImpl = this.options.execFileSyncFn ?? execFileSync;
    const spawnImpl = this.options.spawnFn ?? spawn;
    const startupTimeoutMs =
      this.options.startupTimeoutMs ?? DEFAULT_CLOUDFLARED_STARTUP_TIMEOUT_MS;

    this.status = 'starting';
    this.publicOrigin = undefined;
    this.currentError = undefined;
    this.emitStatus();

    let binaryPath: string;
    try {
      binaryPath =
        this.options.binaryPath ??
        resolveCloudflaredBinary({
          env: this.options.env,
          cwd: this.options.cwd,
          execPath: this.options.execPath,
          platform,
        });
      ensureDarwinBinarySigned(binaryPath, platform, execFileImpl);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.transitionToError(error);
      throw error;
    }

    const targetUrl = `http://${localHost}:${localPort}`;
    const child = spawnImpl(
      binaryPath,
      ['tunnel', '--url', targetUrl, '--no-autoupdate'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.child = child;

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let scanBuffer = '';
      let stderrTail = '';
      let timer: NodeJS.Timeout | undefined;

      const cleanupListeners = () => {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        child.stdout?.off('data', onOutput);
        child.stderr?.off('data', onStderr);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        this.transitionToError(error);
        void this.terminateChildProcess().finally(() => {
          reject(error);
        });
      };

      const succeed = (origin: string) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        this.status = 'active';
        this.publicOrigin = origin;
        this.currentError = undefined;
        this.emitStatus();
        this.emit('ready', origin);
        resolve(origin);
      };

      const onOutput = (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        scanBuffer = (scanBuffer + text).slice(-MAX_SCAN_TAIL_CHARS);
        const foundOrigin = parseTryCloudflareUrl(scanBuffer);
        if (foundOrigin) {
          succeed(foundOrigin);
        }
      };

      const onStderr = (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        stderrTail = (stderrTail + text).slice(-MAX_STDERR_TAIL_CHARS);
        onOutput(text);
      };

      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onStderr);

      child.once('error', (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        if (!settled) {
          fail(new Error(`Failed to start cloudflared: ${error.message}`));
        } else {
          this.transitionToError(error);
        }
      });

      child.once('exit', (code, signal) => {
        this.child = undefined;
        const exitInfo: TunnelExitInfo = { code, signal };
        if (!settled) {
          if (this.stopping) {
            settled = true;
            cleanupListeners();
            this.status = 'stopped';
            this.publicOrigin = undefined;
            this.emitStatus();
            this.emit('exit', exitInfo);
            reject(new Error('cloudflared stopped before tunnel became ready'));
            return;
          }
          const detail = stderrTail.trim();
          const message =
            `cloudflared exited before tunnel became ready (code=${String(code)}, signal=${String(signal)})` +
            (detail ? `: ${detail}` : '');
          fail(new Error(message));
          return;
        }

        if (this.stopping) {
          this.status = 'stopped';
          this.publicOrigin = undefined;
          this.emitStatus();
          this.emit('exit', exitInfo);
        } else {
          const error = new Error(
            `cloudflared exited unexpectedly (code=${String(code)}, signal=${String(signal)})`,
          );
          this.emit('exit', exitInfo);
          this.transitionToError(error);
        }
      });

      timer = setTimeout(() => {
        fail(
          new Error(
            `Timed out after ${startupTimeoutMs}ms waiting for cloudflared trycloudflare.com URL`,
          ),
        );
      }, startupTimeoutMs);
    });
  }

  private transitionToError(error: Error): void {
    this.status = 'error';
    this.publicOrigin = undefined;
    this.currentError = error;
    this.startPromise = undefined;
    this.emitStatus();
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    }
  }

  private async runStop(): Promise<void> {
    await this.terminateChildProcess();
    this.status = 'stopped';
    this.publicOrigin = undefined;
    this.startPromise = undefined;
    this.emitStatus();
  }

  private async terminateChildProcess(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }

    const stopTimeoutMs = this.options.stopTimeoutMs ?? DEFAULT_CLOUDFLARED_STOP_TIMEOUT_MS;
    if (child.exitCode !== null || child.signalCode !== null) {
      this.child = undefined;
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let forceTimer: NodeJS.Timeout | undefined;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        child.off('exit', finish);
        child.off('error', finish);
        this.child = undefined;
        resolve();
      };

      child.once('exit', finish);
      child.once('error', finish);

      try {
        child.kill('SIGTERM');
      } catch {
        finish();
        return;
      }

      forceTimer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill('SIGKILL');
        } catch {
          // Process already exited
        }
        finish();
      }, stopTimeoutMs);
    });
  }
}
