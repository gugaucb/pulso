// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WS_PROTOCOL_VERSION, type ServerWsMessage } from '../shared/protocol';
import {
  createServer,
  resolveDefaultStaticDir,
  resolveOriginIp,
  resolveTrustProxy,
} from './app';
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
    expect(runtime.json()).toEqual({ runtimeMode: 'normal', turnConfigured: false });

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

  it('resolves staticDir to built dist and never exposes raw development /src/main.tsx', async () => {
    const resolvedDir = resolveDefaultStaticDir();
    expect(resolvedDir.endsWith('dist')).toBe(true);

    const app = await createServer();
    cleanups.push(() => app.close());

    const rootRes = await app.inject({ method: 'GET', url: '/' });
    expect(rootRes.statusCode).toBe(200);
    // Built index.html references /assets/, not unbundled /src/main.tsx
    expect(rootRes.body).not.toContain('/src/main.tsx');

    const rawSrcRes = await app.inject({ method: 'GET', url: '/src/main.tsx' });
    expect(rawSrcRes.statusCode).toBe(404);
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

  it('prefers process.env.PULSO_STATIC_DIR in resolveDefaultStaticDir()', () => {
    const customStaticDir = mkdtempSync(join(tmpdir(), 'pulso-custom-static-'));
    const previous = process.env.PULSO_STATIC_DIR;
    cleanups.push(() => {
      if (previous === undefined) {
        delete process.env.PULSO_STATIC_DIR;
      } else {
        process.env.PULSO_STATIC_DIR = previous;
      }
      rmSync(customStaticDir, { recursive: true, force: true });
    });

    process.env.PULSO_STATIC_DIR = `  ${customStaticDir}  `;
    expect(resolveDefaultStaticDir()).toBe(customStaticDir);
  });

  it('auto-populates turnConfigured on GET /api/runtime in normal mode without overwriting explicit values or leaking into tor mode', async () => {
    const appWithTurn = await createServer({
      iceServersProvider: () => [{ urls: 'turn:turn.example.org:3478' }],
      getRuntimeInfo: () => ({
        runtimeMode: 'normal',
        publicOrigin: 'https://demo.trycloudflare.com/path',
        tunnelActive: true,
        tunnelProvider: 'cloudflare',
      }),
    });
    cleanups.push(() => appWithTurn.close());

    const resWithTurn = await appWithTurn.inject({ method: 'GET', url: '/api/runtime' });
    expect(resWithTurn.statusCode).toBe(200);
    expect(resWithTurn.json()).toEqual({
      runtimeMode: 'normal',
      publicOrigin: 'https://demo.trycloudflare.com',
      tunnelActive: true,
      tunnelProvider: 'cloudflare',
      turnConfigured: true,
    });

    const appExplicitFalse = await createServer({
      iceServersProvider: () => [{ urls: 'turn:turn.example.org:3478' }],
      runtimeInfo: {
        runtimeMode: 'normal',
        turnConfigured: false,
      },
    });
    cleanups.push(() => appExplicitFalse.close());

    const resExplicitFalse = await appExplicitFalse.inject({ method: 'GET', url: '/api/runtime' });
    expect(resExplicitFalse.statusCode).toBe(200);
    expect(resExplicitFalse.json()).toEqual({
      runtimeMode: 'normal',
      turnConfigured: false,
    });

    const appTor = await createServer({
      iceServersProvider: () => [{ urls: 'turn:turn.example.org:3478' }],
      runtimeInfo: {
        runtimeMode: 'tor',
        torStatus: 'bootstrapping',
      },
    });
    cleanups.push(() => appTor.close());

    const resTor = await appTor.inject({ method: 'GET', url: '/api/runtime' });
    expect(resTor.statusCode).toBe(200);
    expect(resTor.json()).toEqual({
      runtimeMode: 'tor',
      torStatus: 'bootstrapping',
    });
  });

  it('resolves TRUST_PROXY from env and enforces loopback-only cf-connecting-ip origin isolation without leaking trust outside tunnel mode', async () => {
    expect(resolveTrustProxy({})).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: 'false' })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: '0' })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: 'true' })).toBe(true);
    expect(resolveTrustProxy({ TRUST_PROXY: ' TRUE ' })).toBe(true);
    expect(resolveTrustProxy({ TRUST_PROXY: '1' })).toBe(true);

    // Loopback + tunnelActive=true reads cf-connecting-ip or first hop of x-forwarded-for
    for (const loopback of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(
        resolveOriginIp(
          {
            ip: loopback,
            headers: {
              'cf-connecting-ip': '203.0.113.10',
              'x-forwarded-for': '198.51.100.1, 10.0.0.1',
            },
            raw: { socket: { remoteAddress: loopback } },
          },
          { runtimeMode: 'normal', tunnelActive: true, tunnelProvider: 'cloudflare' },
        ),
      ).toBe('203.0.113.10');

      expect(
        resolveOriginIp(
          {
            ip: loopback,
            headers: {
              'x-forwarded-for': '198.51.100.1, 10.0.0.1',
            },
            raw: { socket: { remoteAddress: loopback } },
          },
          { runtimeMode: 'normal', tunnelActive: true },
        ),
      ).toBe('198.51.100.1');
    }

    // Never trust cf-connecting-ip when tunnelActive is false/unset
    expect(
      resolveOriginIp(
        {
          ip: '127.0.0.1',
          headers: { 'cf-connecting-ip': '203.0.113.10' },
          raw: { socket: { remoteAddress: '127.0.0.1' } },
        },
        { runtimeMode: 'normal', tunnelActive: false },
      ),
    ).toBe('127.0.0.1');

    // Never trust cf-connecting-ip when raw socket is non-loopback, even if request.ip was proxied
    expect(
      resolveOriginIp(
        {
          ip: '127.0.0.1',
          headers: { 'cf-connecting-ip': '203.0.113.10' },
          raw: { socket: { remoteAddress: '198.51.100.77' } },
        },
        { runtimeMode: 'normal', tunnelActive: true },
      ),
    ).toBe('127.0.0.1');

    // Integration: loopback tunnel isolates Host vs Guest rate limits on /ws
    const tunnelApp = await createServer({
      runtimeInfo: {
        runtimeMode: 'normal',
        tunnelActive: true,
        tunnelProvider: 'cloudflare',
        publicOrigin: 'https://pulso-tunnel.trycloudflare.com',
      },
      securityOptions: { wsConnectMax: 1 },
    });
    await tunnelApp.ready();
    cleanups.push(() => tunnelApp.close());

    const hostWs = await tunnelApp.injectWS('/ws', {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'cf-connecting-ip': '203.0.113.10' },
    });
    cleanups.push(() => hostWs.close());

    await expect(
      tunnelApp.injectWS('/ws', {
        socket: { remoteAddress: '127.0.0.1' },
        headers: { 'cf-connecting-ip': '203.0.113.10' },
      }),
    ).rejects.toThrow(/429/);

    const guestWs = await tunnelApp.injectWS('/ws', {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'cf-connecting-ip': '198.51.100.20' },
    });
    cleanups.push(() => guestWs.close());
    expect(guestWs.readyState).toBe(1);

    // Without tunnelActive, spoofing cf-connecting-ip does not isolate buckets
    const directApp = await createServer({
      runtimeInfo: { runtimeMode: 'normal' },
      securityOptions: { wsConnectMax: 1 },
    });
    await directApp.ready();
    cleanups.push(() => directApp.close());

    const directWs1 = await directApp.injectWS('/ws', {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'cf-connecting-ip': '203.0.113.10' },
    });
    cleanups.push(() => directWs1.close());

    await expect(
      directApp.injectWS('/ws', {
        socket: { remoteAddress: '127.0.0.1' },
        headers: { 'cf-connecting-ip': '198.51.100.20' },
      }),
    ).rejects.toThrow(/429/);

    // TRUST_PROXY=true enables Fastify trustProxy so x-forwarded-for isolates participants behind Caddy/PaaS
    const proxyApp = await createServer({
      trustProxy: true,
      securityOptions: { wsConnectMax: 1 },
    });
    await proxyApp.ready();
    cleanups.push(() => proxyApp.close());

    const proxiedHostWs = await proxyApp.injectWS('/ws', {
      socket: { remoteAddress: '10.0.0.2' },
      headers: { 'x-forwarded-for': '203.0.113.50' },
    });
    cleanups.push(() => proxiedHostWs.close());

    await expect(
      proxyApp.injectWS('/ws', {
        socket: { remoteAddress: '10.0.0.2' },
        headers: { 'x-forwarded-for': '203.0.113.50' },
      }),
    ).rejects.toThrow(/429/);

    const proxiedGuestWs = await proxyApp.injectWS('/ws', {
      socket: { remoteAddress: '10.0.0.2' },
      headers: { 'x-forwarded-for': '198.51.100.60' },
    });
    cleanups.push(() => proxiedGuestWs.close());
    expect(proxiedGuestWs.readyState).toBe(1);
  });

  it('sends WebSocket protocol ping frames on heartbeat interval (default 35_000ms, unrefed, cleaned up) without altering room expiresAt or emitting activity_reset', async () => {
    const clock = new ManualClock(1_700_000_000_000);
    const app = await createServer({
      clock,
      wsHeartbeatIntervalMs: 25,
    });
    await app.ready();
    cleanups.push(() => app.close());

    const hostWs = await app.injectWS('/ws');
    cleanups.push(() => {
      if (hostWs.readyState === 0 || hostWs.readyState === 1) hostWs.close();
    });

    const receivedMessages: ServerWsMessage[] = [];
    hostWs.on('message', (data) => {
      receivedMessages.push(JSON.parse(data.toString('utf8')) as ServerWsMessage);
    });

    let pingCount = 0;
    hostWs.on('ping', () => {
      pingCount += 1;
    });

    hostWs.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'H7B2-K9P4',
        displayName: 'Ana',
        mode: 'normal',
        inactivityDurationMs: 60_000,
      }),
    );

    await vi.waitFor(() => {
      expect(receivedMessages.some((m) => m.type === 'room_joined')).toBe(true);
    });
    const joined = receivedMessages.find((m) => m.type === 'room_joined')!;
    expect(joined.type === 'room_joined' && joined.expiresAt).toBe(1_700_000_060_000);

    // Wait for multiple protocol-level ping heartbeats
    await vi.waitFor(() => {
      expect(pingCount).toBeGreaterThanOrEqual(2);
    });

    // Heartbeat must NEVER emit activity_reset or extend room.expiresAt
    expect(receivedMessages.some((m) => m.type === 'activity_reset')).toBe(false);
    clock.advanceBy(60_000);

    await vi.waitFor(() => {
      expect(receivedMessages).toContainEqual({
        type: 'room_expired',
        version: WS_PROTOCOL_VERSION,
        reason: 'inactivity',
      });
    });

    // Default interval is 35_000ms, unrefed, and cleared on close / app.close
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    cleanups.push(() => {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    const defaultApp = await createServer({ clock });
    await defaultApp.ready();
    cleanups.push(() => defaultApp.close());

    const wsDefault = await defaultApp.injectWS('/ws');
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 35_000);
    const createdHandle = setIntervalSpy.mock.results.at(-1)?.value;

    wsDefault.terminate();
    await vi.waitFor(() => {
      expect(clearIntervalSpy).toHaveBeenCalledWith(createdHandle);
    });

    // Also verify app.close() cleans up any still-open socket heartbeat timers
    const wsOpenAtClose = await defaultApp.injectWS('/ws');
    cleanups.push(() => {
      if (wsOpenAtClose.readyState === 0 || wsOpenAtClose.readyState === 1) wsOpenAtClose.terminate();
    });
    const secondHandle = setIntervalSpy.mock.results.at(-1)?.value;
    await defaultApp.close();
    expect(clearIntervalSpy).toHaveBeenCalledWith(secondHandle);
  });
});
