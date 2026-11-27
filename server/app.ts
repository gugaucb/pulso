import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import {
  sanitizeRuntimeInfo,
  WS_PROTOCOL_VERSION,
  type ClientWsMessage,
  type IceServerConfig,
  type RuntimeInfo,
} from '../shared/protocol';
import { systemClock, type Clock } from './clock';
import { buildIceServers, hasTurnConfigured } from './iceConfig';
import { RoomStore, type ClientSession } from './roomStore';
import {
  MAX_WS_PAYLOAD_BYTES,
  SecurityManager,
  type SecurityOptions,
} from './security';

const OPEN_READY_STATE = 1;
const WS_HARD_MAX_PAYLOAD_MULTIPLIER = 4;
export const DEFAULT_WS_HEARTBEAT_INTERVAL_MS = 35_000;

export type TrustProxyOption = boolean | string | string[] | number;

export interface CreateServerOptions {
  clock?: Clock;
  staticDir?: string;
  trustProxy?: TrustProxyOption;
  wsHeartbeatIntervalMs?: number;
  runtimeInfo?: RuntimeInfo;
  getRuntimeInfo?: () => RuntimeInfo;
  inactivityDurationMs?: number;
  hardTtlMs?: number;
  graceWindowMs?: number;
  maxRooms?: number;
  maxWsPayloadBytes?: number;
  security?: SecurityManager;
  securityOptions?: SecurityOptions;
  iceServersProvider?: () => IceServerConfig[];
  onAllRoomsClosed?: () => void;
}

/**
 * Resolves Fastify `trustProxy` setting from `TRUST_PROXY` (`true` or `1`).
 */
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TRUST_PROXY?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

export function resolveDefaultStaticDir(): string {
  const envStaticDir = process.env.PULSO_STATIC_DIR?.trim();
  if (envStaticDir) {
    return resolve(envStaticDir);
  }

  const currentDir = dirname(fileURLToPath(import.meta.url));

  // If running from compiled server inside dist/server/
  const parentDir = resolve(currentDir, '..');
  if (existsSync(resolve(parentDir, 'index.html')) && existsSync(resolve(parentDir, 'assets'))) {
    return parentDir;
  }

  // If running from source (e.g. tsx server/...) or project root
  const cwdDist = resolve(process.cwd(), 'dist');
  if (existsSync(resolve(cwdDist, 'index.html'))) {
    return cwdDist;
  }

  const siblingDist = resolve(currentDir, '..', 'dist');
  if (existsSync(resolve(siblingDist, 'index.html'))) {
    return siblingDist;
  }

  return cwdDist;
}

function isServerInternalPath(pathname: string): boolean {
  return pathname === '/server' || pathname.startsWith('/server/');
}

function isApiOrControlPath(pathname: string): boolean {
  return (
    pathname === '/ws' ||
    pathname.startsWith('/ws/') ||
    pathname === '/healthz' ||
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    isServerInternalPath(pathname)
  );
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

/**
 * Resolves the client origin IP for anonymized rate-limit hashing.
 * Only trusts `cf-connecting-ip` (with `x-forwarded-for` first-hop fallback) when
 * a local reverse tunnel is active and the raw socket peer is loopback.
 */
export function resolveOriginIp(
  request: {
    ip?: string;
    headers?: Record<string, string | string[] | undefined>;
    raw?: { socket?: { remoteAddress?: string } };
  },
  runtimeInfo?: RuntimeInfo,
): string {
  const socketRemoteAddress = request.raw?.socket?.remoteAddress;
  if (runtimeInfo?.tunnelActive === true && isLoopbackAddress(socketRemoteAddress)) {
    const cfConnectingIp = firstHeaderValue(request.headers?.['cf-connecting-ip'])?.trim();
    if (cfConnectingIp) {
      return cfConnectingIp;
    }
    const forwardedFor = firstHeaderValue(request.headers?.['x-forwarded-for']);
    if (forwardedFor) {
      const firstHop = forwardedFor.split(',')[0]?.trim();
      if (firstHop) {
        return firstHop;
      }
    }
  }
  return request.ip || socketRemoteAddress || 'unknown';
}

function getRawMessageByteLength(rawData: Buffer | ArrayBuffer | Buffer[] | string): number {
  if (typeof rawData === 'string') {
    return Buffer.byteLength(rawData, 'utf8');
  }
  if (Buffer.isBuffer(rawData)) {
    return rawData.byteLength;
  }
  if (Array.isArray(rawData)) {
    let total = 0;
    for (const chunk of rawData) {
      total += chunk.byteLength;
    }
    return total;
  }
  if (rawData instanceof ArrayBuffer) {
    return rawData.byteLength;
  }
  return Buffer.byteLength(String(rawData), 'utf8');
}

function sendPayloadTooLargeAndClose(socket: {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}): void {
  if (socket.readyState === OPEN_READY_STATE) {
    socket.send(
      JSON.stringify({
        type: 'room_error',
        version: WS_PROTOCOL_VERSION,
        code: 'payload_too_large',
      }),
    );
    socket.close(1009, 'Payload too large');
  }
}

/**
 * Creates a zero-trace Fastify instance serving HTTP static assets,
 * health/runtime endpoints, and the same-origin /ws WebSocket coordinator.
 */
export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  const clock = options.clock ?? systemClock;
  const security = options.security ?? new SecurityManager(clock, options.securityOptions);
  const maxWsPayloadBytes =
    typeof options.maxWsPayloadBytes === 'number' &&
    Number.isFinite(options.maxWsPayloadBytes) &&
    options.maxWsPayloadBytes > 0
      ? Math.floor(options.maxWsPayloadBytes)
      : MAX_WS_PAYLOAD_BYTES;

  const staticRuntimeInfo: RuntimeInfo = options.runtimeInfo ?? { runtimeMode: 'normal' };
  const resolveRuntimeInfo = options.getRuntimeInfo ?? (() => staticRuntimeInfo);
  const iceServersProvider = options.iceServersProvider ?? (() => buildIceServers(process.env));
  const roomStore = new RoomStore(clock, {
    inactivityDurationMs: options.inactivityDurationMs,
    hardTtlMs: options.hardTtlMs,
    graceWindowMs: options.graceWindowMs,
    maxRooms: options.maxRooms,
    security,
    getRuntimeInfo: resolveRuntimeInfo,
    iceServersProvider,
    onAllRoomsClosed: options.onAllRoomsClosed,
  });
  const staticDir = options.staticDir ?? resolveDefaultStaticDir();
  const originHashByRawRequest = new WeakMap<object, string>();
  const trustProxy = options.trustProxy ?? resolveTrustProxy();
  const wsHeartbeatIntervalMs =
    typeof options.wsHeartbeatIntervalMs === 'number' &&
    Number.isFinite(options.wsHeartbeatIntervalMs) &&
    options.wsHeartbeatIntervalMs > 0
      ? Math.floor(options.wsHeartbeatIntervalMs)
      : DEFAULT_WS_HEARTBEAT_INTERVAL_MS;
  const activeHeartbeats = new Set<ReturnType<typeof setInterval>>();

  const app = Fastify({
    logger: false,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: typeof trustProxy === 'number' ? false : trustProxy,
  });

  app.addHook('onClose', async () => {
    for (const timer of activeHeartbeats) {
      clearInterval(timer);
    }
    activeHeartbeats.clear();
  });

  app.setErrorHandler((_error, _request, reply) => {
    return reply.code(500).send({ error: 'Internal Server Error' });
  });

  await app.register(fastifyWebsocket, {
    errorHandler: (error, socket) => {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
        sendPayloadTooLargeAndClose(socket);
        return;
      }
      socket.terminate();
    },
    options: {
      // Allow a bounded headroom above maxWsPayloadBytes so oversized frames reach
      // the message handler to emit `payload_too_large` before closing with 1009,
      // while still aborting multi-megabyte frames in the ws receiver.
      maxPayload: maxWsPayloadBytes * WS_HARD_MAX_PAYLOAD_MULTIPLIER,
    },
  });

  app.get('/healthz', async () => {
    return { ok: true };
  });

  app.get('/api/runtime', async () => {
    const runtime = sanitizeRuntimeInfo(resolveRuntimeInfo());
    if (runtime.runtimeMode === 'normal' && runtime.turnConfigured === undefined) {
      runtime.turnConfigured = hasTurnConfigured(iceServersProvider());
    }
    return runtime;
  });

  app.get(
    '/ws',
    {
      websocket: true,
      preHandler: async (request, reply) => {
        const originHash = security.hashOrigin(resolveOriginIp(request, resolveRuntimeInfo()));
        if (!security.allowWsConnect(originHash)) {
          return reply.code(429).send({ error: 'Too Many Requests' });
        }
        originHashByRawRequest.set(request.raw, originHash);
      },
    },
    (socket, request) => {
      const originHash =
        originHashByRawRequest.get(request.raw) ??
        security.hashOrigin(resolveOriginIp(request, resolveRuntimeInfo()));
      originHashByRawRequest.delete(request.raw);

      const session: ClientSession = {
        originHash,
        send(message) {
          if (socket.readyState === OPEN_READY_STATE) {
            socket.send(JSON.stringify(message));
          }
        },
        close() {
          socket.close();
        },
      };

      socket.on('message', (rawData) => {
        if (getRawMessageByteLength(rawData) > maxWsPayloadBytes) {
          sendPayloadTooLargeAndClose(socket);
          return;
        }

        try {
          const text = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
          const parsed = JSON.parse(text) as ClientWsMessage;
          roomStore.handleMessage(session, parsed);
        } catch {
          session.send({
            type: 'room_error',
            version: WS_PROTOCOL_VERSION,
            code: 'transport_error',
            message: 'Invalid WebSocket message',
          });
        }
      });

      const heartbeatTimer = setInterval(() => {
        if (socket.readyState === OPEN_READY_STATE) {
          try {
            socket.ping();
          } catch {
            stopHeartbeat();
          }
        }
      }, wsHeartbeatIntervalMs);
      heartbeatTimer.unref?.();
      activeHeartbeats.add(heartbeatTimer);

      const stopHeartbeat = () => {
        if (activeHeartbeats.delete(heartbeatTimer)) {
          clearInterval(heartbeatTimer);
        }
      };

      socket.on('close', () => {
        stopHeartbeat();
        roomStore.handleDisconnect(session);
      });

      socket.on('error', () => {
        stopHeartbeat();
        roomStore.handleDisconnect(session);
      });
    },
  );

  const hasStaticDir = existsSync(staticDir);
  const hasIndexHtml = hasStaticDir && existsSync(resolve(staticDir, 'index.html'));

  if (hasStaticDir) {
    await app.register(fastifyStatic, {
      root: staticDir,
      allowedPath: (pathName) => !isServerInternalPath(pathName),
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] ?? '/';
    const hasExtension = Boolean(extname(pathname));
    if (request.method === 'GET' && hasIndexHtml && !isApiOrControlPath(pathname) && !hasExtension) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not Found' });
  });

  return app;
}
