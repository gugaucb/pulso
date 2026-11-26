import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  WS_PROTOCOL_VERSION,
  type ClientWsMessage,
  type RuntimeInfo,
} from '../shared/protocol';
import { systemClock, type Clock } from './clock';
import { RoomStore, type ClientSession } from './roomStore';

const MAX_WS_PAYLOAD_BYTES = 64 * 1024;
const OPEN_READY_STATE = 1;

export interface CreateServerOptions {
  clock?: Clock;
  staticDir?: string;
  runtimeInfo?: RuntimeInfo;
  inactivityDurationMs?: number;
  hardTtlMs?: number;
  graceWindowMs?: number;
}

function resolveDefaultStaticDir(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const bundledDist = resolve(currentDir, '..');
  if (existsSync(resolve(bundledDist, 'index.html'))) {
    return bundledDist;
  }
  return resolve(process.cwd(), 'dist');
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

/**
 * Creates a zero-trace Fastify instance serving HTTP static assets,
 * health/runtime endpoints, and the same-origin /ws WebSocket coordinator.
 */
export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  const clock = options.clock ?? systemClock;
  const roomStore = new RoomStore(clock, {
    inactivityDurationMs: options.inactivityDurationMs,
    hardTtlMs: options.hardTtlMs,
    graceWindowMs: options.graceWindowMs,
  });
  const runtimeInfo: RuntimeInfo = options.runtimeInfo ?? { runtimeMode: 'normal' };
  const staticDir = options.staticDir ?? resolveDefaultStaticDir();

  const app = Fastify({
    logger: false,
  });

  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: MAX_WS_PAYLOAD_BYTES,
    },
  });

  app.get('/healthz', async () => {
    return { ok: true };
  });

  app.get('/api/runtime', async () => {
    return runtimeInfo;
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const session: ClientSession = {
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

    socket.on('close', () => {
      roomStore.handleDisconnect(session);
    });

    socket.on('error', () => {
      roomStore.handleDisconnect(session);
    });
  });

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
    if (request.method === 'GET' && hasIndexHtml && !isApiOrControlPath(pathname)) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not Found' });
  });

  return app;
}
