import { existsSync, fstatSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { IceServerConfig, RuntimeInfo } from '../shared/protocol';
import { createServer, resolveDefaultStaticDir } from './app';
import type { Clock } from './clock';
import { resolvePort } from './config';
import { buildIceServers } from './iceConfig';
import {
  redactSensitiveNetworkInfo,
  type TorBridgeMode,
  type TorControllerOptions,
  type TorProgressEvent,
  type TorStallEvent,
} from './tor/torController';
import { startTorServer, type TorControllerLike, type TorServerHandle } from './torLauncher';
import { CloudflaredAdapter } from './tunnel/cloudflaredAdapter';
import { applyTunnelStateToRuntimeInfo, type TunnelAdapter } from './tunnel/tunnelAdapter';

const DEFAULT_LOOPBACK_HOST = '127.0.0.1';

export type SidecarMode = 'tor' | 'local';

export interface SidecarTurnConfig {
  stunUrls?: string[];
  turnUrls?: string[];
  turnSecret?: string;
  turnTtlSeconds?: number;
  turnUsername?: string;
  turnCredential?: string;
}

export interface SidecarStdinConfig {
  customBridges?: string | string[];
  turnConfig?: SidecarTurnConfig;
}

export interface SidecarCliOptions {
  help: boolean;
  mode: SidecarMode;
  port: number;
  host: string;
  staticDir?: string;
  bridgeMode: TorBridgeMode;
  torBinaryPath?: string;
  lyrebirdBinaryPath?: string;
  torDataDir?: string;
  tunnel: boolean;
  cloudflaredBinaryPath?: string;
  stdinConfig: boolean;
  watchStdin: boolean;
}

export type SidecarEvent =
  | {
      event: 'listening';
      mode: SidecarMode;
      port: number;
      localUrl: string;
      dataDir?: string;
      tunnelEnabled?: boolean;
    }
  | {
      event: 'tor_progress';
      phase: TorProgressEvent['phase'];
      progress: number;
      bridgeMode: TorBridgeMode;
      tag?: string;
      summary?: string;
      hsDescAction?: string;
    }
  | {
      event: 'tor_stall';
      reason: TorStallEvent['reason'];
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

export interface StartSidecarOptions {
  mode?: SidecarMode;
  port?: number;
  host?: string;
  staticDir?: string;
  bridgeMode?: TorBridgeMode;
  customBridges?: string | readonly string[];
  turnConfig?: SidecarTurnConfig;
  torBinaryPath?: string;
  lyrebirdBinaryPath?: string;
  torDataDir?: string;
  tunnel?: boolean;
  cloudflaredBinaryPath?: string;
  stdinConfig?: boolean;
  watchStdin?: boolean;
  waitForReady?: boolean;
  registerSignals?: boolean;
  autoStopOnRoomClose?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  clock?: Clock;
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  createTorController?: (options: TorControllerOptions) => TorControllerLike;
  createTunnelAdapter?: () => TunnelAdapter;
  onStopComplete?: () => void;
}

export interface SidecarHandle {
  mode: SidecarMode;
  port: number;
  localUrl: string;
  dataDir?: string;
  app: FastifyInstance;
  getRuntimeInfo: () => RuntimeInfo;
  torReady?: Promise<string>;
  tunnelReady?: Promise<string | undefined>;
  stop: () => Promise<void>;
}

const DISALLOWED_SECRET_FLAGS = new Set([
  '--custom-bridges',
  '--bridges',
  '--turn-secret',
  '--turn-credential',
  '--turn-username',
  '--turn-urls',
]);

function splitFlagValue(arg: string): { flag: string; inlineValue?: string } {
  const eqIndex = arg.indexOf('=');
  if (eqIndex === -1) {
    return { flag: arg };
  }
  return { flag: arg.slice(0, eqIndex), inlineValue: arg.slice(eqIndex + 1) };
}

function readNextFlagValue(
  argv: readonly string[],
  index: number,
  flag: string,
  inlineValue?: string,
): { value: string; nextIndex: number } {
  if (inlineValue !== undefined) {
    return { value: inlineValue, nextIndex: index };
  }
  const next = argv[index + 1];
  if (next === undefined) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value: next, nextIndex: index + 1 };
}

/**
 * Parses sidecar CLI arguments while strictly rejecting sensitive secrets on argv
 * (custom bridges and TURN credentials must arrive exclusively via stdin JSON in RAM).
 */
export function parseSidecarArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): SidecarCliOptions {
  const defaultModeRaw = env.PULSO_SIDECAR_MODE?.trim().toLowerCase();
  const defaultMode: SidecarMode = defaultModeRaw === 'tor' ? 'tor' : 'local';
  const defaultPort = env.PORT !== undefined ? resolvePort(env) : 0;

  const opts: SidecarCliOptions = {
    help: false,
    mode: defaultMode,
    port: defaultPort,
    host: env.HOST?.trim() || DEFAULT_LOOPBACK_HOST,
    staticDir: env.PULSO_STATIC_DIR?.trim() || undefined,
    bridgeMode: 'direct',
    tunnel: false,
    stdinConfig: false,
    watchStdin: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const rawArg = argv[i];
    const { flag, inlineValue } = splitFlagValue(rawArg);

    if (DISALLOWED_SECRET_FLAGS.has(flag)) {
      throw new Error(
        `Flag ${flag} is not permitted on the command line for zero-trace security; pass sensitive config via stdin JSON`,
      );
    }

    if (flag === '--help' || flag === '-h') {
      opts.help = true;
    } else if (flag === '--mode') {
      const { value, nextIndex } = readNextFlagValue(argv, i, flag, inlineValue);
      i = nextIndex;
      if (value !== 'tor' && value !== 'local') {
        throw new Error(`Invalid sidecar mode '${value}' (expected 'tor' or 'local')`);
      }
      opts.mode = value;
    } else if (flag === '--port') {
      const { value, nextIndex } = readNextFlagValue(argv, i, flag, inlineValue);
      i = nextIndex;
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error(`Invalid port '${value}'`);
      }
      opts.port = parsed;
    } else if (flag === '--host') {
      const { value, nextIndex } = readNextFlagValue(argv, i, flag, inlineValue);
      i = nextIndex;
      opts.host = value;
    } else if (flag === '--static-dir') {
      const { value, nextIndex } = readNextFlagValue(argv, i, flag, inlineValue);
      i = nextIndex;
      opts.staticDir = value;
    } else if (flag === '--bridge-mode') {
      const { value, nextIndex } = readNextFlagValue(argv, i, flag, inlineValue);
      i = nextIndex;
      if (value !== 'direct' && value !== 'snowflake' && value !== 'custom') {
        throw new Error(`Invalid bridge mode '${value}' (expected 'direct', 'snowflake', or 'custom')`);
      }
      opts.bridgeMode = value;
    } else if (flag === '--tor-bin') {
      const { value, nextIndex } = readNextFlagValue(argv, i, flag, inlineValue);
      i = nextIndex;
      opts.torBinaryPath = value;
    } else if (flag === '--lyrebird-bin') {
      const { value, nextIndex } = readNextFlagValue(argv, i, flag, inlineValue);
      i = nextIndex;
      opts.lyrebirdBinaryPath = value;
    } else if (flag === '--tor-data-dir') {
      const { value, nextIndex } = readNextFlagValue(argv, i, flag, inlineValue);
      i = nextIndex;
      opts.torDataDir = value;
    } else if (flag === '--tunnel') {
      opts.tunnel = true;
    } else if (flag === '--cloudflared-bin') {
      const { value, nextIndex } = readNextFlagValue(argv, i, flag, inlineValue);
      i = nextIndex;
      opts.cloudflaredBinaryPath = value;
    } else if (flag === '--stdin-config') {
      opts.stdinConfig = true;
    } else if (flag === '--watch-stdin') {
      opts.watchStdin = true;
    } else {
      throw new Error(`Unknown sidecar argument: ${rawArg}`);
    }
  }

  if (opts.bridgeMode === 'custom') {
    opts.stdinConfig = true;
  }

  return opts;
}

export function printSidecarHelp(): void {
  console.error(`PULSO Unified Desktop Sidecar

Usage:
  pulso-sidecar --mode <tor|local> [options]

Options:
  --mode <tor|local>             Sidecar mode (default: local)
  --port <number>                HTTP bind port (default: 0 ephemeral, or PORT env)
  --host <ip>                    HTTP bind host (default: 127.0.0.1)
  --static-dir <path>            Path to built frontend dist/ directory
  --bridge-mode <mode>           Tor bridge mode: direct | snowflake | custom (default: direct)
  --tor-bin <path>               Explicit path to tor binary
  --lyrebird-bin <path>          Explicit path to lyrebird binary
  --tor-data-dir <path>          Explicit Tor ephemeral data directory
  --tunnel                       Enable opt-in reverse tunnel (local mode only)
  --cloudflared-bin <path>       Explicit path to cloudflared binary
  --stdin-config                 Read one initial JSON config line from stdin (RAM-only)
  --watch-stdin                  Exit gracefully when stdin reaches EOF
  -h, --help                     Show this help message`);
}

function validateTurnConfig(raw: unknown): SidecarTurnConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid turnConfig in stdin JSON');
  }
  const obj = raw as Record<string, unknown>;
  const config: SidecarTurnConfig = {};

  if (obj.stunUrls !== undefined) {
    if (!Array.isArray(obj.stunUrls) || !obj.stunUrls.every((v) => typeof v === 'string')) {
      throw new Error('Invalid turnConfig.stunUrls in stdin JSON');
    }
    config.stunUrls = obj.stunUrls;
  }
  if (obj.turnUrls !== undefined) {
    if (!Array.isArray(obj.turnUrls) || !obj.turnUrls.every((v) => typeof v === 'string')) {
      throw new Error('Invalid turnConfig.turnUrls in stdin JSON');
    }
    config.turnUrls = obj.turnUrls;
  }
  if (obj.turnSecret !== undefined) {
    if (typeof obj.turnSecret !== 'string') {
      throw new Error('Invalid turnConfig.turnSecret in stdin JSON');
    }
    config.turnSecret = obj.turnSecret;
  }
  if (obj.turnTtlSeconds !== undefined) {
    if (typeof obj.turnTtlSeconds !== 'number' || !Number.isFinite(obj.turnTtlSeconds)) {
      throw new Error('Invalid turnConfig.turnTtlSeconds in stdin JSON');
    }
    config.turnTtlSeconds = obj.turnTtlSeconds;
  }
  if (obj.turnUsername !== undefined) {
    if (typeof obj.turnUsername !== 'string') {
      throw new Error('Invalid turnConfig.turnUsername in stdin JSON');
    }
    config.turnUsername = obj.turnUsername;
  }
  if (obj.turnCredential !== undefined) {
    if (typeof obj.turnCredential !== 'string') {
      throw new Error('Invalid turnConfig.turnCredential in stdin JSON');
    }
    config.turnCredential = obj.turnCredential;
  }

  return config;
}

/**
 * Reads a single initial JSON config line from stdin without closing stdin,
 * leaving the stream open for parent-liveness EOF detection.
 */
export async function readInitialStdinConfig(
  stdin: NodeJS.ReadableStream,
  options: { requireNonEmpty?: boolean } = {},
): Promise<SidecarStdinConfig> {
  const rawLine = await new Promise<string>((resolve, reject) => {
    let buffer = '';
    let settled = false;

    const cleanup = () => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('close', onEnd);
      stdin.off('error', onError);
    };

    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onData = (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        finish(buffer.slice(0, newlineIdx));
      }
    };

    const onEnd = () => {
      finish(buffer);
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    stdin.on('data', onData);
    stdin.once('end', onEnd);
    stdin.once('close', onEnd);
    stdin.once('error', onError);
  });

  const trimmed = rawLine.trim();
  if (!trimmed) {
    if (options.requireNonEmpty) {
      throw new Error('Expected JSON configuration on stdin');
    }
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Invalid JSON configuration on stdin');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stdin configuration must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;
  const config: SidecarStdinConfig = {};

  if (obj.customBridges !== undefined) {
    if (
      typeof obj.customBridges !== 'string' &&
      (!Array.isArray(obj.customBridges) || !obj.customBridges.every((v) => typeof v === 'string'))
    ) {
      throw new Error('Invalid customBridges in stdin JSON');
    }
    config.customBridges = obj.customBridges;
  }

  if (obj.turnConfig !== undefined) {
    config.turnConfig = validateTurnConfig(obj.turnConfig);
  }

  return config;
}

/**
 * Builds an isolated in-memory environment map for `buildIceServers` without mutating `process.env`.
 */
export function buildRamIceEnv(
  turnConfig: SidecarTurnConfig | undefined,
  baseEnv: NodeJS.ProcessEnv,
): Record<string, string | undefined> {
  const ramEnv: Record<string, string | undefined> = { ...baseEnv };
  if (!turnConfig) {
    return ramEnv;
  }
  if (turnConfig.stunUrls !== undefined) {
    ramEnv.STUN_URLS = turnConfig.stunUrls.join(',');
  }
  if (turnConfig.turnUrls !== undefined) {
    ramEnv.TURN_URLS = turnConfig.turnUrls.join(',');
  }
  if (turnConfig.turnSecret !== undefined) {
    ramEnv.TURN_SECRET = turnConfig.turnSecret;
  }
  if (turnConfig.turnTtlSeconds !== undefined) {
    ramEnv.TURN_TTL_SECONDS = String(turnConfig.turnTtlSeconds);
  }
  if (turnConfig.turnUsername !== undefined) {
    ramEnv.TURN_USERNAME = turnConfig.turnUsername;
  }
  if (turnConfig.turnCredential !== undefined) {
    ramEnv.TURN_CREDENTIAL = turnConfig.turnCredential;
  }
  return ramEnv;
}

function shouldWatchStdinEof(
  stdin: NodeJS.ReadableStream & { isTTY?: boolean },
  explicitWatch: boolean,
): boolean {
  if (explicitWatch) return true;
  if (stdin === process.stdin) {
    if (stdin.isTTY) return false;
    try {
      const stat = fstatSync(0);
      return stat.isFIFO() || stat.isSocket();
    } catch {
      return false;
    }
  }
  return true;
}

function emitEvent(stdout: NodeJS.WritableStream, event: SidecarEvent): void {
  stdout.write(`${JSON.stringify(event)}\n`);
}

function errorMessage(err: unknown, redactNetwork: boolean): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactNetwork ? redactSensitiveNetworkInfo(raw) : raw;
}

/**
 * Starts the unified PULSO desktop sidecar in either `tor` or `local` mode,
 * streaming NDJSON status events on stdout and cleaning up all resources on shutdown.
 */
export async function startSidecar(options: StartSidecarOptions = {}): Promise<SidecarHandle> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const mode: SidecarMode = options.mode ?? 'local';
  const host = options.host ?? DEFAULT_LOOPBACK_HOST;
  const requestedPort = options.port ?? (env.PORT !== undefined ? resolvePort(env) : 0);
  const bridgeMode: TorBridgeMode = options.bridgeMode ?? 'direct';
  const stdin: NodeJS.ReadableStream & { isTTY?: boolean } = options.stdin ?? process.stdin;
  const stdout: NodeJS.WritableStream = options.stdout ?? process.stdout;
  const stderr: NodeJS.WritableStream = options.stderr ?? process.stderr;

  const writeStderr = (line: string) => {
    const safeLine = mode === 'tor' ? redactSensitiveNetworkInfo(line) : line;
    stderr.write(`${safeLine}\n`);
  };

  let customBridges = options.customBridges;
  let turnConfig = options.turnConfig;

  const needsStdinConfig =
    Boolean(options.stdinConfig) ||
    (mode === 'tor' && bridgeMode === 'custom' && customBridges === undefined);

  if (needsStdinConfig) {
    const stdinData = await readInitialStdinConfig(stdin, {
      requireNonEmpty: mode === 'tor' && bridgeMode === 'custom' && customBridges === undefined,
    });
    if (customBridges === undefined && stdinData.customBridges !== undefined) {
      customBridges = stdinData.customBridges;
    }
    if (turnConfig === undefined && stdinData.turnConfig !== undefined) {
      turnConfig = stdinData.turnConfig;
    }
  }

  if (mode === 'tor' && bridgeMode === 'custom' && customBridges === undefined) {
    throw new Error('Custom bridges must be provided via stdin JSON when --bridge-mode custom is active');
  }

  const resolvedStaticDir = options.staticDir ?? resolveDefaultStaticDir({ env, cwd });
  if (!existsSync(path.resolve(resolvedStaticDir, 'index.html'))) {
    writeStderr(
      `Warning: Frontend build not found at ${resolvedStaticDir}. Ensure dist/ is bundled or pass --static-dir.`,
    );
  }

  let stopPromise: Promise<void> | undefined;
  let signalHandler: (() => void) | undefined;
  let stdinEofHandler: (() => void) | undefined;

  const watchStdin = shouldWatchStdinEof(
    stdin,
    Boolean(options.watchStdin || options.stdinConfig),
  );

  const attachLifecycleListeners = (onStop: () => Promise<void>) => {
    if (options.registerSignals) {
      signalHandler = () => {
        void onStop().finally(() => {
          options.onStopComplete?.();
        });
      };
      process.once('SIGINT', signalHandler);
      process.once('SIGTERM', signalHandler);
    }

    if (watchStdin) {
      stdinEofHandler = () => {
        void onStop().finally(() => {
          options.onStopComplete?.();
        });
      };
      stdin.once('end', stdinEofHandler);
      stdin.once('close', stdinEofHandler);
    }
  };

  const detachLifecycleListeners = () => {
    if (signalHandler) {
      process.off('SIGINT', signalHandler);
      process.off('SIGTERM', signalHandler);
      signalHandler = undefined;
    }
    if (stdinEofHandler) {
      stdin.off('end', stdinEofHandler);
      stdin.off('close', stdinEofHandler);
      stdinEofHandler = undefined;
    }
  };

  if (mode === 'tor') {
    let torHandle: TorServerHandle;
    try {
      torHandle = await startTorServer({
        port: requestedPort,
        dataDir: options.torDataDir,
        torBinaryPath: options.torBinaryPath,
        lyrebirdBinaryPath: options.lyrebirdBinaryPath,
        bridgeMode,
        customBridges,
        env,
        cwd,
        staticDir: resolvedStaticDir,
        clock: options.clock,
        waitForReady: false,
        registerSignals: false,
        autoStopOnRoomClose: options.autoStopOnRoomClose ?? false,
        log: writeStderr,
        errorLog: writeStderr,
        createTorController: options.createTorController,
        onListening: ({ port, localUrl, dataDir }) => {
          emitEvent(stdout, {
            event: 'listening',
            mode: 'tor',
            port,
            localUrl,
            dataDir,
          });
        },
        onTorProgress: (progressEvent) => {
          emitEvent(stdout, {
            event: 'tor_progress',
            ...progressEvent,
            ...(progressEvent.summary !== undefined
              ? { summary: redactSensitiveNetworkInfo(progressEvent.summary) }
              : {}),
          });
        },
        onTorStall: (stallEvent) => {
          emitEvent(stdout, {
            event: 'tor_stall',
            ...stallEvent,
            ...(stallEvent.summary !== undefined
              ? { summary: redactSensitiveNetworkInfo(stallEvent.summary) }
              : {}),
            ...(stallEvent.bootstrapReason !== undefined
              ? { bootstrapReason: redactSensitiveNetworkInfo(stallEvent.bootstrapReason) }
              : {}),
          });
        },
      });
    } catch (err) {
      emitEvent(stdout, {
        event: 'error',
        message: errorMessage(err, true),
      });
      throw err;
    }

    const torReady = torHandle.ready
      .then((onionAddress) => {
        emitEvent(stdout, {
          event: 'tor_ready',
          onionAddress,
          bridgeMode,
        });
        return onionAddress;
      })
      .catch((err) => {
        emitEvent(stdout, {
          event: 'error',
          message: errorMessage(err, true),
        });
        throw err;
      });

    const stop = async (): Promise<void> => {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        detachLifecycleListeners();
        emitEvent(stdout, { event: 'stopping' });
        await torHandle.stop().catch(() => {});
        await rm(torHandle.dataDir, { recursive: true, force: true }).catch(() => {});
        emitEvent(stdout, { event: 'stopped', purgedDataDir: !existsSync(torHandle.dataDir) });
      })();
      return stopPromise;
    };

    attachLifecycleListeners(stop);

    if (options.waitForReady) {
      await torReady;
    }

    return {
      mode: 'tor',
      port: torHandle.port,
      localUrl: torHandle.localUrl,
      dataDir: torHandle.dataDir,
      app: torHandle.app,
      getRuntimeInfo: torHandle.getRuntimeInfo,
      torReady,
      stop,
    };
  }

  // Local mode (with opt-in reverse tunnel and optional RAM-only TURN credentials)
  let runtimeInfo: RuntimeInfo = {
    runtimeMode: 'normal',
    tunnelActive: false,
  };
  const getRuntimeInfo = (): RuntimeInfo => ({ ...runtimeInfo });

  const ramIceEnv = buildRamIceEnv(turnConfig, env);
  const iceServersProvider = (): IceServerConfig[] => buildIceServers(ramIceEnv);

  const app = await createServer({
    clock: options.clock,
    staticDir: resolvedStaticDir,
    getRuntimeInfo,
    iceServersProvider,
  });

  try {
    await app.listen({ host, port: requestedPort });
  } catch (err) {
    await app.close().catch(() => {});
    emitEvent(stdout, {
      event: 'error',
      message: errorMessage(err, false),
    });
    throw err;
  }

  const address = app.server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : requestedPort;
  const localUrl = `http://${host}:${boundPort}`;
  const tunnelEnabled = Boolean(options.tunnel);

  emitEvent(stdout, {
    event: 'listening',
    mode: 'local',
    port: boundPort,
    localUrl,
    tunnelEnabled,
  });

  let tunnelAdapter: TunnelAdapter | undefined;
  let tunnelReady: Promise<string | undefined> | undefined;

  const onTunnelStatus = (state: ReturnType<TunnelAdapter['getState']>) => {
    runtimeInfo = applyTunnelStateToRuntimeInfo(runtimeInfo, state);
  };

  if (tunnelEnabled) {
    tunnelAdapter =
      options.createTunnelAdapter?.() ??
      new CloudflaredAdapter({
        binaryPath: options.cloudflaredBinaryPath,
        env,
        cwd,
      });

    tunnelAdapter.on('status', onTunnelStatus);
    emitEvent(stdout, {
      event: 'tunnel_starting',
      provider: tunnelAdapter.provider,
    });

    tunnelReady = tunnelAdapter
      .start({ localPort: boundPort, localHost: host })
      .then((publicOrigin) => {
        emitEvent(stdout, {
          event: 'tunnel_ready',
          provider: tunnelAdapter!.provider,
          publicOrigin,
        });
        return publicOrigin;
      })
      .catch((err) => {
        const message = errorMessage(err, false);
        emitEvent(stdout, {
          event: 'tunnel_error',
          provider: tunnelAdapter!.provider,
          message,
        });
        return undefined;
      });
  }

  const stop = async (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      detachLifecycleListeners();
      emitEvent(stdout, { event: 'stopping' });
      if (tunnelAdapter) {
        tunnelAdapter.off('status', onTunnelStatus);
        await tunnelAdapter.stop().catch(() => {});
      }
      await app.close().catch(() => {});
      emitEvent(stdout, { event: 'stopped', purgedDataDir: false });
    })();
    return stopPromise;
  };

  attachLifecycleListeners(stop);

  if (options.waitForReady && tunnelReady) {
    await tunnelReady;
  }

  return {
    mode: 'local',
    port: boundPort,
    localUrl,
    app,
    getRuntimeInfo,
    tunnelReady,
    stop,
  };
}

function isDirectExecution(): boolean {
  if (process.env.VITEST) return false;

  // CommonJS / Node.js SEA execution
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    return true;
  }

  const moduleUrl = typeof import.meta !== 'undefined' ? import.meta.url : undefined;
  if (!moduleUrl) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(moduleUrl) === realpathSync(entry);
  } catch {
    return fileURLToPath(moduleUrl) === path.resolve(entry);
  }
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const opts = parseSidecarArgs(argv);
  if (opts.help) {
    printSidecarHelp();
    return;
  }

  const handle = await startSidecar({
    mode: opts.mode,
    port: opts.port,
    host: opts.host,
    staticDir: opts.staticDir,
    bridgeMode: opts.bridgeMode,
    torBinaryPath: opts.torBinaryPath,
    lyrebirdBinaryPath: opts.lyrebirdBinaryPath,
    torDataDir: opts.torDataDir,
    tunnel: opts.tunnel,
    cloudflaredBinaryPath: opts.cloudflaredBinaryPath,
    stdinConfig: opts.stdinConfig,
    watchStdin: opts.watchStdin,
    registerSignals: true,
    onStopComplete: () => {
      process.exit(0);
    },
  });

  if (handle.torReady) {
    handle.torReady.catch(() => {
      void handle.stop().finally(() => {
        process.exit(1);
      });
    });
  }
}

if (isDirectExecution()) {
  runCli().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    emitEvent(process.stdout, { event: 'error', message });
    process.exit(1);
  });
}
