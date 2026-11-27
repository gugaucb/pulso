import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { TorControllerState } from '../../server/tor/torController';
import { startTorServer, type TorControllerLike } from '../../server/torLauncher';

export const CONTEXT_OPTIONS = {
  locale: 'pt-BR',
  permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] as string[],
};

const ROOM_CODE_PATTERN = /[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}/;

export interface RunningPulsoServer {
  baseUrl: string;
  port: number;
  getOutput: () => string;
  stop: () => Promise<void>;
}

export interface RunningTorServer extends RunningPulsoServer {
  onionAddress: string;
}

export interface WsFrameAuditor {
  sentFrames: string[];
  receivedFrames: string[];
  assertEncryptedFramesClean: (plaintexts: string[], forbiddenNames: string[]) => void;
}

class ControlledTorController extends EventEmitter implements TorControllerLike {
  private readonly dataDir: string;
  private readonly onionAddress: string;

  constructor(dataDir: string, onionAddress: string) {
    super();
    this.dataDir = dataDir;
    this.onionAddress = onionAddress;
  }

  async start(): Promise<string> {
    mkdirSync(this.dataDir, { recursive: true });
    this.emit('status', {
      status: 'bootstrapping',
      bootstrapProgress: 35,
    } satisfies TorControllerState);
    this.emit('status', {
      status: 'ready',
      onionAddress: this.onionAddress,
      bootstrapProgress: 100,
    } satisfies TorControllerState);
    return this.onionAddress;
  }

  async stop(): Promise<void> {
    rmSync(this.dataDir, { recursive: true, force: true });
  }
}

async function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Failed to resolve free TCP port')));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHealthz(baseUrl: string, child: ChildProcess, getOutput: () => string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early (${child.exitCode}):\n${getOutput()}`);
    }
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
    } catch {
      // Wait for Fastify to bind
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/healthz:\n${getOutput()}`);
}

/**
 * Spawns the compiled production Fastify server (`dist/server/index.js`) on a free loopback port
 * while capturing all stdout and stderr output for zero-trace log assertions.
 */
export async function spawnProductionServer(
  envOverrides: Record<string, string> = {},
): Promise<RunningPulsoServer> {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const chunks: string[] = [];

  const child = spawn(process.execPath, [path.resolve(process.cwd(), 'dist/server/index.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    chunks.push(chunk.toString('utf8'));
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    chunks.push(chunk.toString('utf8'));
  });

  const getOutput = () => chunks.join('');

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 2000);
      child.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  };

  try {
    await waitForHealthz(baseUrl, child, getOutput);
  } catch (err) {
    await stop();
    throw err;
  }

  return { baseUrl, port, getOutput, stop };
}

/**
 * Starts the Tor-mode Fastify runtime via `startTorServer` serving the compiled `dist/` bundle
 * with a controlled mock `TorController` and captured operational logs.
 */
export async function startControlledTorServer(
  onionAddress = `http://${'b'.repeat(56)}.onion`,
): Promise<RunningTorServer> {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'pulso-e2e-tor-'));
  const dataDir = path.join(tempRoot, 'tor_data');
  const logs: string[] = [];

  const handle = await startTorServer({
    port: 0,
    dataDir,
    staticDir: path.resolve(process.cwd(), 'dist'),
    registerSignals: false,
    log: (line) => logs.push(line),
    errorLog: (line) => logs.push(line),
    createTorController: (opts) => new ControlledTorController(opts.dataDir ?? dataDir, onionAddress),
  });

  return {
    baseUrl: handle.localUrl,
    port: handle.port,
    onionAddress,
    getOutput: () => logs.join('\n'),
    stop: async () => {
      await handle.stop();
      rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

/**
 * Asserts zero persisted client-side storage or cookies in a browser context page.
 */
export async function assertZeroTrace(page: Page): Promise<void> {
  const storage = await page.evaluate(async () => {
    const databases =
      typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function'
        ? await indexedDB.databases()
        : [];
    return {
      localStorageLength: window.localStorage.length,
      sessionStorageLength: window.sessionStorage.length,
      indexedDbCount: databases.length,
      cookie: document.cookie,
    };
  });

  expect(storage.localStorageLength).toBe(0);
  expect(storage.sessionStorageLength).toBe(0);
  expect(storage.indexedDbCount).toBe(0);
  expect(storage.cookie).toBe('');
}

/**
 * Asserts captured server stdout/stderr contain zero IPs, User-Agents, query strings,
 * Room Codes, display names, or message plaintexts.
 */
export function assertServerLogsZeroTrace(
  output: string,
  options: { secrets?: string[]; allowLocalhostNotice?: boolean } = {},
): void {
  if (!options.allowLocalhostNotice) {
    expect(output).not.toContain('127.0.0.1');
  }
  expect(output.toLowerCase()).not.toContain('user-agent');
  expect(output).not.toContain('Mozilla/');
  expect(output).not.toContain('HeadlessChrome');
  expect(output).not.toContain('?room=');
  expect(output).not.toContain('mode=');
  expect(output).not.toContain('#k=');
  expect(output).not.toMatch(ROOM_CODE_PATTERN);

  for (const secret of options.secrets ?? []) {
    if (secret) {
      expect(output).not.toContain(secret);
    }
  }
}

/**
 * Captures every WebSocket frame sent/received by a page and audits encrypted_message envelopes
 * to prove zero plaintext or senderName leakage on the wire.
 */
export function attachWsFrameAuditor(page: Page): WsFrameAuditor {
  const sentFrames: string[] = [];
  const receivedFrames: string[] = [];

  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      if (typeof frame.payload === 'string') {
        sentFrames.push(frame.payload);
      }
    });
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string') {
        receivedFrames.push(frame.payload);
      }
    });
  });

  const assertEncryptedFramesClean = (plaintexts: string[], forbiddenNames: string[]) => {
    const encryptedFrames = [...sentFrames, ...receivedFrames].filter((raw) => {
      try {
        const parsed = JSON.parse(raw) as { type?: string };
        return parsed.type === 'encrypted_message';
      } catch {
        return false;
      }
    });

    expect(encryptedFrames.length).toBeGreaterThan(0);

    for (const raw of encryptedFrames) {
      const parsed = JSON.parse(raw) as { envelope?: Record<string, unknown> };
      expect(raw).not.toContain('"senderName"');
      expect(parsed.envelope).toBeDefined();
      expect('senderName' in (parsed.envelope ?? {})).toBe(false);
      expect(typeof parsed.envelope?.ciphertext).toBe('string');
      expect(typeof parsed.envelope?.iv).toBe('string');

      for (const plaintext of plaintexts) {
        expect(raw).not.toContain(plaintext);
      }
      for (const name of forbiddenNames) {
        expect(raw).not.toContain(name);
      }
    }
  };

  return { sentFrames, receivedFrames, assertEncryptedFramesClean };
}

export async function createIsolatedContext(
  browser: Browser,
  overrides: { viewport?: { width: number; height: number } } = {},
): Promise<BrowserContext> {
  return browser.newContext({
    ...CONTEXT_OPTIONS,
    ...overrides,
  });
}

export async function createRoomAndGetInviteUrl(
  hostPage: Page,
  baseUrl: string,
  options?: { displayName?: string; skipGoto?: boolean },
): Promise<{ inviteUrl: string; roomCode: string }> {
  if (!options?.skipGoto) {
    await hostPage.goto(baseUrl);
  }

  if (options?.displayName) {
    await hostPage.getByLabel('Seu nome (opcional)').fill(options.displayName);
  }

  await hostPage.getByRole('button', { name: 'Criar nova sala' }).click();
  await expect(hostPage.getByText('Sua sala foi criada!')).toBeVisible();

  const roomCode = (await hostPage.locator('header h1').textContent())?.trim() ?? '';
  expect(roomCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  await hostPage.getByRole('button', { name: 'Compartilhar' }).click();
  await expect(
    hostPage.locator('section').getByRole('button', { name: 'Link copiado!' }),
  ).toBeVisible();

  const inviteUrl = await hostPage.evaluate(() => navigator.clipboard.readText());
  expect(inviteUrl).toContain('?room=');
  expect(inviteUrl).toContain('#k=');
  return { inviteUrl, roomCode };
}

export async function joinRoomViaInviteUrl(
  context: BrowserContext,
  inviteUrl: string,
): Promise<Page> {
  const guestPage = await context.newPage();
  await guestPage.goto(inviteUrl);
  await expect(guestPage.locator('header').getByText('2 pessoas online')).toBeVisible();
  return guestPage;
}
