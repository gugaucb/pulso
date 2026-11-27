// @vitest-environment node
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WS_PROTOCOL_VERSION, type ServerWsMessage } from '../shared/protocol';
import { resolveDefaultStaticDir } from './app';
import { parseSidecarArgs, startSidecar, type SidecarEvent } from './sidecar';
import type { TorControllerOptions, TorControllerState } from './tor/torController';
import type { TorControllerLike } from './torLauncher';
import type { TunnelAdapter, TunnelStartOptions, TunnelState } from './tunnel/tunnelAdapter';

function parseNdjson(chunks: string[]): SidecarEvent[] {
  return chunks
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SidecarEvent);
}

class FakeTunnelAdapter extends EventEmitter implements TunnelAdapter {
  readonly provider = 'cloudflare' as const;
  startCalls: TunnelStartOptions[] = [];
  stopCalls = 0;
  private state: TunnelState = { provider: 'cloudflare', status: 'idle' };

  getState(): TunnelState {
    return { ...this.state };
  }

  async start(options: TunnelStartOptions): Promise<string> {
    this.startCalls.push(options);
    this.state = { provider: 'cloudflare', status: 'starting' };
    this.emit('status', this.getState());

    const origin = 'https://pine-fjord-404.trycloudflare.com';
    this.state = { provider: 'cloudflare', status: 'active', publicOrigin: origin };
    this.emit('status', this.getState());
    this.emit('ready', origin);
    return origin;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.state = { provider: 'cloudflare', status: 'stopped' };
    this.emit('status', this.getState());
  }
}

class FakeTorController extends EventEmitter implements TorControllerLike {
  stopCalls = 0;
  constructor(readonly options: TorControllerOptions) {
    super();
  }

  async start(): Promise<string> {
    const dir = this.options.dataDir!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'torrc'), 'UseBridges 1', 'utf8');

    this.emit('progress', {
      phase: 'conn_pt',
      progress: 10,
      bridgeMode: this.options.bridgeMode ?? 'direct',
      tag: 'conn_pt',
      summary: 'Connecting to pluggable transport',
    });
    this.emit('stall', {
      reason: 'warn_bootstrap',
      bridgeMode: this.options.bridgeMode ?? 'direct',
      progress: 10,
      summary: 'Problem connecting to 198.51.100.22:443',
    });

    const onion = `http://${'f'.repeat(56)}.onion`;
    this.emit('status', {
      status: 'ready',
      bootstrapProgress: 100,
      onionAddress: onion,
    } satisfies TorControllerState);
    return onion;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }
}

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

describe('server/sidecar', () => {
  const tempDirs: string[] = [];
  const cleanups: Array<() => Promise<void> | void> = [];

  function makeTempDir(prefix = 'pulso-sidecar-test-'): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
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

  it('parses tor and local CLI arguments and rejects sensitive secrets via CLI args', () => {
    expect(parseSidecarArgs(['--mode', 'tor', '--bridge-mode', 'snowflake', '--port', '0'])).toMatchObject({
      mode: 'tor',
      bridgeMode: 'snowflake',
      port: 0,
      host: '127.0.0.1',
      tunnel: false,
    });

    expect(
      parseSidecarArgs(['--mode=local', '--tunnel', '--static-dir', '/tmp/dist', '--stdin-config']),
    ).toMatchObject({
      mode: 'local',
      tunnel: true,
      staticDir: '/tmp/dist',
      stdinConfig: true,
    });

    expect(() => parseSidecarArgs(['--mode', 'tor', '--bridge-mode', 'custom', '--custom-bridges', 'obfs4 ...'])).toThrow(
      /stdin/i,
    );
    expect(() => parseSidecarArgs(['--mode', 'local', '--turn-secret', 's3cr3t'])).toThrow(/stdin/i);
    expect(() => parseSidecarArgs(['--mode', 'local', '--turn-credential', 'pass'])).toThrow(/stdin/i);
    expect(() => parseSidecarArgs(['--mode', 'invalid'])).toThrow(/Invalid sidecar mode/i);
  });

  it('resolves staticDir cleanly in CJS/SEA mode when import.meta.url is undefined', () => {
    const root = makeTempDir();
    const macContents = join(root, 'PULSO.app', 'Contents');
    const execPath = join(macContents, 'MacOS', 'pulso-sidecar');
    const resourcesDist = join(macContents, 'Resources', 'dist');
    mkdirSync(join(macContents, 'MacOS'), { recursive: true });
    mkdirSync(resourcesDist, { recursive: true });
    writeFileSync(join(resourcesDist, 'index.html'), '<html></html>', 'utf8');

    expect(
      resolveDefaultStaticDir({
        importMetaUrl: '',
        dirnamePath: '',
        execPath,
        cwd: join(root, 'empty-cwd'),
        env: {},
      }),
    ).toBe(resourcesDist);
  });

  it('runs local mode with --tunnel and RAM-only TURN credentials from stdin JSON, emits NDJSON, and stops on stdin EOF', async () => {
    const staticDir = makeTempDir('pulso-sidecar-dist-');
    writeFileSync(join(staticDir, 'index.html'), '<html><body>PULSO</body></html>', 'utf8');

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdoutChunks: string[] = [];
    stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString('utf8')));

    const tunnelAdapter = new FakeTunnelAdapter();
    const prevTurnEnv = process.env.TURN_URLS;

    // Write initial config line, keeping stdin open as liveness pipe
    stdin.write(
      JSON.stringify({
        turnConfig: {
          turnUrls: ['turns:turn.example.org:5349'],
          turnUsername: 'ephemeral-user',
          turnCredential: 'ephemeral-pass',
        },
      }) + '\n',
    );

    const handle = await startSidecar({
      mode: 'local',
      port: 0,
      staticDir,
      tunnel: true,
      stdinConfig: true,
      waitForReady: true,
      stdin,
      stdout,
      stderr,
      env: {},
      createTunnelAdapter: () => tunnelAdapter,
    });
    cleanups.push(() => handle.stop());

    // process.env must remain untouched (RAM-only TURN)
    expect(process.env.TURN_URLS).toBe(prevTurnEnv);
    expect(tunnelAdapter.startCalls).toEqual([{ localPort: handle.port, localHost: '127.0.0.1' }]);

    const runtimeRes = await handle.app.inject({ method: 'GET', url: '/api/runtime' });
    expect(runtimeRes.statusCode).toBe(200);
    expect(runtimeRes.json()).toEqual({
      runtimeMode: 'normal',
      publicOrigin: 'https://pine-fjord-404.trycloudflare.com',
      tunnelActive: true,
      tunnelProvider: 'cloudflare',
      turnConfigured: true,
    });

    // Verify TURN credentials flow to room_joined iceServers in RAM
    const ws = await handle.app.injectWS('/ws');
    cleanups.push(() => {
      if (ws.readyState === 0 || ws.readyState === 1) ws.close();
    });
    const joinedP = nextServerMessage(ws);
    ws.send(
      JSON.stringify({
        type: 'create_room',
        version: WS_PROTOCOL_VERSION,
        roomCode: 'M4N8-K2P7',
        displayName: 'Host',
        mode: 'normal',
      }),
    );
    const joined = await joinedP;
    expect(joined.type).toBe('room_joined');
    if (joined.type === 'room_joined') {
      expect(joined.iceServers).toEqual(
        expect.arrayContaining([
          {
            urls: ['turns:turn.example.org:5349'],
            username: 'ephemeral-user',
            credential: 'ephemeral-pass',
          },
        ]),
      );
    }

    // Trigger graceful shutdown via stdin EOF
    stdin.end();
    await vi.waitFor(() => {
      const events = parseNdjson(stdoutChunks);
      expect(events.map((e) => e.event)).toEqual([
        'listening',
        'tunnel_starting',
        'tunnel_ready',
        'stopping',
        'stopped',
      ]);
    });
    expect(tunnelAdapter.stopCalls).toBe(1);
    expect(handle.app.server.listening).toBe(false);
  });

  it('runs tor mode with custom bridges from stdin JSON, emits NDJSON progress/stall/ready, and purges dataDir on stop', async () => {
    const tempRoot = makeTempDir('pulso-sidecar-tor-');
    const staticDir = join(tempRoot, 'dist');
    const dataDir = join(tempRoot, 'ephemeral-tor');
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<html><body>PULSO</body></html>', 'utf8');

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString('utf8')));
    stderr.on('data', (chunk) => stderrChunks.push(chunk.toString('utf8')));

    let capturedController!: FakeTorController;
    const bridgeLine = `obfs4 198.51.100.22:443 ${'A'.repeat(40)} cert=xyz iat-mode=0`;
    stdin.write(JSON.stringify({ customBridges: [bridgeLine] }) + '\n');

    const handle = await startSidecar({
      mode: 'tor',
      port: 0,
      staticDir,
      torDataDir: dataDir,
      bridgeMode: 'custom',
      waitForReady: true,
      stdin,
      stdout,
      stderr,
      createTorController: (opts) => {
        capturedController = new FakeTorController(opts);
        return capturedController;
      },
    });
    cleanups.push(() => handle.stop());

    expect(capturedController.options.bridgeMode).toBe('custom');
    expect(capturedController.options.customBridges).toEqual([bridgeLine]);
    expect(existsSync(dataDir)).toBe(true);

    const runtimeRes = await handle.app.inject({ method: 'GET', url: '/api/runtime' });
    expect(runtimeRes.json()).toEqual({
      runtimeMode: 'tor',
      torStatus: 'ready',
      onionAddress: `http://${'f'.repeat(56)}.onion`,
    });

    await handle.stop();
    expect(capturedController.stopCalls).toBe(1);
    expect(existsSync(dataDir)).toBe(false);

    const events = parseNdjson(stdoutChunks);
    expect(events.map((e) => e.event)).toEqual([
      'listening',
      'tor_progress',
      'tor_stall',
      'tor_ready',
      'stopping',
      'stopped',
    ]);
    // Ensure sensitive bridge IP never leaked into stdout/stderr
    expect(stdoutChunks.join('') + stderrChunks.join('')).not.toContain('198.51.100.22');
  });

  it('rejects custom bridge mode if stdin closes without JSON config', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdin.end();

    await expect(
      startSidecar({
        mode: 'tor',
        bridgeMode: 'custom',
        stdin,
        stdout,
        stderr,
      }),
    ).rejects.toThrow(/Expected JSON configuration on stdin/i);
  });
});
