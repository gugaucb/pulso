// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WS_PROTOCOL_VERSION, type ServerWsMessage } from '../shared/protocol';
import { createServer } from './app';
import { ManualClock } from './clock';

function nextWsMessage(ws: { once: (event: string, cb: (data: Buffer) => void) => void }): Promise<ServerWsMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString('utf8')) as ServerWsMessage);
    });
  });
}

describe('Fastify app in-process seam (inject + injectWS)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  it('serves /healthz, /api/runtime, static assets, and SPA fallback while hiding server bundle', async () => {
    const tempDist = mkdtempSync(join(tmpdir(), 'pulso-dist-inject-'));
    mkdirSync(join(tempDist, 'server'), { recursive: true });
    writeFileSync(join(tempDist, 'index.html'), '<!doctype html><html><body>PULSO_SPA</body></html>');
    writeFileSync(join(tempDist, 'app.js'), 'console.log("client");');
    writeFileSync(join(tempDist, 'server', 'index.js'), 'SECRET_SERVER_CODE');
    cleanups.push(() => rmSync(tempDist, { recursive: true, force: true }));

    const app = await createServer({
      clock: new ManualClock(1_700_000_000_000),
      staticDir: tempDist,
    });
    cleanups.push(() => app.close());

    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const runtime = await app.inject({ method: 'GET', url: '/api/runtime' });
    expect(runtime.statusCode).toBe(200);
    expect(runtime.json()).toEqual({ runtimeMode: 'normal' });

    const spa = await app.inject({ method: 'GET', url: '/room/X9K2-P7M4' });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('PULSO_SPA');

    const asset = await app.inject({ method: 'GET', url: '/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('client');

    const serverBundle = await app.inject({ method: 'GET', url: '/server/index.js' });
    expect(serverBundle.statusCode).toBe(404);

    const api404 = await app.inject({ method: 'GET', url: '/api/unknown' });
    expect(api404.statusCode).toBe(404);
  });

  it('returns live runtime updates from getRuntimeInfo on GET /api/runtime without exposing extra fields', async () => {
    let currentRuntime = {
      runtimeMode: 'tor' as const,
      torStatus: 'bootstrapping' as const,
      onionAddress: undefined as string | undefined,
    };

    const app = await createServer({
      getRuntimeInfo: () => ({
        runtimeMode: currentRuntime.runtimeMode,
        torStatus: currentRuntime.torStatus,
        ...(currentRuntime.onionAddress ? { onionAddress: currentRuntime.onionAddress } : {}),
        // Ensure unexpected fields (if any) are never serialized if leaked by caller
        ...({ roomCode: 'X9K2-P7M4', participantId: 'secret-id' } as Record<string, unknown>),
      }),
    });
    cleanups.push(() => app.close());

    const bootstrappingRes = await app.inject({ method: 'GET', url: '/api/runtime' });
    expect(bootstrappingRes.statusCode).toBe(200);
    expect(bootstrappingRes.json()).toEqual({
      runtimeMode: 'tor',
      torStatus: 'bootstrapping',
    });

    const onion = `http://${'a'.repeat(56)}.onion`;
    currentRuntime = {
      runtimeMode: 'tor',
      torStatus: 'ready',
      onionAddress: onion,
    };

    const readyRes = await app.inject({ method: 'GET', url: '/api/runtime' });
    expect(readyRes.statusCode).toBe(200);
    expect(readyRes.json()).toEqual({
      runtimeMode: 'tor',
      torStatus: 'ready',
      onionAddress: onion,
    });
  });

  it('coordinates 1:1 WebSocket room lifecycle over /ws', async () => {
    const app = await createServer({
      clock: new ManualClock(1_700_000_000_000),
    });
    await app.ready();
    cleanups.push(() => app.close());

    const hostWs = await app.injectWS('/ws');
    const guestWs = await app.injectWS('/ws');
    cleanups.push(() => hostWs.close());
    cleanups.push(() => guestWs.close());

    const hostJoinedPromise = nextWsMessage(hostWs);
    hostWs.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'X9K2-P7M4',
        displayName: 'Ana',
        mode: 'normal',
      }),
    );
    const hostJoined = await hostJoinedPromise;
    expect(hostJoined.type).toBe('room_joined');

    const hostPeerPromise = nextWsMessage(hostWs);
    const guestJoinedPromise = nextWsMessage(guestWs);
    guestWs.send(
      JSON.stringify({
        type: 'join_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'X9K2-P7M4',
        displayName: 'João',
      }),
    );

    const [guestJoined, hostPeer] = await Promise.all([guestJoinedPromise, hostPeerPromise]);
    expect(guestJoined.type).toBe('room_joined');
    expect(hostPeer.type).toBe('participant_joined');
  });
});
