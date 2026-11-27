import { existsSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { RuntimeInfo } from '../shared/protocol';
import { createServer, resolveDefaultStaticDir } from './app';
import type { Clock } from './clock';
import { resolvePort } from './config';
import {
  TorController,
  createEphemeralTorDataDir,
  purgeStaleTorDataDirs,
  type TorControllerOptions,
  type TorControllerState,
} from './tor/torController';

const LOOPBACK_HOST = '127.0.0.1';

export interface TorControllerLike {
  on(event: 'status', listener: (state: TorControllerState) => void): unknown;
  off?(event: 'status', listener: (state: TorControllerState) => void): unknown;
  start(): Promise<string>;
  stop(): Promise<void>;
}

export interface StartTorServerOptions {
  port?: number;
  dataDir?: string;
  torBinaryPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  staticDir?: string;
  clock?: Clock;
  waitForReady?: boolean;
  registerSignals?: boolean;
  autoStopOnRoomClose?: boolean;
  log?: (message: string) => void;
  errorLog?: (message: string) => void;
  createTorController?: (options: TorControllerOptions) => TorControllerLike;
}

export interface TorServerHandle {
  app: FastifyInstance;
  port: number;
  localUrl: string;
  dataDir: string;
  torController: TorControllerLike;
  getRuntimeInfo: () => RuntimeInfo;
  ready: Promise<string>;
  stop: () => Promise<void>;
}

/**
 * Starts the Fastify server strictly on 127.0.0.1 coupled to TorController,
 * exposing live Tor runtime status via GET /api/runtime and purging the ephemeral Tor dataDir on stop or failure.
 */
export async function startTorServer(options: StartTorServerOptions = {}): Promise<TorServerHandle> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const dataDir = options.dataDir ?? createEphemeralTorDataDir();
  const requestedPort = options.port ?? resolvePort(env);
  const log = options.log ?? ((msg: string) => console.info(msg));
  const errorLog = options.errorLog ?? ((msg: string) => console.error(msg));

  await purgeStaleTorDataDirs({ excludePaths: [dataDir] });

  let runtimeInfo: RuntimeInfo = {
    runtimeMode: 'tor',
    torStatus: 'bootstrapping',
  };

  const getRuntimeInfo = (): RuntimeInfo => ({ ...runtimeInfo });
  let stopFn: (() => Promise<void>) | undefined;

  const resolvedStaticDir = options.staticDir ?? resolveDefaultStaticDir();
  if (!existsSync(path.resolve(resolvedStaticDir, 'index.html'))) {
    log('Warning: Frontend build not found in dist/. Run `npm run build` so participants can load the web interface.');
  }

  let app: FastifyInstance | undefined;
  try {
    app = await createServer({
      clock: options.clock,
      staticDir: resolvedStaticDir,
      getRuntimeInfo,
      onAllRoomsClosed:
        options.autoStopOnRoomClose === false
          ? undefined
          : () => {
              void stopFn?.();
            },
    });

    await app.listen({ host: LOOPBACK_HOST, port: requestedPort });
  } catch (err) {
    await app?.close().catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  const address = app.server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : requestedPort;
  const localUrl = `http://${LOOPBACK_HOST}:${boundPort}`;

  log(`PULSO Modo Tor host UI available at ${localUrl}`);
  log('Tor status: bootstrapping...');

  const controllerFactory =
    options.createTorController ?? ((controllerOptions) => new TorController(controllerOptions));
  const torController = controllerFactory({
    localPort: boundPort,
    dataDir,
    torBinaryPath: options.torBinaryPath,
    env,
    cwd,
  });

  let readyLogged = false;
  const markTorReady = (onionAddress: string) => {
    runtimeInfo = {
      runtimeMode: 'tor',
      torStatus: 'ready',
      onionAddress,
    };
    if (!readyLogged) {
      readyLogged = true;
      log(`Tor status: ready (${onionAddress})`);
    }
  };

  const onStatus = (state: TorControllerState) => {
    if (state.status === 'ready' && state.onionAddress) {
      markTorReady(state.onionAddress);
      return;
    }
    if (state.status === 'error') {
      runtimeInfo = {
        runtimeMode: 'tor',
        torStatus: 'error',
      };
      return;
    }
    runtimeInfo = {
      runtimeMode: 'tor',
      torStatus: 'bootstrapping',
    };
  };

  torController.on('status', onStatus);

  let stopPromise: Promise<void> | undefined;
  let signalHandler: (() => void) | undefined;

  const detachSignals = () => {
    if (signalHandler) {
      process.off('SIGINT', signalHandler);
      process.off('SIGTERM', signalHandler);
      signalHandler = undefined;
    }
  };

  const stop = async (): Promise<void> => {
    if (stopPromise) {
      return stopPromise;
    }
    stopPromise = (async () => {
      detachSignals();
      torController.off?.('status', onStatus);
      await torController.stop().catch(() => {});
      await rm(dataDir, { recursive: true, force: true }).catch(() => {});
      await app.close().catch(() => {});
      log('PULSO Modo Tor stopped and tor_data purged.');
    })();
    return stopPromise;
  };
  stopFn = stop;

  if (options.registerSignals) {
    signalHandler = () => {
      void stop().finally(() => {
        process.exit(0);
      });
    };
    process.once('SIGINT', signalHandler);
    process.once('SIGTERM', signalHandler);
  }

  const ready = torController
    .start()
    .then((onionAddress) => {
      if (runtimeInfo.torStatus !== 'ready' || !runtimeInfo.onionAddress) {
        markTorReady(onionAddress);
      }
      return onionAddress;
    })
    .catch(async (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      runtimeInfo = {
        runtimeMode: 'tor',
        torStatus: 'error',
      };
      errorLog(`Failed to start PULSO Modo Tor: ${error.message}`);
      await stop();
      throw error;
    });

  if (options.waitForReady !== false) {
    await ready;
  }

  return {
    app,
    port: boundPort,
    localUrl,
    dataDir,
    torController,
    getRuntimeInfo,
    ready,
    stop,
  };
}

function isDirectExecution(): boolean {
  if (process.env.VITEST) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entry);
  } catch {
    return fileURLToPath(import.meta.url) === path.resolve(entry);
  }
}

if (isDirectExecution()) {
  startTorServer({ registerSignals: true }).catch(() => {
    process.exit(1);
  });
}
