// @vitest-environment node
import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeInfo } from '../../shared/protocol';
import { createServer } from '../app';
import {
  CloudflaredAdapter,
  parseTryCloudflareUrl,
  resolveCloudflaredBinary,
} from './cloudflaredAdapter';
import { applyTunnelStateToRuntimeInfo } from './tunnelAdapter';

class MockChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killCalls: Array<NodeJS.Signals | number | undefined> = [];
  autoExitOnSigterm = true;

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killCalls.push(signal);
    if (signal === 'SIGKILL' || (this.autoExitOnSigterm && signal === 'SIGTERM')) {
      this.signalCode = typeof signal === 'string' ? signal : 'SIGTERM';
      queueMicrotask(() => {
        this.emit('exit', null, this.signalCode);
      });
    }
    return true;
  }
}

describe('server/tunnel/cloudflaredAdapter', () => {
  const tempDirs: string[] = [];
  const cleanups: Array<() => Promise<void> | void> = [];

  function makeTempDir(prefix = 'pulso-cf-test-'): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function createFakeExecutable(filePath: string): void {
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(filePath, 0o755);
  }

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('resolves cloudflared binary with precedence: PULSO_CLOUDFLARED_BIN > .cloudflared-bin > sibling to execPath > PATH', () => {
    const root = makeTempDir();
    const cwd = join(root, 'workspace');
    const execDir = join(root, 'app-macos');
    const pathDir = join(root, 'path-bin');
    const envBin = join(root, 'custom', 'cloudflared');

    const localBin = join(cwd, '.cloudflared-bin', 'cloudflared');
    const siblingBin = join(execDir, 'cloudflared');
    const pathBin = join(pathDir, 'cloudflared');

    createFakeExecutable(envBin);
    createFakeExecutable(localBin);
    createFakeExecutable(siblingBin);
    createFakeExecutable(pathBin);

    expect(
      resolveCloudflaredBinary({
        cwd,
        execPath: join(execDir, 'pulso-sidecar'),
        platform: 'linux',
        env: { PULSO_CLOUDFLARED_BIN: envBin, PATH: pathDir },
      }),
    ).toBe(envBin);

    expect(
      resolveCloudflaredBinary({
        cwd,
        execPath: join(execDir, 'pulso-sidecar'),
        platform: 'linux',
        env: { PATH: pathDir },
      }),
    ).toBe(localBin);

    rmSync(localBin);
    expect(
      resolveCloudflaredBinary({
        cwd,
        execPath: join(execDir, 'pulso-sidecar'),
        platform: 'linux',
        env: { PATH: pathDir },
      }),
    ).toBe(siblingBin);

    rmSync(siblingBin);
    expect(
      resolveCloudflaredBinary({
        cwd,
        execPath: join(execDir, 'pulso-sidecar'),
        platform: 'linux',
        env: { PATH: pathDir },
      }),
    ).toBe(pathBin);

    expect(() =>
      resolveCloudflaredBinary({
        cwd,
        execPath: join(execDir, 'pulso-sidecar'),
        platform: 'linux',
        env: { PULSO_CLOUDFLARED_BIN: join(root, 'missing-bin'), PATH: '' },
      }),
    ).toThrow(/PULSO_CLOUDFLARED_BIN/);

    expect(() =>
      resolveCloudflaredBinary({
        cwd,
        execPath: join(execDir, 'pulso-sidecar'),
        platform: 'win32',
        env: { PATH: '' },
      }),
    ).toThrow(/cloudflared\.exe/i);
  });

  it('parses https://<random>.trycloudflare.com origins while ignoring non-tunnel trycloudflare hosts', () => {
    const banner = [
      '2026-11-27T12:00:00Z INF +-------------------------------------------------------------------+',
      '2026-11-27T12:00:00Z INF |  Your quick Tunnel has been created! Visit it at:                 |',
      '2026-11-27T12:00:00Z INF |  https://amber-cedar-river-42.trycloudflare.com                   |',
      '2026-11-27T12:00:00Z INF +-------------------------------------------------------------------+',
    ].join('\n');

    expect(parseTryCloudflareUrl(banner)).toBe('https://amber-cedar-river-42.trycloudflare.com');
    expect(parseTryCloudflareUrl('ERR failed request to https://api.trycloudflare.com/tunnel')).toBeNull();
    expect(parseTryCloudflareUrl('visit https://www.trycloudflare.com for docs')).toBeNull();
  });

  it('spawns cloudflared with --no-autoupdate, codesigns on darwin, parses chunked output, updates GET /api/runtime, and terminates cleanly', async () => {
    const root = makeTempDir();
    const binPath = join(root, 'cloudflared');
    createFakeExecutable(binPath);

    const child = new MockChildProcess();
    const spawnCalls: Array<{ cmd: string; args: readonly string[] }> = [];
    const execFileMock = vi.fn(() => {
      throw new Error('not yet signed');
    });

    const adapter = new CloudflaredAdapter({
      binaryPath: binPath,
      platform: 'darwin',
      execFileSyncFn: execFileMock as unknown as typeof import('node:child_process').execFileSync,
      spawnFn: ((cmd: string, args: readonly string[]) => {
        spawnCalls.push({ cmd, args });
        return child as unknown as ChildProcess;
      }) as unknown as typeof spawn,
    });

    let runtimeInfo: RuntimeInfo = { runtimeMode: 'normal', tunnelActive: false };
    adapter.on('status', (state) => {
      runtimeInfo = applyTunnelStateToRuntimeInfo(runtimeInfo, state);
    });

    const app = await createServer({
      staticDir: root,
      getRuntimeInfo: () => runtimeInfo,
      iceServersProvider: () => [{ urls: ['stun:stun.l.google.com:19302'] }],
    });
    cleanups.push(() => app.close());

    const startPromise = adapter.start({ localPort: 43123 });

    expect(spawnCalls).toEqual([
      {
        cmd: binPath,
        args: ['tunnel', '--url', 'http://127.0.0.1:43123', '--no-autoupdate'],
      },
    ]);
    expect(execFileMock).toHaveBeenCalledWith('codesign', ['-v', binPath], { stdio: 'ignore' });
    expect(execFileMock).toHaveBeenCalledWith('codesign', ['-s', '-', '--force', binPath], {
      stdio: 'ignore',
    });

    // Split URL across multiple chunks
    child.stderr.write('INF |  https://quiet-pine-');
    child.stderr.write('9876.trycloudflare.com   |\n');

    const publicOrigin = await startPromise;
    expect(publicOrigin).toBe('https://quiet-pine-9876.trycloudflare.com');
    expect(adapter.getState()).toMatchObject({
      provider: 'cloudflare',
      status: 'active',
      publicOrigin: 'https://quiet-pine-9876.trycloudflare.com',
    });

    const activeRuntimeRes = await app.inject({ method: 'GET', url: '/api/runtime' });
    expect(activeRuntimeRes.statusCode).toBe(200);
    expect(activeRuntimeRes.json()).toEqual({
      runtimeMode: 'normal',
      publicOrigin: 'https://quiet-pine-9876.trycloudflare.com',
      tunnelActive: true,
      tunnelProvider: 'cloudflare',
      turnConfigured: false,
    });

    await adapter.stop();
    expect(child.killCalls).toEqual(['SIGTERM']);
    expect(adapter.getState()).toMatchObject({
      provider: 'cloudflare',
      status: 'stopped',
    });

    const stoppedRuntimeRes = await app.inject({ method: 'GET', url: '/api/runtime' });
    expect(stoppedRuntimeRes.statusCode).toBe(200);
    expect(stoppedRuntimeRes.json()).toEqual({
      runtimeMode: 'normal',
      tunnelActive: false,
      turnConfigured: false,
    });
  });

  it('rejects on startup timeout, early child exit, or escalates to SIGKILL when SIGTERM hangs', async () => {
    const root = makeTempDir();
    const binPath = join(root, 'cloudflared');
    createFakeExecutable(binPath);

    // 1. Timeout + SIGKILL escalation
    const hungChild = new MockChildProcess();
    hungChild.autoExitOnSigterm = false;

    const timeoutAdapter = new CloudflaredAdapter({
      binaryPath: binPath,
      platform: 'linux',
      startupTimeoutMs: 40,
      stopTimeoutMs: 30,
      spawnFn: (() => hungChild as unknown as ChildProcess) as unknown as typeof spawn,
    });

    await expect(timeoutAdapter.start({ localPort: 3001 })).rejects.toThrow(/Timed out/i);
    expect(hungChild.killCalls).toContain('SIGTERM');
    expect(hungChild.killCalls).toContain('SIGKILL');
    expect(timeoutAdapter.getState().status).toBe('error');

    // 2. Early exit with stderr diagnostic
    const failingChild = new MockChildProcess();
    const exitAdapter = new CloudflaredAdapter({
      binaryPath: binPath,
      platform: 'linux',
      spawnFn: (() => failingChild as unknown as ChildProcess) as unknown as typeof spawn,
    });
    const startP = exitAdapter.start({ localPort: 3001 });
    failingChild.stderr.write('ERR failed to create quick tunnel\n');
    failingChild.exitCode = 1;
    failingChild.emit('exit', 1, null);

    await expect(startP).rejects.toThrow(/failed to create quick tunnel/i);
    expect(exitAdapter.getState().status).toBe('error');

    // 3. Unexpected exit after ready emits exit + error state and clears publicOrigin
    const flakyChild = new MockChildProcess();
    const flakyAdapter = new CloudflaredAdapter({
      binaryPath: binPath,
      platform: 'linux',
      spawnFn: (() => flakyChild as unknown as ChildProcess) as unknown as typeof spawn,
    });
    const observedErrors: Error[] = [];
    flakyAdapter.on('error', (err) => observedErrors.push(err));

    const readyP = flakyAdapter.start({ localPort: 3001 });
    flakyChild.stdout.write('https://steady-cedar-123.trycloudflare.com\n');
    await expect(readyP).resolves.toBe('https://steady-cedar-123.trycloudflare.com');

    flakyChild.exitCode = 2;
    flakyChild.emit('exit', 2, null);

    expect(flakyAdapter.getState().status).toBe('error');
    expect(flakyAdapter.getState().publicOrigin).toBeUndefined();
    expect(observedErrors).toHaveLength(1);
    expect(observedErrors[0]?.message).toMatch(/exited unexpectedly/i);
  });
});
