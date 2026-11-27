import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { accessSync, constants, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import {
  ControlPortClient,
  parseControlPortFile,
  type ControlAsyncEvent,
  type ControlEndpoint,
} from './controlProtocol';

const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;
const CONTROL_COMMAND_SHUTDOWN_TIMEOUT_MS = 1_500;
const MAX_STDERR_CHARS = 2048;

export type TorStatus = 'bootstrapping' | 'ready' | 'error';

export interface TorControllerState {
  status: TorStatus;
  onionAddress?: string;
  serviceId?: string;
  bootstrapProgress: number;
  error?: Error;
}

export interface ResolveTorBinaryOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
}

export interface TorControllerOptions {
  localPort: number;
  dataDir?: string;
  torBinaryPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
  startupTimeoutMs?: number;
  controlFilePollIntervalMs?: number;
  stopTimeoutMs?: number;
  spawnFn?: typeof spawn;
  connectFn?: (endpoint: ControlEndpoint) => Duplex;
  randomBytesFn?: (size: number) => Buffer;
  execFileSyncFn?: typeof execFileSync;
}

function isExecutableFile(filePath: string, platform: NodeJS.Platform): boolean {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    const mode = platform === 'win32' ? constants.F_OK : constants.X_OK;
    accessSync(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

function missingTorBinaryError(reason: string): Error {
  return new Error(
    `${reason}. Set PULSO_TOR_BIN to your tor executable path, or run \`node scripts/fetch-tor-bundle.mjs\` (see docs/tor-mode.md).`,
  );
}

/**
 * Resolves the Tor daemon binary using the precedence:
 * 1. PULSO_TOR_BIN environment variable
 * 2. Local project tools directory (.tor-bin/tor or .tor-bin/tor/tor)
 * 3. `tor` executable found on PATH
 */
export function resolveTorBinary(options: ResolveTorBinaryOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const binaryName = platform === 'win32' ? 'tor.exe' : 'tor';

  const envBin = env.PULSO_TOR_BIN?.trim();
  if (envBin) {
    const resolvedEnvBin = path.resolve(cwd, envBin);
    if (!isExecutableFile(resolvedEnvBin, platform)) {
      throw missingTorBinaryError(`PULSO_TOR_BIN points to a missing or non-executable binary: ${resolvedEnvBin}`);
    }
    return resolvedEnvBin;
  }

  const localCandidates = [
    path.resolve(cwd, '.tor-bin', binaryName),
    path.resolve(cwd, '.tor-bin', 'tor', binaryName),
  ];
  for (const candidate of localCandidates) {
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

  throw missingTorBinaryError('Tor daemon binary not found');
}

/**
 * Ensures Mach-O executables on macOS (especially Apple Silicon arm64) carry a valid code signature.
 * Unsigned arm64 binaries are terminated by the macOS kernel with SIGKILL (code 137).
 */
export function ensureDarwinBinarySigned(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform,
  execFileImpl: typeof execFileSync = execFileSync,
): void {
  if (platform !== 'darwin') return;
  try {
    execFileImpl('codesign', ['-v', binaryPath], { stdio: 'ignore' });
  } catch {
    try {
      const dylib = path.join(path.dirname(binaryPath), 'libevent-2.1.7.dylib');
      try {
        const stat = statSync(dylib);
        if (stat.isFile()) {
          execFileImpl('codesign', ['-s', '-', '--force', dylib], { stdio: 'ignore' });
        }
      } catch {
        // sibling dylib is optional
      }
      execFileImpl('codesign', ['-s', '-', '--force', binaryPath], { stdio: 'ignore' });
    } catch {
      // If codesign fails or is unavailable, let execution proceed to spawn
    }
  }
}

function formatTorrcPath(filePath: string): string {
  if (!/[\s"\\]/.test(filePath)) {
    return filePath;
  }
  const escaped = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Generates an isolated torrc configuration with SocksPort disabled and cookie-authenticated ControlPort.
 */
export function buildTorrcContent(options: {
  dataDir: string;
  controlPortFile: string;
  cookieFile: string;
}): string {
  return [
    `DataDirectory ${formatTorrcPath(options.dataDir)}`,
    'SocksPort 0',
    'ControlPort auto',
    `ControlPortWriteToFile ${formatTorrcPath(options.controlPortFile)}`,
    'CookieAuthentication 1',
    `CookieAuthFile ${formatTorrcPath(options.cookieFile)}`,
    'AvoidDiskWrites 1',
    '',
  ].join('\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForStreamReady(stream: Duplex, timeoutMs: number): Promise<void> {
  const socketLike = stream as Duplex & { connecting?: boolean };
  if (!socketLike.connecting) {
    return;
  }
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        stream.off('connect', onConnect);
        stream.off('error', onError);
      };
      stream.once('connect', onConnect);
      stream.once('error', onError);
    }),
    timeoutMs,
    'Timed out connecting to Tor ControlPort',
  );
}

/**
 * Manages the ephemeral lifecycle of a local Tor daemon and RAM-only v3 Onion Service.
 */
export class TorController extends EventEmitter {
  private readonly options: TorControllerOptions;
  private readonly dataDirPath: string;
  private currentStatus: TorStatus = 'bootstrapping';
  private currentServiceId?: string;
  private currentOnionAddress?: string;
  private bootstrapProgress = 0;
  private currentError?: Error;

  private child?: ChildProcess;
  private childExitError?: Error;
  private client?: ControlPortClient;
  private stderrTail = '';
  private startPromise?: Promise<string>;
  private stopPromise?: Promise<void>;
  private stopping = false;

  constructor(options: TorControllerOptions) {
    super();
    this.options = options;
    const baseCwd = options.cwd ?? process.cwd();
    this.dataDirPath = options.dataDir ?? path.resolve(baseCwd, 'tor_data');
  }

  get status(): TorStatus {
    return this.currentStatus;
  }

  get onionAddress(): string | undefined {
    return this.currentOnionAddress;
  }

  get serviceId(): string | undefined {
    return this.currentServiceId;
  }

  get dataDir(): string {
    return this.dataDirPath;
  }

  getState(): TorControllerState {
    return {
      status: this.currentStatus,
      onionAddress: this.currentOnionAddress,
      serviceId: this.currentServiceId,
      bootstrapProgress: this.bootstrapProgress,
      error: this.currentError,
    };
  }

  async start(): Promise<string> {
    if (this.startPromise) {
      return this.startPromise;
    }
    this.stopping = false;
    this.stopPromise = undefined;
    this.startPromise = this.runStart();
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

  private async runStart(): Promise<string> {
    const startupTimeoutMs = this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    const deadline = Date.now() + startupTimeoutMs;

    try {
      this.currentStatus = 'bootstrapping';
      this.bootstrapProgress = 0;
      this.currentError = undefined;
      this.emitStatus();

      const torBinary =
        this.options.torBinaryPath ??
        resolveTorBinary({
          env: this.options.env,
          cwd: this.options.cwd,
          platform: this.options.platform,
        });

      await rm(this.dataDirPath, { recursive: true, force: true });
      await mkdir(this.dataDirPath, { recursive: true, mode: 0o700 });

      const torrcPath = path.join(this.dataDirPath, 'torrc');
      const controlPortFile = path.join(this.dataDirPath, 'control.port');
      const cookieFile = path.join(this.dataDirPath, 'control_auth_cookie');

      await writeFile(
        torrcPath,
        buildTorrcContent({ dataDir: this.dataDirPath, controlPortFile, cookieFile }),
        { encoding: 'utf8', mode: 0o600 },
      );

      const platform = this.options.platform ?? process.platform;
      const execFileImpl = this.options.execFileSyncFn ?? execFileSync;
      ensureDarwinBinarySigned(torBinary, platform, execFileImpl);

      this.spawnTorProcess(torBinary, torrcPath);

      const { endpoint, cookieBytes } = await this.waitForControlArtifacts(
        controlPortFile,
        cookieFile,
        deadline,
      );

      const remainingMs = Math.max(100, deadline - Date.now());
      const stream = (this.options.connectFn ?? ((ep) => net.createConnection(ep)))(endpoint);
      await waitForStreamReady(stream, remainingMs);

      const client = new ControlPortClient(stream);
      this.client = client;

      await withTimeout(
        client.authenticateSafeCookie(cookieBytes, this.options.randomBytesFn),
        Math.max(100, deadline - Date.now()),
        'Timed out authenticating to Tor ControlPort',
      );

      const readiness = this.trackReadiness(client, deadline);
      await withTimeout(
        client.setEvents(['STATUS_CLIENT', 'HS_DESC']),
        Math.max(100, deadline - Date.now()),
        'Timed out subscribing to Tor events',
      );

      const serviceId = await withTimeout(
        client.addOnion(this.options.localPort),
        Math.max(100, deadline - Date.now()),
        'Timed out provisioning Tor Onion Service',
      );
      this.currentServiceId = serviceId;
      readiness.setExpectedServiceId(serviceId);

      await readiness.promise;

      const onionAddress = `http://${serviceId}.onion`;
      this.currentOnionAddress = onionAddress;
      this.currentStatus = 'ready';
      this.emitStatus();
      this.emit('ready', onionAddress);
      return onionAddress;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.currentStatus = 'error';
      this.currentError = error;
      this.emitStatus();
      if (this.listenerCount('error') > 0) {
        this.emit('error', error);
      }
      await this.cleanupAfterFailure();
      throw error;
    }
  }

  private spawnTorProcess(torBinary: string, torrcPath: string): void {
    const spawnImpl = this.options.spawnFn ?? spawn;
    this.childExitError = undefined;
    this.stderrTail = '';

    const child = spawnImpl(torBinary, ['-f', torrcPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      this.stderrTail = (this.stderrTail + text).slice(-MAX_STDERR_CHARS);
    });

    child.once('error', (err) => {
      this.childExitError = new Error(`Failed to spawn Tor process: ${err.message}`);
    });

    child.once('exit', (code, signal) => {
      if (!this.stopping && this.currentStatus !== 'ready') {
        const detailParts: string[] = [];
        if (this.stderrTail.trim()) {
          detailParts.push(this.stderrTail.trim());
        }
        const platform = this.options.platform ?? process.platform;
        if (signal === 'SIGKILL' && platform === 'darwin') {
          detailParts.push(
            'macOS killed Tor with SIGKILL. On Apple Silicon, verify that Tor binary is ad-hoc signed (`codesign -s - --force <path>`) or reinstall via `node scripts/fetch-tor-bundle.mjs`',
          );
        }
        const detail = detailParts.length > 0 ? ` (${detailParts.join(' - ')})` : '';
        this.childExitError = new Error(
          `Tor process exited prematurely (code=${String(code)}, signal=${String(signal)})${detail}`,
        );
      }
    });
  }

  private async waitForControlArtifacts(
    controlPortFile: string,
    cookieFile: string,
    deadline: number,
  ): Promise<{ endpoint: ControlEndpoint; cookieBytes: Buffer }> {
    const pollMs = this.options.controlFilePollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    while (Date.now() < deadline) {
      if (this.childExitError) {
        throw this.childExitError;
      }

      try {
        const [portContent, cookieBytes] = await Promise.all([
          readFile(controlPortFile, 'utf8'),
          readFile(cookieFile),
        ]);
        if (cookieBytes.length === 32) {
          const endpoint = parseControlPortFile(portContent);
          return { endpoint, cookieBytes };
        }
      } catch {
        // Files not yet written by Tor daemon.
      }

      await delay(pollMs);
    }

    throw new Error('Timed out waiting for Tor ControlPort and auth cookie files');
  }

  private trackReadiness(
    client: ControlPortClient,
    deadline: number,
  ): { promise: Promise<void>; setExpectedServiceId: (id: string) => void } {
    let expectedServiceId: string | undefined;
    let bootstrapped = false;
    let descriptorUploaded = false;
    let settled = false;
    let resolveFn!: () => void;
    let rejectFn!: (err: Error) => void;

    const promise = new Promise<void>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const checkReady = () => {
      if (!settled && bootstrapped && descriptorUploaded) {
        settled = true;
        cleanup();
        resolveFn();
      }
    };

    const onEvent = (event: ControlAsyncEvent) => {
      if (event.type === 'status_client' && event.action === 'BOOTSTRAP' && event.progress !== undefined) {
        this.bootstrapProgress = event.progress;
        if (event.progress >= 100) {
          bootstrapped = true;
          checkReady();
        }
      } else if (event.type === 'hs_desc' && event.action === 'UPLOADED') {
        if (!event.serviceId || !expectedServiceId || event.serviceId === expectedServiceId) {
          descriptorUploaded = true;
          checkReady();
        }
      }
    };

    const unsubscribe = client.onEvent(onEvent);

    const checkTimer = setInterval(() => {
      if (settled) return;
      if (this.childExitError) {
        settled = true;
        cleanup();
        rejectFn(this.childExitError);
      } else if (Date.now() >= deadline) {
        settled = true;
        cleanup();
        rejectFn(new Error('Timed out waiting for Tor bootstrap and HS_DESC upload'));
      }
    }, 25);

    const cleanup = () => {
      clearInterval(checkTimer);
      unsubscribe();
    };

    return {
      promise,
      setExpectedServiceId: (id: string) => {
        expectedServiceId = id;
      },
    };
  }

  private async cleanupAfterFailure(): Promise<void> {
    this.stopping = true;
    this.client?.close();
    this.client = undefined;
    await this.terminateChildProcess();
    await rm(this.dataDirPath, { recursive: true, force: true });
  }

  private async runStop(): Promise<void> {
    const client = this.client;
    this.client = undefined;

    if (client) {
      try {
        if (this.currentServiceId) {
          await withTimeout(
            client.delOnion(this.currentServiceId),
            CONTROL_COMMAND_SHUTDOWN_TIMEOUT_MS,
            'DEL_ONION timeout',
          ).catch(() => {});
        }
        await withTimeout(
          client.signalShutdown(),
          CONTROL_COMMAND_SHUTDOWN_TIMEOUT_MS,
          'SIGNAL SHUTDOWN timeout',
        ).catch(() => {});
      } finally {
        client.close();
      }
    }

    await this.terminateChildProcess();
    await rm(this.dataDirPath, { recursive: true, force: true });
  }

  private async terminateChildProcess(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    const stopTimeoutMs = this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;

    await new Promise<void>((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        resolve();
      };

      child.once('exit', done);

      const termTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
        }
      }, Math.min(250, stopTimeoutMs));

      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        done();
      }, stopTimeoutMs);
    });
  }
}
