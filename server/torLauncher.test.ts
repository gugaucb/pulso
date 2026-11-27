// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WS_PROTOCOL_VERSION, type ServerWsMessage } from '../shared/protocol';
import { ManualClock } from './clock';
import type { TorControllerState } from './tor/torController';
import { startTorServer, type TorControllerLike } from './torLauncher';

function nextServerMessage(ws: {
  once: (event: string, cb: (data: Buffer | string) => void) => void;
}): Promise<ServerWsMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      resolve(JSON.parse(text) as ServerWsMessage);
    });
  });
}

class ControlledTorController extends EventEmitter implements TorControllerLike {
  public startedWithPort?: number;
  public stopCalls = 0;
  private readonly dataDir: string;
  private resolveStart!: (onion: string) => void;
  private rejectStart!: (err: Error) => void;

  constructor(localPort: number, dataDir: string) {
    super();
    this.startedWithPort = localPort;
    this.dataDir = dataDir;
  }

  start(): Promise<string> {
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(join(this.dataDir, 'torrc'), 'DataDirectory test', 'utf8');
    this.emit('status', {
      status: 'bootstrapping',
      bootstrapProgress: 15,
    } satisfies TorControllerState);
    return new Promise<string>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
  }

  finishReady(onionAddress: string): void {
    this.emit('status', {
      status: 'ready',
      onionAddress,
      bootstrapProgress: 100,
    } satisfies TorControllerState);
    this.resolveStart(onionAddress);
  }

  failStart(error: Error): void {
    this.emit('status', {
      status: 'error',
      bootstrapProgress: 0,
      error,
    } satisfies TorControllerState);
    this.rejectStart(error);
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    rmSync(this.dataDir, { recursive: true, force: true });
  }
}

describe('server/torLauncher', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  it('binds strictly to 127.0.0.1, exposes bootstrapping -> ready on /api/runtime, logs neutral status, and purges tor_data on stop', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pulso-tor-launcher-'));
    const dataDir = join(tempRoot, 'tor_data');
    cleanups.push(() => rmSync(tempRoot, { recursive: true, force: true }));

    const logs: string[] = [];
    let controller!: ControlledTorController;

    const handle = await startTorServer({
      port: 0,
      dataDir,
      waitForReady: false,
      log: (line) => logs.push(line),
      createTorController: (opts) => {
        controller = new ControlledTorController(opts.localPort, opts.dataDir ?? dataDir);
        return controller;
      },
    });
    cleanups.push(() => handle.stop());

    expect(handle.localUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(handle.port).toBeGreaterThan(0);
    expect(controller.startedWithPort).toBe(handle.port);

    const bootstrappingRes = await handle.app.inject({ method: 'GET', url: '/api/runtime' });
    expect(bootstrappingRes.statusCode).toBe(200);
    expect(bootstrappingRes.json()).toEqual({
      runtimeMode: 'tor',
      torStatus: 'bootstrapping',
    });

    const realOnion = `http://${'b'.repeat(56)}.onion`;
    controller.finishReady(realOnion);
    await expect(handle.ready).resolves.toBe(realOnion);

    const readyRes = await handle.app.inject({ method: 'GET', url: '/api/runtime' });
    expect(readyRes.statusCode).toBe(200);
    expect(readyRes.json()).toEqual({
      runtimeMode: 'tor',
      torStatus: 'ready',
      onionAddress: realOnion,
    });

    const combinedLogs = logs.join('\n');
    expect(combinedLogs).toContain(handle.localUrl);
    expect(combinedLogs).toContain('bootstrapping');
    expect(combinedLogs).toContain(realOnion);
    expect(combinedLogs).not.toMatch(/[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}/);

    expect(existsSync(dataDir)).toBe(true);
    await handle.stop();
    expect(controller.stopCalls).toBe(1);
    expect(existsSync(dataDir)).toBe(false);
  });

  it('logs actionable error, purges tor_data, closes Fastify, and rejects when tor binary is missing', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pulso-tor-missing-'));
    const dataDir = join(tempRoot, 'tor_data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'stale.txt'), 'residual', 'utf8');
    cleanups.push(() => rmSync(tempRoot, { recursive: true, force: true }));

    const errors: string[] = [];

    await expect(
      startTorServer({
        port: 0,
        cwd: tempRoot,
        dataDir,
        env: { PATH: '' },
        errorLog: (line) => errors.push(line),
      }),
    ).rejects.toThrow(/Tor daemon binary not found/i);

    expect(errors.join('\n')).toMatch(/PULSO_TOR_BIN|fetch-tor-bundle/i);
    expect(existsSync(dataDir)).toBe(false);
  });

  it('purges tor_data and closes server cleanly if TorController fails during bootstrap', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pulso-tor-fail-'));
    const dataDir = join(tempRoot, 'tor_data');
    cleanups.push(() => rmSync(tempRoot, { recursive: true, force: true }));

    const errors: string[] = [];
    let controller!: ControlledTorController;

    const handle = await startTorServer({
      port: 0,
      dataDir,
      waitForReady: false,
      errorLog: (line) => errors.push(line),
      createTorController: (opts) => {
        controller = new ControlledTorController(opts.localPort, opts.dataDir ?? dataDir);
        return controller;
      },
    });
    cleanups.push(() => handle.stop());

    expect(existsSync(dataDir)).toBe(true);
    controller.failStart(new Error('Bootstrap stalled'));

    await expect(handle.ready).rejects.toThrow(/Bootstrap stalled/);
    expect(handle.getRuntimeInfo()).toEqual({
      runtimeMode: 'tor',
      torStatus: 'error',
    });
    expect(controller.stopCalls).toBe(1);
    expect(existsSync(dataDir)).toBe(false);
    expect(errors.join('\n')).toContain('Bootstrap stalled');
  });

  it('keeps Tor running on Guest leave_room and stops TorController, purges tor_data, and closes Fastify on Host leave_room', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pulso-tor-host-leave-'));
    const dataDir = join(tempRoot, 'tor_data');
    cleanups.push(() => rmSync(tempRoot, { recursive: true, force: true }));

    let controller!: ControlledTorController;
    const handle = await startTorServer({
      port: 0,
      dataDir,
      waitForReady: false,
      log: () => {},
      createTorController: (opts) => {
        controller = new ControlledTorController(opts.localPort, opts.dataDir ?? dataDir);
        return controller;
      },
    });
    cleanups.push(() => handle.stop());

    const realOnion = `http://${'c'.repeat(56)}.onion`;
    controller.finishReady(realOnion);
    await handle.ready;

    const hostWs = await handle.app.injectWS('/ws');
    const guestWs = await handle.app.injectWS('/ws');
    cleanups.push(() => {
      if (hostWs.readyState === 1 || hostWs.readyState === 0) hostWs.close();
      if (guestWs.readyState === 1 || guestWs.readyState === 0) guestWs.close();
    });

    const hostJoinedP = nextServerMessage(hostWs);
    hostWs.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'T7R2-M9K4',
        displayName: 'Host',
        mode: 'tor',
        onionAddress: realOnion,
      }),
    );
    expect((await hostJoinedP).type).toBe('room_joined');

    const guestJoinedP = nextServerMessage(guestWs);
    const hostPeerJoinedP = nextServerMessage(hostWs);
    guestWs.send(
      JSON.stringify({
        type: 'join_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'T7R2-M9K4',
        displayName: 'Guest',
      }),
    );
    expect((await guestJoinedP).type).toBe('room_joined');
    expect((await hostPeerJoinedP).type).toBe('participant_joined');

    // Guest leaves explicitly -> room stays open and Tor remains running
    const hostPeerLeftP = nextServerMessage(hostWs);
    guestWs.send(JSON.stringify({ type: 'leave_room', version: WS_PROTOCOL_VERSION }));
    expect((await hostPeerLeftP).type).toBe('participant_left');
    expect(controller.stopCalls).toBe(0);
    expect(existsSync(dataDir)).toBe(true);
    expect(handle.app.server.listening).toBe(true);

    // Host leaves explicitly -> room closes, triggering Tor stop + tor_data purge + Fastify close
    hostWs.send(JSON.stringify({ type: 'leave_room', version: WS_PROTOCOL_VERSION }));

    await vi.waitFor(() => {
      expect(controller.stopCalls).toBe(1);
      expect(existsSync(dataDir)).toBe(false);
      expect(handle.app.server.listening).toBe(false);
    });
  });

  it('automatically stops TorController, purges tor_data, and closes Fastify when the Tor room expires by inactivity', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pulso-tor-expiry-'));
    const dataDir = join(tempRoot, 'tor_data');
    cleanups.push(() => rmSync(tempRoot, { recursive: true, force: true }));

    const clock = new ManualClock(1_700_000_000_000);
    let controller!: ControlledTorController;
    const handle = await startTorServer({
      port: 0,
      dataDir,
      clock,
      waitForReady: false,
      log: () => {},
      createTorController: (opts) => {
        controller = new ControlledTorController(opts.localPort, opts.dataDir ?? dataDir);
        return controller;
      },
    });
    cleanups.push(() => handle.stop());

    const realOnion = `http://${'d'.repeat(56)}.onion`;
    controller.finishReady(realOnion);
    await handle.ready;

    const hostWs = await handle.app.injectWS('/ws');
    cleanups.push(() => {
      if (hostWs.readyState === 1 || hostWs.readyState === 0) hostWs.close();
    });

    const hostJoinedP = nextServerMessage(hostWs);
    hostWs.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'X9K2-P7M4',
        displayName: 'Host',
        mode: 'tor',
        onionAddress: realOnion,
      }),
    );
    expect((await hostJoinedP).type).toBe('room_joined');

    const hostExpiredP = nextServerMessage(hostWs);
    clock.advanceBy(60 * 60 * 1000);

    expect(await hostExpiredP).toEqual({
      type: 'room_expired',
      version: WS_PROTOCOL_VERSION,
      reason: 'inactivity',
    });

    await vi.waitFor(() => {
      expect(controller.stopCalls).toBe(1);
      expect(existsSync(dataDir)).toBe(false);
      expect(handle.app.server.listening).toBe(false);
    });
  });

  it('defaults dataDir to a unique 0o700 directory under os.tmpdir(), never writes to cwd, and purges on stop', async () => {
    const fakeCwd = mkdtempSync(join(tmpdir(), 'pulso-ro-cwd-'));
    cleanups.push(() => rmSync(fakeCwd, { recursive: true, force: true }));

    let capturedDataDir = '';
    let controller!: ControlledTorController;
    const handle = await startTorServer({
      port: 0,
      cwd: fakeCwd,
      waitForReady: false,
      log: () => {},
      createTorController: (opts) => {
        capturedDataDir = opts.dataDir ?? '';
        controller = new ControlledTorController(opts.localPort, capturedDataDir);
        return controller;
      },
    });
    cleanups.push(() => handle.stop());
    cleanups.push(() => rmSync(capturedDataDir, { recursive: true, force: true }));

    expect(dirname(capturedDataDir)).toBe(resolve(tmpdir()));
    expect(basename(capturedDataDir).startsWith('pulso-tor-')).toBe(true);
    expect(existsSync(capturedDataDir)).toBe(true);
    expect(existsSync(join(fakeCwd, 'tor_data'))).toBe(false);
    if (process.platform !== 'win32') {
      expect(statSync(capturedDataDir).mode & 0o777).toBe(0o700);
    }

    const realOnion = `http://${'e'.repeat(56)}.onion`;
    controller.finishReady(realOnion);
    await handle.ready;

    await handle.stop();
    expect(existsSync(capturedDataDir)).toBe(false);
    expect(existsSync(join(fakeCwd, 'tor_data'))).toBe(false);
  });
});
