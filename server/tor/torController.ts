import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { ensureDarwinBinarySigned, isExecutableFile } from '../binaryUtils';
import {
  ControlPortClient,
  parseControlPortFile,
  type ControlAsyncEvent,
  type ControlEndpoint,
} from './controlProtocol';

export const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
export const DEFAULT_BRIDGE_STARTUP_TIMEOUT_MS = 180_000;
export const DEFAULT_BOOTSTRAP_STALL_TIMEOUT_MS = 25_000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;
const CONTROL_COMMAND_SHUTDOWN_TIMEOUT_MS = 1_500;
const MAX_STDERR_CHARS = 2048;
export const TOR_DATA_DIR_PREFIX = 'pulso-tor-';
export const DEFAULT_STALE_TOR_DIR_MIN_AGE_MS = 15 * 60 * 1000;

export type TorStatus = 'bootstrapping' | 'ready' | 'error';
export type TorBridgeMode = 'direct' | 'snowflake' | 'custom';
export type TorPluggableTransport = 'obfs4' | 'snowflake' | 'webtunnel' | 'meek_lite';
export type TorBootstrapPhase =
  | 'starting'
  | 'conn_pt'
  | 'conn_done_pt'
  | 'handshake_pt'
  | 'bootstrap'
  | 'hs_desc'
  | 'ready'
  | 'error';

export const SUPPORTED_BRIDGE_TRANSPORTS: readonly TorPluggableTransport[] = [
  'obfs4',
  'snowflake',
  'webtunnel',
  'meek_lite',
];
const SUPPORTED_BRIDGE_TRANSPORT_SET = new Set<string>(SUPPORTED_BRIDGE_TRANSPORTS);
const BRIDGE_CLIENT_TRANSPORT_PLUGINS = 'meek_lite,obfs4,snowflake,webtunnel';

export const BUILTIN_SNOWFLAKE_BRIDGES: readonly string[] = [
  'snowflake 192.0.2.3:80 2B280B23E1107BB62ABFC40DDCC8824814F80A72 fingerprint=2B280B23E1107BB62ABFC40DDCC8824814F80A72 url=https://1098762253.rsc.cdn77.org/ fronts=www.cdn77.com,www.phpmyadmin.net ice=stun:stun.antisip.com:3478,stun:stun.epygi.com:3478,stun:stun.uls.co.za:3478,stun:stun.voipgate.com:3478,stun:stun.mixvoip.com:3478,stun:stun.nextcloud.com:3478,stun:stun.bethesda.net:3478,stun:stun.nextcloud.com:443 utls-imitate=hellorandomizedalpn',
  'snowflake 192.0.2.4:80 8838024498816A039FCBBAB14E6F40A0843051FA fingerprint=8838024498816A039FCBBAB14E6F40A0843051FA url=https://1098762253.rsc.cdn77.org/ fronts=www.cdn77.com,www.phpmyadmin.net ice=stun:stun.antisip.com:3478,stun:stun.epygi.com:3478,stun:stun.uls.co.za:3478,stun:stun.voipgate.com:3478,stun:stun.mixvoip.com:3478,stun:stun.nextcloud.com:3478,stun:stun.bethesda.net:3478,stun:stun.nextcloud.com:443 utls-imitate=hellorandomizedalpn',
];

export interface TorProgressEvent {
  phase: TorBootstrapPhase;
  progress: number;
  bridgeMode: TorBridgeMode;
  tag?: string;
  summary?: string;
  hsDescAction?: string;
}

export interface TorStallEvent {
  reason: 'bootstrap_stalled' | 'warn_bootstrap';
  bridgeMode: TorBridgeMode;
  progress: number;
  tag?: string;
  summary?: string;
  bootstrapReason?: string;
}

export interface TorControllerState {
  status: TorStatus;
  onionAddress?: string;
  serviceId?: string;
  bootstrapProgress: number;
  bridgeMode?: TorBridgeMode;
  phase?: TorBootstrapPhase;
  bootstrapTag?: string;
  bootstrapSummary?: string;
  stalled?: boolean;
  stallReason?: 'bootstrap_stalled' | 'warn_bootstrap';
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
  lyrebirdBinaryPath?: string;
  bridgeMode?: TorBridgeMode;
  customBridges?: string | readonly string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
  startupTimeoutMs?: number;
  stallTimeoutMs?: number;
  controlFilePollIntervalMs?: number;
  stopTimeoutMs?: number;
  spawnFn?: typeof spawn;
  connectFn?: (endpoint: ControlEndpoint) => Duplex;
  randomBytesFn?: (size: number) => Buffer;
  execFileSyncFn?: typeof execFileSync;
}

export { ensureDarwinBinarySigned };

function missingTorBinaryError(reason: string): Error {
  return new Error(
    `${reason}. Set PULSO_TOR_BIN to your tor executable path, or run \`node scripts/fetch-tor-bundle.mjs\` (see docs/tor-mode.md).`,
  );
}

/**
 * Redacts non-loopback IPv4 and bracketed IPv6 addresses so bridge IPs never leak in diagnostics.
 */
export function redactSensitiveNetworkInfo(text: string): string {
  return text
    .replace(/\b(?!(?:127\.0\.0\.1|0\.0\.0\.0)\b)(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '[REDACTED_IP]')
    .replace(/\[(?!::1\b)[0-9a-fA-F:]+\](?::\d{1,5})?/g, '[REDACTED_IP]');
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
 * Resolves the unified `lyrebird` Pluggable Transport binary directly relative to the `tor`
 * executable (`pluggable_transports/lyrebird` or `lyrebird.exe` on Windows), without relying
 * on `pt_config.json` and ignoring experimental `conjure-client`.
 */
export function resolveLyrebirdBinary(
  torBinaryPath: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const envBin = env.PULSO_LYREBIRD_BIN?.trim();
  if (envBin) {
    const resolvedEnvBin = path.resolve(envBin);
    if (!isExecutableFile(resolvedEnvBin, platform)) {
      throw new Error(
        `PULSO_LYREBIRD_BIN points to a missing or non-executable binary: ${resolvedEnvBin}`,
      );
    }
    return resolvedEnvBin;
  }

  const binaryName = platform === 'win32' ? 'lyrebird.exe' : 'lyrebird';
  const candidate = path.join(path.dirname(torBinaryPath), 'pluggable_transports', binaryName);
  if (isExecutableFile(candidate, platform)) {
    return candidate;
  }

  throw new Error(
    `Lyrebird pluggable transport binary not found or non-executable at ${candidate}. Run \`node scripts/fetch-tor-bundle.mjs\` or set PULSO_LYREBIRD_BIN.`,
  );
}

function isValidBridgeEndpoint(token: string): boolean {
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(token);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map((part) => Number.parseInt(part, 10));
    const port = Number.parseInt(ipv4Match[5], 10);
    return octets.every((octet) => octet >= 0 && octet <= 255) && port >= 1 && port <= 65535;
  }

  const ipv6Match = /^\[([0-9a-fA-F:]+)\]:(\d{1,5})$/.exec(token);
  if (ipv6Match) {
    const host = ipv6Match[1];
    const port = Number.parseInt(ipv6Match[2], 10);
    return host.includes(':') && port >= 1 && port <= 65535;
  }

  return false;
}

const FINGERPRINT_HEX_REGEX = /^[0-9a-fA-F]{40}$/;
const BRIDGE_KV_PARAM_REGEX = /^[A-Za-z0-9_.-]+=[^\s\\;#"']+$/;
const FORBIDDEN_CONTROL_CHARS_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const FORBIDDEN_TORRC_SYNTAX_REGEX = /[\r\n\x00-\x1f\x7f\\;#"']/;

/**
 * Strictly validates and normalizes user-supplied custom bridge lines to prevent torrc
 * directive injection while never echoing bridge IPs in error messages.
 */
export function sanitizeCustomBridgeLines(input: string | readonly string[]): string[] {
  let rawLines: string[];

  if (Array.isArray(input)) {
    rawLines = input.map((entry, idx) => {
      if (typeof entry !== 'string') {
        throw new Error(`Invalid bridge entry on line ${idx + 1}`);
      }
      if (/[\r\n]/.test(entry) || FORBIDDEN_CONTROL_CHARS_REGEX.test(entry)) {
        throw new Error(
          `Invalid bridge line ${idx + 1}: embedded newlines and control characters are not permitted`,
        );
      }
      return entry;
    });
  } else if (typeof input === 'string') {
    if (FORBIDDEN_CONTROL_CHARS_REGEX.test(input) || /\r(?!\n)/.test(input)) {
      throw new Error('Invalid bridge input: control characters are not permitted');
    }
    rawLines = input.split(/\r?\n/);
  } else {
    throw new Error('Invalid custom bridges input');
  }

  const sanitized: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = i + 1;
    const trimmed = rawLines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const withoutPrefix = trimmed.replace(/^Bridge\s+/i, '').trim();
    const collapsed = withoutPrefix.replace(/\t+/g, ' ');
    if (!collapsed || FORBIDDEN_TORRC_SYNTAX_REGEX.test(collapsed)) {
      throw new Error(`Invalid bridge syntax on line ${lineNum}`);
    }

    const tokens = collapsed.split(/\s+/);
    const transport = tokens[0] ?? '';
    if (!SUPPORTED_BRIDGE_TRANSPORT_SET.has(transport)) {
      throw new Error(
        `Unsupported bridge transport '${transport}' on line ${lineNum} (allowed: ${SUPPORTED_BRIDGE_TRANSPORTS.join(', ')})`,
      );
    }

    if (tokens.length < 3) {
      throw new Error(`Incomplete bridge line on line ${lineNum}`);
    }

    if (!isValidBridgeEndpoint(tokens[1])) {
      throw new Error(`Invalid bridge endpoint on line ${lineNum}`);
    }

    for (let j = 2; j < tokens.length; j++) {
      const param = tokens[j];
      if (!FINGERPRINT_HEX_REGEX.test(param) && !BRIDGE_KV_PARAM_REGEX.test(param)) {
        throw new Error(`Invalid bridge parameter on line ${lineNum}`);
      }
    }

    sanitized.push(tokens.join(' '));
  }

  if (sanitized.length === 0) {
    throw new Error('At least one valid bridge line is required for custom bridge mode');
  }

  return sanitized;
}

function formatTorrcPath(filePath: string): string {
  if (!/[\s"\\]/.test(filePath)) {
    return filePath;
  }
  const escaped = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Generates an isolated torrc configuration with SocksPort disabled, cookie-authenticated
 * ControlPort, and optional pre-spawn Pluggable Transport (`lyrebird`) bridge directives.
 */
export function buildTorrcContent(options: {
  dataDir: string;
  controlPortFile: string;
  cookieFile: string;
  lyrebirdBinaryPath?: string;
  bridgeLines?: readonly string[];
}): string {
  const lines = [
    `DataDirectory ${formatTorrcPath(options.dataDir)}`,
    'SocksPort 0',
    'ControlPort auto',
    `ControlPortWriteToFile ${formatTorrcPath(options.controlPortFile)}`,
    'CookieAuthentication 1',
    `CookieAuthFile ${formatTorrcPath(options.cookieFile)}`,
    'AvoidDiskWrites 1',
  ];

  if (options.bridgeLines && options.bridgeLines.length > 0) {
    if (!options.lyrebirdBinaryPath) {
      throw new Error('lyrebirdBinaryPath is required when bridges are configured');
    }
    lines.push('UseBridges 1');
    lines.push(
      `ClientTransportPlugin ${BRIDGE_CLIENT_TRANSPORT_PLUGINS} exec ${formatTorrcPath(options.lyrebirdBinaryPath)}`,
    );
    for (const bridgeLine of options.bridgeLines) {
      lines.push(`Bridge ${bridgeLine}`);
    }
  }

  lines.push('');
  return lines.join('\n');
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

export interface PurgeStaleTorDataDirsOptions {
  baseDir?: string;
  excludePaths?: Iterable<string>;
  minAgeMs?: number;
  nowMs?: number;
}

/**
 * Creates a unique ephemeral Tor data directory under `os.tmpdir()` with `0o700` permissions.
 */
export function createEphemeralTorDataDir(baseTmpDir: string = os.tmpdir()): string {
  const dir = mkdtempSync(path.join(baseTmpDir, TOR_DATA_DIR_PREFIX));
  try {
    chmodSync(dir, 0o700);
  } catch {
    // POSIX permissions may be ignored or unsupported on some filesystems (e.g. Windows).
  }
  return dir;
}

/**
 * Safely deletes stale `pulso-tor-*` directories left behind by crashed processes,
 * respecting `excludePaths` and `minAgeMs` so active/parallel instances are untouched.
 */
export async function purgeStaleTorDataDirs(
  options: PurgeStaleTorDataDirsOptions = {},
): Promise<string[]> {
  const baseDir = path.resolve(options.baseDir ?? os.tmpdir());
  const minAgeMs =
    typeof options.minAgeMs === 'number' && Number.isFinite(options.minAgeMs) && options.minAgeMs >= 0
      ? options.minAgeMs
      : DEFAULT_STALE_TOR_DIR_MIN_AGE_MS;
  const nowMs = options.nowMs ?? Date.now();
  const excluded = new Set(Array.from(options.excludePaths ?? [], (p) => path.resolve(p)));

  let entries;
  try {
    entries = await readdir(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(TOR_DATA_DIR_PREFIX) || !entry.isDirectory()) {
      continue;
    }
    const candidate = path.resolve(baseDir, entry.name);
    if (excluded.has(candidate)) {
      continue;
    }
    try {
      const info = await lstat(candidate);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        continue;
      }
      if (nowMs - info.mtimeMs < minAgeMs) {
        continue;
      }
      await rm(candidate, { recursive: true, force: true });
      removed.push(candidate);
    } catch {
      // Best-effort cleanup; ignore entries removed concurrently or locked by OS.
    }
  }
  return removed;
}

function mapBootstrapTagToPhase(tag?: string): TorBootstrapPhase {
  if (tag === 'conn_pt') return 'conn_pt';
  if (tag === 'conn_done_pt') return 'conn_done_pt';
  if (tag === 'handshake_pt') return 'handshake_pt';
  return 'bootstrap';
}

/**
 * Manages the ephemeral lifecycle of a local Tor daemon, optional Pluggable Transports (`lyrebird`),
 * and a RAM-only v3 Onion Service.
 */
export class TorController extends EventEmitter {
  private readonly options: TorControllerOptions;
  private readonly dataDirPath: string;
  private readonly configuredBridgeMode: TorBridgeMode;
  private currentStatus: TorStatus = 'bootstrapping';
  private currentPhase: TorBootstrapPhase = 'starting';
  private currentServiceId?: string;
  private currentOnionAddress?: string;
  private bootstrapProgress = 0;
  private bootstrapTag?: string;
  private bootstrapSummary?: string;
  private stalled = false;
  private stallReason?: 'bootstrap_stalled' | 'warn_bootstrap';
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
    this.configuredBridgeMode = options.bridgeMode ?? 'direct';
    this.dataDirPath = options.dataDir ?? createEphemeralTorDataDir();
  }

  get status(): TorStatus {
    return this.currentStatus;
  }

  get bridgeMode(): TorBridgeMode {
    return this.configuredBridgeMode;
  }

  get startupTimeoutMs(): number {
    return (
      this.options.startupTimeoutMs ??
      (this.configuredBridgeMode !== 'direct'
        ? DEFAULT_BRIDGE_STARTUP_TIMEOUT_MS
        : DEFAULT_STARTUP_TIMEOUT_MS)
    );
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
      bridgeMode: this.configuredBridgeMode,
      phase: this.currentPhase,
      bootstrapTag: this.bootstrapTag,
      bootstrapSummary: this.bootstrapSummary,
      stalled: this.stalled,
      stallReason: this.stallReason,
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

  private resolveActiveBridgeLines(): readonly string[] | undefined {
    if (this.configuredBridgeMode === 'direct') {
      return undefined;
    }
    if (this.configuredBridgeMode === 'snowflake') {
      return BUILTIN_SNOWFLAKE_BRIDGES;
    }
    return sanitizeCustomBridgeLines(this.options.customBridges ?? '');
  }

  private async runStart(): Promise<string> {
    const startupTimeoutMs = this.startupTimeoutMs;
    const deadline = Date.now() + startupTimeoutMs;

    try {
      this.currentStatus = 'bootstrapping';
      this.currentPhase = 'starting';
      this.bootstrapProgress = 0;
      this.bootstrapTag = undefined;
      this.bootstrapSummary = undefined;
      this.stalled = false;
      this.stallReason = undefined;
      this.currentError = undefined;
      this.emitStatus();

      const bridgeLines = this.resolveActiveBridgeLines();

      await purgeStaleTorDataDirs({ excludePaths: [this.dataDirPath] });

      const platform = this.options.platform ?? process.platform;
      const execFileImpl = this.options.execFileSyncFn ?? execFileSync;
      const torBinary =
        this.options.torBinaryPath ??
        resolveTorBinary({
          env: this.options.env,
          cwd: this.options.cwd,
          platform,
        });

      let lyrebirdBinaryPath: string | undefined;
      if (bridgeLines && bridgeLines.length > 0) {
        lyrebirdBinaryPath =
          this.options.lyrebirdBinaryPath ??
          resolveLyrebirdBinary(torBinary, platform, this.options.env);
      }

      await rm(this.dataDirPath, { recursive: true, force: true });
      await mkdir(this.dataDirPath, { recursive: true, mode: 0o700 });

      const torrcPath = path.join(this.dataDirPath, 'torrc');
      const controlPortFile = path.join(this.dataDirPath, 'control.port');
      const cookieFile = path.join(this.dataDirPath, 'control_auth_cookie');

      await writeFile(
        torrcPath,
        buildTorrcContent({
          dataDir: this.dataDirPath,
          controlPortFile,
          cookieFile,
          lyrebirdBinaryPath,
          bridgeLines,
        }),
        { encoding: 'utf8', mode: 0o600 },
      );

      ensureDarwinBinarySigned(torBinary, platform, execFileImpl);
      if (lyrebirdBinaryPath) {
        ensureDarwinBinarySigned(lyrebirdBinaryPath, platform, execFileImpl);
      }

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
      this.currentPhase = 'ready';
      this.stalled = false;
      this.stallReason = undefined;
      this.emitStatus();
      this.emit('ready', onionAddress);
      return onionAddress;
    } catch (err) {
      const rawError = err instanceof Error ? err : new Error(String(err));
      const sanitizedMessage = redactSensitiveNetworkInfo(rawError.message);
      const error =
        sanitizedMessage === rawError.message ? rawError : new Error(sanitizedMessage);
      this.currentStatus = 'error';
      this.currentPhase = 'error';
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
      this.childExitError = new Error(
        `Failed to spawn Tor process: ${redactSensitiveNetworkInfo(err.message)}`,
      );
    });

    child.once('exit', (code, signal) => {
      if (!this.stopping && this.currentStatus !== 'ready') {
        const detailParts: string[] = [];
        if (this.stderrTail.trim()) {
          detailParts.push(redactSensitiveNetworkInfo(this.stderrTail.trim()));
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
    const stallTimeoutMs = this.options.stallTimeoutMs ?? DEFAULT_BOOTSTRAP_STALL_TIMEOUT_MS;
    let lastLowProgressAt = Date.now();
    let bootstrapStallEmitted = false;

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
      if (event.type === 'status_client' && event.action === 'BOOTSTRAP') {
        const phase = mapBootstrapTagToPhase(event.tag);
        const sanitizedSummary = event.summary
          ? redactSensitiveNetworkInfo(event.summary)
          : undefined;
        const sanitizedReason = event.reason
          ? redactSensitiveNetworkInfo(event.reason)
          : undefined;

        this.currentPhase = phase;
        this.bootstrapTag = event.tag;
        this.bootstrapSummary = sanitizedSummary;

        if (event.progress !== undefined) {
          if (event.progress > this.bootstrapProgress && event.progress < 25) {
            lastLowProgressAt = Date.now();
          }
          this.bootstrapProgress = event.progress;
          if (event.progress >= 25) {
            this.stalled = false;
            this.stallReason = undefined;
          }
        }

        const progressEvent: TorProgressEvent = {
          phase,
          progress: this.bootstrapProgress,
          bridgeMode: this.configuredBridgeMode,
          ...(event.tag !== undefined ? { tag: event.tag } : {}),
          ...(sanitizedSummary !== undefined ? { summary: sanitizedSummary } : {}),
        };
        this.emit('progress', progressEvent);
        this.emitStatus();

        if (event.severity === 'WARN') {
          this.stalled = true;
          this.stallReason = 'warn_bootstrap';
          this.emitStatus();
          const stallEvent: TorStallEvent = {
            reason: 'warn_bootstrap',
            bridgeMode: this.configuredBridgeMode,
            progress: this.bootstrapProgress,
            ...(event.tag !== undefined ? { tag: event.tag } : {}),
            ...(sanitizedSummary !== undefined ? { summary: sanitizedSummary } : {}),
            ...(sanitizedReason !== undefined ? { bootstrapReason: sanitizedReason } : {}),
          };
          this.emit('stall', stallEvent);
        }

        if (event.progress !== undefined && event.progress >= 100) {
          bootstrapped = true;
          checkReady();
        }
      } else if (event.type === 'hs_desc') {
        if (!event.serviceId || !expectedServiceId || event.serviceId === expectedServiceId) {
          this.currentPhase = 'hs_desc';
          const progressEvent: TorProgressEvent = {
            phase: 'hs_desc',
            progress: this.bootstrapProgress,
            bridgeMode: this.configuredBridgeMode,
            hsDescAction: event.action,
          };
          this.emit('progress', progressEvent);
          this.emitStatus();
          if (event.action === 'UPLOADED') {
            descriptorUploaded = true;
            checkReady();
          }
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
      } else if (
        !bootstrapped &&
        !bootstrapStallEmitted &&
        this.bootstrapProgress < 25 &&
        Date.now() - lastLowProgressAt >= stallTimeoutMs
      ) {
        bootstrapStallEmitted = true;
        this.stalled = true;
        this.stallReason = 'bootstrap_stalled';
        this.emitStatus();
        const stallEvent: TorStallEvent = {
          reason: 'bootstrap_stalled',
          bridgeMode: this.configuredBridgeMode,
          progress: this.bootstrapProgress,
          ...(this.bootstrapTag !== undefined ? { tag: this.bootstrapTag } : {}),
          ...(this.bootstrapSummary !== undefined ? { summary: this.bootstrapSummary } : {}),
        };
        this.emit('stall', stallEvent);
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
