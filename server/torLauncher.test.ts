// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TorControllerState } from './tor/torController';
import { startTorServer, type TorControllerLike } from './torLauncher';

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
});
