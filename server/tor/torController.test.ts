// @vitest-environment node
import { EventEmitter } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ControlPortClient,
  computeSafeCookieClientHash,
  computeSafeCookieServerHash,
  parseAddOnionReply,
  parseAuthChallengeReply,
  parseControlAsyncEvent,
  parseControlPortFile,
  type ControlAsyncEvent,
} from './controlProtocol';
import {
  BUILTIN_SNOWFLAKE_BRIDGES,
  DEFAULT_BRIDGE_STARTUP_TIMEOUT_MS,
  DEFAULT_STARTUP_TIMEOUT_MS,
  TOR_DATA_DIR_PREFIX,
  TorController,
  buildTorrcContent,
  ensureDarwinBinarySigned,
  purgeStaleTorDataDirs,
  resolveLyrebirdBinary,
  resolveTorBinary,
  sanitizeCustomBridgeLines,
  type TorProgressEvent,
  type TorStallEvent,
} from './torController';

function createExecutable(filePath: string): string {
  writeFileSync(filePath, '#!/bin/sh\nexit 0\n', 'utf8');
  chmodSync(filePath, 0o755);
  return filePath;
}

describe('resolveTorBinary', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-tor-bin-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('prefers PULSO_TOR_BIN over local .tor-bin and PATH', () => {
    const root = makeTempDir();
    const envBin = createExecutable(join(root, 'custom-tor'));

    const localBinDir = join(root, '.tor-bin');
    mkdirSync(localBinDir, { recursive: true });
    createExecutable(join(localBinDir, 'tor'));

    const pathDir = join(root, 'path-bin');
    mkdirSync(pathDir, { recursive: true });
    createExecutable(join(pathDir, 'tor'));

    const resolved = resolveTorBinary({
      cwd: root,
      platform: 'linux',
      env: { PULSO_TOR_BIN: envBin, PATH: pathDir },
    });

    expect(resolved).toBe(envBin);
  });

  it('falls back to local .tor-bin/tor (and .tor-bin/tor/tor) before PATH', () => {
    const root = makeTempDir();
    const localNestedDir = join(root, '.tor-bin', 'tor');
    mkdirSync(localNestedDir, { recursive: true });
    const nestedBin = createExecutable(join(localNestedDir, 'tor'));

    const pathDir = join(root, 'path-bin');
    mkdirSync(pathDir, { recursive: true });
    createExecutable(join(pathDir, 'tor'));

    const resolvedNested = resolveTorBinary({
      cwd: root,
      platform: 'darwin',
      env: { PATH: pathDir },
    });
    expect(resolvedNested).toBe(nestedBin);

    const directBin = createExecutable(join(root, '.tor-bin', 'tor-exec'));
    // .tor-bin/tor is a directory above, so test direct .tor-bin/tor on a fresh root
    rmSync(directBin, { force: true });
    const root2 = makeTempDir();
    mkdirSync(join(root2, '.tor-bin'), { recursive: true });
    const directTor = createExecutable(join(root2, '.tor-bin', 'tor'));
    const resolvedDirect = resolveTorBinary({
      cwd: root2,
      platform: 'darwin',
      env: { PATH: pathDir },
    });
    expect(resolvedDirect).toBe(directTor);
  });

  it('resolves tor.exe on win32 in .tor-bin and PATH', () => {
    const root = makeTempDir();
    mkdirSync(join(root, '.tor-bin'), { recursive: true });
    const winBin = join(root, '.tor-bin', 'tor.exe');
    writeFileSync(winBin, 'MZ', 'utf8');

    const resolved = resolveTorBinary({
      cwd: root,
      platform: 'win32',
      env: { PATH: '' },
    });
    expect(resolved).toBe(winBin);
  });

  it('falls back to PATH when PULSO_TOR_BIN and .tor-bin are absent', () => {
    const root = makeTempDir();
    const pathDir = join(root, 'bin');
    mkdirSync(pathDir, { recursive: true });
    const pathTor = createExecutable(join(pathDir, 'tor'));

    const resolved = resolveTorBinary({
      cwd: root,
      platform: 'linux',
      env: { PATH: `/nonexistent-dir:${pathDir}` },
    });
    expect(resolved).toBe(pathTor);
  });

  it('throws an actionable error mentioning PULSO_TOR_BIN, scripts/fetch-tor-bundle.mjs, and docs/tor-mode.md when missing or invalid', () => {
    const root = makeTempDir();

    expect(() =>
      resolveTorBinary({
        cwd: root,
        platform: 'linux',
        env: { PATH: '' },
      }),
    ).toThrow(/PULSO_TOR_BIN.*scripts\/fetch-tor-bundle\.mjs.*docs\/tor-mode\.md/s);

    expect(() =>
      resolveTorBinary({
        cwd: root,
        platform: 'linux',
        env: { PULSO_TOR_BIN: join(root, 'does-not-exist'), PATH: '' },
      }),
    ).toThrow(/PULSO_TOR_BIN/);
  });
});

describe('controlProtocol helpers', () => {
  it('parses ControlPortWriteToFile IPv4 and IPv6 endpoints and rejects malformed content', () => {
    expect(parseControlPortFile('PORT=127.0.0.1:43921\n')).toEqual({
      host: '127.0.0.1',
      port: 43921,
    });
    expect(parseControlPortFile('PORT=[::1]:9051\r\n')).toEqual({
      host: '::1',
      port: 9051,
    });
    expect(() => parseControlPortFile('INVALID')).toThrow(/ControlPort/i);
  });

  it('computes Tor Control Spec §3.24 SAFECOOKIE server and client HMAC-SHA256 digests', () => {
    const cookie = Buffer.alloc(32, 0xaa);
    const clientNonce = Buffer.alloc(32, 0x11);
    const serverNonce = Buffer.alloc(32, 0x22);

    expect(computeSafeCookieServerHash(cookie, clientNonce, serverNonce).toString('hex')).toBe(
      '957c6cb07d468a0bdbe5ca15118a95c3d162e6a828dbb70114cf03cceeecec4b',
    );
    expect(computeSafeCookieClientHash(cookie, clientNonce, serverNonce).toString('hex')).toBe(
      '4c1e757bd79276b6a940b8829227335c4f0564d3fe69e04ef4cca9d305841f9a',
    );
  });

  it('parses AUTHCHALLENGE, ADD_ONION ServiceID, and STATUS_CLIENT / HS_DESC events', () => {
    const serverHashHex = '957c6cb07d468a0bdbe5ca15118a95c3d162e6a828dbb70114cf03cceeecec4b';
    const serverNonceHex = '22'.repeat(32);
    const parsedChallenge = parseAuthChallengeReply([
      `AUTHCHALLENGE SERVERHASH=${serverHashHex} SERVERNONCE=${serverNonceHex}`,
    ]);
    expect(parsedChallenge.serverHash.toString('hex')).toBe(serverHashHex);
    expect(parsedChallenge.serverNonce.toString('hex')).toBe(serverNonceHex);

    const serviceId = 'pg6mmjiyjmcrsslvykfwnntlaru7p5svn6y2ymmju6nubxndf4pscryd';
    expect(parseAddOnionReply([`ServiceID=${serviceId.toUpperCase()}`, 'OK'])).toBe(serviceId);

    expect(
      parseControlAsyncEvent([
        'STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"',
      ]),
    ).toEqual({
      type: 'status_client',
      severity: 'NOTICE',
      action: 'BOOTSTRAP',
      progress: 100,
      tag: 'done',
      summary: 'Done',
    });

    expect(
      parseControlAsyncEvent([
        `HS_DESC UPLOADED ${serviceId} NO_AUTH $AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
      ]),
    ).toEqual({
      type: 'hs_desc',
      action: 'UPLOADED',
      serviceId,
    });
  });
});

function createDuplexPair(): [Duplex, Duplex] {
  const sideA = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      sideB.push(chunk);
      callback();
    },
    final(callback) {
      sideB.push(null);
      callback();
    },
  });
  const sideB = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      sideA.push(chunk);
      callback();
    },
    final(callback) {
      sideA.push(null);
      callback();
    },
  });
  return [sideA, sideB];
}

describe('ControlPortClient over Duplex transport', () => {
  it('completes SAFECOOKIE handshake, handles interleaved 650 events, ADD_ONION, DEL_ONION, and SIGNAL SHUTDOWN', async () => {
    const [clientStream, serverStream] = createDuplexPair();
    const cookie = Buffer.alloc(32, 0x3b);
    const fixedClientNonce = Buffer.alloc(32, 0x44);
    const serverNonce = Buffer.alloc(32, 0x55);
    const expectedServiceId = 'pg6mmjiyjmcrsslvykfwnntlaru7p5svn6y2ymmju6nubxndf4pscryd';
    const receivedCommands: string[] = [];

    let buffer = '';
    serverStream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\r\n')) {
        const idx = buffer.indexOf('\r\n');
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        receivedCommands.push(line);

        if (line.startsWith('AUTHCHALLENGE SAFECOOKIE ')) {
          const clientNonceHex = line.slice('AUTHCHALLENGE SAFECOOKIE '.length).trim();
          const clientNonce = Buffer.from(clientNonceHex, 'hex');
          const serverHash = computeSafeCookieServerHash(cookie, clientNonce, serverNonce);
          serverStream.write(
            `250 AUTHCHALLENGE SERVERHASH=${serverHash.toString('hex')} SERVERNONCE=${serverNonce.toString('hex')}\r\n`,
          );
        } else if (line.startsWith('AUTHENTICATE ')) {
          const authHex = line.slice('AUTHENTICATE '.length).trim();
          const expectedClientHash = computeSafeCookieClientHash(
            cookie,
            fixedClientNonce,
            serverNonce,
          ).toString('hex');
          if (authHex.toLowerCase() === expectedClientHash) {
            serverStream.write('250 OK\r\n');
          } else {
            serverStream.write('515 Authentication failed\r\n');
          }
        } else if (line === 'SETEVENTS STATUS_CLIENT HS_DESC') {
          serverStream.write('250 OK\r\n');
        } else if (line.startsWith('ADD_ONION ')) {
          // Interleave a 650 event between 250-ServiceID and 250 OK
          serverStream.write(`250-ServiceID=${expectedServiceId}\r\n`);
          serverStream.write(
            '650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"\r\n',
          );
          serverStream.write('250 OK\r\n');
          serverStream.write(`650 HS_DESC UPLOADED ${expectedServiceId} NO_AUTH $HSD1\r\n`);
        } else if (line.startsWith('DEL_ONION ')) {
          serverStream.write('250 OK\r\n');
        } else if (line === 'SIGNAL SHUTDOWN') {
          serverStream.write('250 closing connection\r\n');
        }
      }
    });

    const client = new ControlPortClient(clientStream);
    const events: ControlAsyncEvent[] = [];
    client.onEvent((evt) => events.push(evt));

    await client.authenticateSafeCookie(cookie, () => fixedClientNonce);
    await client.setEvents(['STATUS_CLIENT', 'HS_DESC']);
    const serviceId = await client.addOnion(4321);
    expect(serviceId).toBe(expectedServiceId);

    await client.delOnion(serviceId);
    await client.signalShutdown();
    client.close();

    expect(receivedCommands).toEqual([
      `AUTHCHALLENGE SAFECOOKIE ${fixedClientNonce.toString('hex')}`,
      `AUTHENTICATE ${computeSafeCookieClientHash(cookie, fixedClientNonce, serverNonce).toString('hex')}`,
      'SETEVENTS STATUS_CLIENT HS_DESC',
      'ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,127.0.0.1:4321',
      `DEL_ONION ${expectedServiceId}`,
      'SIGNAL SHUTDOWN',
    ]);
    expect(events).toEqual([
      {
        type: 'status_client',
        severity: 'NOTICE',
        action: 'BOOTSTRAP',
        progress: 100,
        tag: 'done',
        summary: 'Done',
      },
      {
        type: 'hs_desc',
        action: 'UPLOADED',
        serviceId: expectedServiceId,
      },
    ]);
  });

  it('rejects SAFECOOKIE handshake when SERVERHASH does not match', async () => {
    const [clientStream, serverStream] = createDuplexPair();
    const cookie = Buffer.alloc(32, 0x3b);
    const tamperedHash = 'ff'.repeat(32);
    const serverNonce = '55'.repeat(32);

    serverStream.on('data', () => {
      serverStream.write(
        `250 AUTHCHALLENGE SERVERHASH=${tamperedHash} SERVERNONCE=${serverNonce}\r\n`,
      );
    });

    const client = new ControlPortClient(clientStream);
    await expect(client.authenticateSafeCookie(cookie)).rejects.toThrow(/SERVERHASH/i);
    client.close();
  });
});

function createDummyTorExecutable(scriptPath: string, portToWrite: number, cookie: Buffer): string {
  const cookieHex = cookie.toString('hex');
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const fIdx = args.indexOf('-f');
if (fIdx === -1 || !args[fIdx + 1]) process.exit(2);
const torrc = fs.readFileSync(args[fIdx + 1], 'utf8');
const portFileMatch = /^ControlPortWriteToFile\\s+(.+)$/m.exec(torrc);
const cookieFileMatch = /^CookieAuthFile\\s+(.+)$/m.exec(torrc);
if (!portFileMatch || !cookieFileMatch) process.exit(3);
fs.writeFileSync(cookieFileMatch[1].trim(), Buffer.from('${cookieHex}', 'hex'));
fs.writeFileSync(portFileMatch[1].trim(), 'PORT=127.0.0.1:${portToWrite}\\n');
setInterval(() => {}, 1000);
process.on('SIGTERM', () => process.exit(0));
`;
  writeFileSync(scriptPath, script, 'utf8');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe('TorController lifecycle (Duplex + real temp tor_data + dummy tor executable)', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-tor-ctrl-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('purges stale tor_data, generates isolated torrc, waits for BOOTSTRAP=100 AND HS_DESC UPLOADED before ready, and purges tor_data on stop', async () => {
    const root = makeTempDir();
    const dataDir = join(root, 'tor_data');
    mkdirSync(dataDir, { recursive: true });
    const staleFile = join(dataDir, 'stale.txt');
    writeFileSync(staleFile, 'residual data', 'utf8');

    const cookie = Buffer.alloc(32, 0x7c);
    const serverNonce = Buffer.alloc(32, 0x91);
    const serviceId = 'vww6ybal4bd7szmgncyruucpgfkqahzddi37ktceo3ah7ngmcopnpyyd';
    const fakePort = 49876;
    const torBin = createDummyTorExecutable(join(root, 'dummy-tor'), fakePort, cookie);

    const [clientStream, serverStream] = createDuplexPair();
    const commands: string[] = [];
    let observedTorrc = '';
    let connectedPort = 0;

    let readBuf = '';
    serverStream.on('data', (chunk: Buffer) => {
      readBuf += chunk.toString('utf8');
      while (readBuf.includes('\r\n')) {
        const idx = readBuf.indexOf('\r\n');
        const line = readBuf.slice(0, idx);
        readBuf = readBuf.slice(idx + 2);
        commands.push(line);

        if (line.startsWith('AUTHCHALLENGE SAFECOOKIE ')) {
          const clientNonce = Buffer.from(line.slice('AUTHCHALLENGE SAFECOOKIE '.length).trim(), 'hex');
          const serverHash = computeSafeCookieServerHash(cookie, clientNonce, serverNonce);
          serverStream.write(
            `250 AUTHCHALLENGE SERVERHASH=${serverHash.toString('hex')} SERVERNONCE=${serverNonce.toString('hex')}\r\n`,
          );
        } else if (line.startsWith('AUTHENTICATE ')) {
          serverStream.write('250 OK\r\n');
        } else if (line === 'SETEVENTS STATUS_CLIENT HS_DESC') {
          serverStream.write('250 OK\r\n');
        } else if (line.startsWith('ADD_ONION ')) {
          serverStream.write(`250-ServiceID=${serviceId}\r\n`);
          serverStream.write('250 OK\r\n');
          // Emit BOOTSTRAP=100 first, verify controller does NOT resolve yet until HS_DESC UPLOADED
          setTimeout(() => {
            serverStream.write(
              '650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"\r\n',
            );
          }, 25);
        } else if (line.startsWith('DEL_ONION ')) {
          serverStream.write('250 OK\r\n');
        } else if (line === 'SIGNAL SHUTDOWN') {
          serverStream.write('250 closing connection\r\n');
        }
      }
    });

    const controller = new TorController({
      localPort: 3001,
      dataDir,
      torBinaryPath: torBin,
      startupTimeoutMs: 5000,
      controlFilePollIntervalMs: 10,
      stopTimeoutMs: 500,
      connectFn: ({ host, port }) => {
        expect(host).toBe('127.0.0.1');
        connectedPort = port;
        observedTorrc = readFileSync(join(dataDir, 'torrc'), 'utf8');
        return clientStream;
      },
    });

    const readyEvents: string[] = [];
    controller.on('ready', (addr: string) => readyEvents.push(addr));

    let settled = false;
    const startPromise = controller.start().then((addr) => {
      settled = true;
      return addr;
    });

    // Wait until ADD_ONION + BOOTSTRAP=100 were processed; stale.txt should be gone, torrc written,
    // and start() must NOT resolve yet until HS_DESC UPLOADED arrives.
    await vi.waitFor(() => {
      expect(connectedPort).toBe(fakePort);
      expect(commands).toContain('ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,127.0.0.1:3001');
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(staleFile)).toBe(false);
    expect(observedTorrc).toContain('SocksPort 0');
    expect(observedTorrc).toContain('ControlPort auto');
    expect(observedTorrc).toContain('ControlPortWriteToFile ');
    expect(observedTorrc).toContain('CookieAuthentication 1');
    expect(observedTorrc).toContain('CookieAuthFile ');
    expect(observedTorrc).toContain('AvoidDiskWrites 1');
    expect(observedTorrc).toContain(`DataDirectory ${dataDir}`);
    expect(controller.status).toBe('bootstrapping');
    expect(settled).toBe(false);
    expect(readyEvents).toEqual([]);

    // Now emit HS_DESC UPLOADED for the provisioned serviceId -> becomes ready!
    serverStream.write(`650 HS_DESC UPLOADED ${serviceId} NO_AUTH $HSD1\r\n`);

    const onionAddress = await startPromise;
    expect(onionAddress).toBe(`http://${serviceId}.onion`);
    expect(controller.status).toBe('ready');
    expect(controller.onionAddress).toBe(`http://${serviceId}.onion`);
    expect(readyEvents).toEqual([`http://${serviceId}.onion`]);
    expect(commands).toContain('ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,127.0.0.1:3001');

    // Stop and verify DEL_ONION + SIGNAL SHUTDOWN + physical removal of tor_data + idempotency
    await controller.stop();
    await controller.stop();

    expect(commands).toContain(`DEL_ONION ${serviceId}`);
    expect(commands).toContain('SIGNAL SHUTDOWN');
    expect(existsSync(dataDir)).toBe(false);
  });

  it('does not become ready when only HS_DESC UPLOADED arrives without BOOTSTRAP PROGRESS=100', async () => {
    const root = makeTempDir();
    const dataDir = join(root, 'tor_data');
    const cookie = Buffer.alloc(32, 0x1a);
    const serverNonce = Buffer.alloc(32, 0x2b);
    const serviceId = 'vww6ybal4bd7szmgncyruucpgfkqahzddi37ktceo3ah7ngmcopnpyyd';
    const torBin = createDummyTorExecutable(join(root, 'dummy-tor'), 49877, cookie);
    const [clientStream, serverStream] = createDuplexPair();

    let readBuf = '';
    serverStream.on('data', (chunk: Buffer) => {
      readBuf += chunk.toString('utf8');
      while (readBuf.includes('\r\n')) {
        const idx = readBuf.indexOf('\r\n');
        const line = readBuf.slice(0, idx);
        readBuf = readBuf.slice(idx + 2);
        if (line.startsWith('AUTHCHALLENGE SAFECOOKIE ')) {
          const clientNonce = Buffer.from(line.slice('AUTHCHALLENGE SAFECOOKIE '.length).trim(), 'hex');
          const serverHash = computeSafeCookieServerHash(cookie, clientNonce, serverNonce);
          serverStream.write(
            `250 AUTHCHALLENGE SERVERHASH=${serverHash.toString('hex')} SERVERNONCE=${serverNonce.toString('hex')}\r\n`,
          );
        } else if (line.startsWith('AUTHENTICATE ') || line.startsWith('SETEVENTS ') || line.startsWith('DEL_ONION ')) {
          serverStream.write('250 OK\r\n');
        } else if (line.startsWith('ADD_ONION ')) {
          serverStream.write(`250-ServiceID=${serviceId}\r\n250 OK\r\n`);
          serverStream.write(`650 HS_DESC UPLOADED ${serviceId}\r\n`);
        } else if (line === 'SIGNAL SHUTDOWN') {
          serverStream.write('250 closing\r\n');
        }
      }
    });

    const controller = new TorController({
      localPort: 3001,
      dataDir,
      torBinaryPath: torBin,
      startupTimeoutMs: 5000,
      controlFilePollIntervalMs: 10,
      stopTimeoutMs: 300,
      connectFn: () => clientStream,
    });

    let settled = false;
    const startPromise = controller.start().then((addr) => {
      settled = true;
      return addr;
    });

    await vi.waitFor(() => {
      expect(controller.serviceId).toBe(serviceId);
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(settled).toBe(false);
    expect(controller.status).toBe('bootstrapping');

    serverStream.write('650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"\r\n');
    expect(await startPromise).toBe(`http://${serviceId}.onion`);
    await controller.stop();
  });

  it('kills child process and purges tor_data on startup failure (auth error or premature exit)', async () => {
    const root = makeTempDir();
    const dataDir = join(root, 'tor_data');
    const cookie = Buffer.alloc(32, 0x7c);
    const torBin = createDummyTorExecutable(join(root, 'dummy-tor'), 49878, cookie);
    const [clientStream, serverStream] = createDuplexPair();

    serverStream.on('data', () => {
      serverStream.write('515 Bad authentication\r\n');
    });

    const controller = new TorController({
      localPort: 3001,
      dataDir,
      torBinaryPath: torBin,
      startupTimeoutMs: 3000,
      controlFilePollIntervalMs: 10,
      stopTimeoutMs: 300,
      connectFn: () => clientStream,
    });

    await expect(controller.start()).rejects.toThrow();
    expect(controller.status).toBe('error');
    expect(existsSync(dataDir)).toBe(false);

    // Also test premature process exit cleanup
    const failingBin = join(root, 'exit-tor');
    writeFileSync(failingBin, '#!/bin/sh\necho "boom" >&2\nexit 1\n', 'utf8');
    chmodSync(failingBin, 0o755);

    const controller2 = new TorController({
      localPort: 3001,
      dataDir,
      torBinaryPath: failingBin,
      startupTimeoutMs: 3000,
      controlFilePollIntervalMs: 10,
      stopTimeoutMs: 300,
    });

    await expect(controller2.start()).rejects.toThrow(/exited prematurely/i);
    expect(controller2.status).toBe('error');
    expect(existsSync(dataDir)).toBe(false);

    // Test actionable diagnostic when killed with SIGKILL on darwin
    const sigkillBin = join(root, 'sigkill-tor');
    writeFileSync(sigkillBin, '#!/bin/sh\nkill -9 $$\n', 'utf8');
    chmodSync(sigkillBin, 0o755);

    const controller3 = new TorController({
      localPort: 3001,
      dataDir,
      torBinaryPath: sigkillBin,
      platform: 'darwin',
      startupTimeoutMs: 3000,
      controlFilePollIntervalMs: 10,
      stopTimeoutMs: 300,
      execFileSyncFn: vi.fn(),
    });

    await expect(controller3.start()).rejects.toThrow(/macOS killed Tor with SIGKILL/i);
  });

  it('uses a unique 0o700 directory under os.tmpdir() when dataDir is omitted, leaves cwd untouched, and purges on stop/failure', async () => {
    const fakeCwd = makeTempDir();
    const controllerA = new TorController({
      localPort: 3001,
      cwd: fakeCwd,
      torBinaryPath: '/nonexistent/tor',
    });
    const controllerB = new TorController({
      localPort: 3002,
      cwd: fakeCwd,
      torBinaryPath: '/nonexistent/tor',
    });

    const dirA = controllerA.dataDir;
    const dirB = controllerB.dataDir;
    tempDirs.push(dirA, dirB);

    expect(dirname(dirA)).toBe(resolve(tmpdir()));
    expect(dirname(dirB)).toBe(resolve(tmpdir()));
    expect(basename(dirA).startsWith(TOR_DATA_DIR_PREFIX)).toBe(true);
    expect(basename(dirB).startsWith(TOR_DATA_DIR_PREFIX)).toBe(true);
    expect(dirA).not.toBe(dirB);
    expect(existsSync(dirA)).toBe(true);
    expect(existsSync(join(fakeCwd, 'tor_data'))).toBe(false);

    if (process.platform !== 'win32') {
      expect(statSync(dirA).mode & 0o777).toBe(0o700);
    }

    // Failure during start() purges ephemeral tmpdir dataDir
    await expect(controllerA.start()).rejects.toThrow();
    expect(existsSync(dirA)).toBe(false);
    expect(existsSync(join(fakeCwd, 'tor_data'))).toBe(false);

    // stop() also purges ephemeral tmpdir dataDir
    await controllerB.stop();
    expect(existsSync(dirB)).toBe(false);
  });
});

describe('purgeStaleTorDataDirs', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-purge-test-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('removes only stale pulso-tor-* directories while respecting excludePaths, minAgeMs, non-matching entries, and symlinks', async () => {
    const baseDir = makeTempDir();
    const nowMs = 1_700_000_000_000;
    const staleDate = new Date(nowMs - 2 * 60 * 60 * 1000);
    const freshDate = new Date(nowMs - 1_000);

    const staleDir = join(baseDir, 'pulso-tor-stale1');
    const excludedStaleDir = join(baseDir, 'pulso-tor-excluded');
    const freshDir = join(baseDir, 'pulso-tor-fresh1');
    const unrelatedDir = join(baseDir, 'other-temp-dir');
    const regularFile = join(baseDir, 'pulso-tor-notadir');
    const targetDir = join(baseDir, 'real-target');
    const symlinkDir = join(baseDir, 'pulso-tor-symlink');

    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, 'torrc'), 'old', 'utf8');
    mkdirSync(excludedStaleDir, { recursive: true });
    mkdirSync(freshDir, { recursive: true });
    mkdirSync(unrelatedDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(regularFile, 'file', 'utf8');
    symlinkSync(targetDir, symlinkDir);

    utimesSync(staleDir, staleDate, staleDate);
    utimesSync(excludedStaleDir, staleDate, staleDate);
    utimesSync(freshDir, freshDate, freshDate);
    utimesSync(unrelatedDir, staleDate, staleDate);
    utimesSync(regularFile, staleDate, staleDate);

    const removed = await purgeStaleTorDataDirs({
      baseDir,
      excludePaths: [excludedStaleDir],
      minAgeMs: 60 * 60 * 1000,
      nowMs,
    });

    expect(removed).toEqual([staleDir]);
    expect(existsSync(staleDir)).toBe(false);
    expect(existsSync(excludedStaleDir)).toBe(true);
    expect(existsSync(freshDir)).toBe(true);
    expect(existsSync(unrelatedDir)).toBe(true);
    expect(existsSync(regularFile)).toBe(true);
    expect(existsSync(symlinkDir)).toBe(true);
    expect(existsSync(targetDir)).toBe(true);
  });
});

describe('ensureDarwinBinarySigned', () => {
  it('does nothing on non-darwin platforms', () => {
    const mockExec = vi.fn();
    ensureDarwinBinarySigned('/dummy/tor', 'linux', mockExec as any);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('verifies signature on darwin and skips ad-hoc signing if already valid', () => {
    const mockExec = vi.fn();
    ensureDarwinBinarySigned('/dummy/tor', 'darwin', mockExec as any);
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledWith('codesign', ['-v', '/dummy/tor'], { stdio: 'ignore' });
  });

  it('attempts ad-hoc signing when verification throws on darwin', () => {
    const mockExec = vi.fn().mockImplementation((cmd, args) => {
      if (args[0] === '-v') {
        throw new Error('code object is not signed at all');
      }
    });
    ensureDarwinBinarySigned('/dummy/tor', 'darwin', mockExec as any);
    expect(mockExec).toHaveBeenCalledWith('codesign', ['-s', '-', '--force', '/dummy/tor'], {
      stdio: 'ignore',
    });
  });

  it('dynamically signs any sibling .dylib files regardless of version alongside tor binary on darwin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-codesign-'));
    try {
      const torPath = createExecutable(join(dir, 'tor'));
      const dylibPath = join(dir, 'libevent-2.2.0.dylib');
      writeFileSync(dylibPath, 'dylib', 'utf8');
      writeFileSync(join(dir, 'README.txt'), 'ignore', 'utf8');

      const mockExec = vi.fn().mockImplementation((_cmd, args) => {
        if (args[0] === '-v') {
          throw new Error('code object is not signed at all');
        }
      });

      ensureDarwinBinarySigned(torPath, 'darwin', mockExec as any);

      expect(mockExec).toHaveBeenCalledWith('codesign', ['-s', '-', '--force', dylibPath], {
        stdio: 'ignore',
      });
      expect(mockExec).toHaveBeenCalledWith('codesign', ['-s', '-', '--force', torPath], {
        stdio: 'ignore',
      });
      expect(mockExec).not.toHaveBeenCalledWith(
        'codesign',
        ['-s', '-', '--force', join(dir, 'README.txt')],
        expect.anything(),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TorController real loopback TCP integration', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-tor-tcp-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('connects over real loopback TCP ControlPort, authenticates SAFECOOKIE, provisions v3 onion, and purges tor_data on stop', async () => {
    const root = makeTempDir();
    const dataDir = join(root, 'tor_data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'stale.txt'), 'old', 'utf8');

    const cookie = Buffer.alloc(32, 0x5d);
    const serverNonce = Buffer.alloc(32, 0x6e);
    const serviceId = 'pg6mmjiyjmcrsslvykfwnntlaru7p5svn6y2ymmju6nubxndf4pscryd';
    const commands: string[] = [];

    const tcpServer = net.createServer((socket) => {
      let buf = '';
      let lastClientNonce = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        while (buf.includes('\r\n')) {
          const idx = buf.indexOf('\r\n');
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          commands.push(line);

          if (line.startsWith('AUTHCHALLENGE SAFECOOKIE ')) {
            lastClientNonce = Buffer.from(line.slice('AUTHCHALLENGE SAFECOOKIE '.length).trim(), 'hex');
            const serverHash = computeSafeCookieServerHash(cookie, lastClientNonce, serverNonce);
            socket.write(
              `250 AUTHCHALLENGE SERVERHASH=${serverHash.toString('hex')} SERVERNONCE=${serverNonce.toString('hex')}\r\n`,
            );
          } else if (line.startsWith('AUTHENTICATE ')) {
            const authHex = line.slice('AUTHENTICATE '.length).trim().toLowerCase();
            const expected = computeSafeCookieClientHash(cookie, lastClientNonce, serverNonce).toString('hex');
            socket.write(authHex === expected ? '250 OK\r\n' : '515 Authentication failed\r\n');
          } else if (line === 'SETEVENTS STATUS_CLIENT HS_DESC') {
            socket.write('250 OK\r\n');
          } else if (line.startsWith('ADD_ONION ')) {
            socket.write(`250-ServiceID=${serviceId}\r\n250 OK\r\n`);
            socket.write('650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"\r\n');
            socket.write(`650 HS_DESC UPLOADED ${serviceId} NO_AUTH $HSD1\r\n`);
          } else if (line.startsWith('DEL_ONION ')) {
            socket.write('250 OK\r\n');
          } else if (line === 'SIGNAL SHUTDOWN') {
            socket.write('250 closing connection\r\n');
            socket.end();
          }
        }
      });
    });

    await new Promise<void>((resolve) => {
      tcpServer.listen(0, '127.0.0.1', () => resolve());
    });

    const address = tcpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    const torBin = createDummyTorExecutable(join(root, 'dummy-tor'), address.port, cookie);
    const controller = new TorController({
      localPort: 3001,
      dataDir,
      torBinaryPath: torBin,
      startupTimeoutMs: 5000,
      controlFilePollIntervalMs: 10,
      stopTimeoutMs: 500,
    });

    try {
      const onionAddress = await controller.start();
      expect(onionAddress).toBe(`http://${serviceId}.onion`);
      expect(controller.status).toBe('ready');
      expect(commands).toContain('ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,127.0.0.1:3001');

      await controller.stop();
      expect(commands).toContain(`DEL_ONION ${serviceId}`);
      expect(commands).toContain('SIGNAL SHUTDOWN');
      expect(existsSync(dataDir)).toBe(false);
    } finally {
      await controller.stop().catch(() => {});
      await new Promise<void>((resolve) => tcpServer.close(() => resolve()));
    }
  });
});

describe('resolveLyrebirdBinary', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-lyrebird-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('resolves pluggable_transports/lyrebird directly relative to tor without pt_config.json and ignores conjure-client', () => {
    const root = makeTempDir();
    const torDir = join(root, 'tor');
    const ptDir = join(torDir, 'pluggable_transports');
    mkdirSync(ptDir, { recursive: true });

    const torBin = createExecutable(join(torDir, 'tor'));
    const lyrebirdBin = createExecutable(join(ptDir, 'lyrebird'));
    createExecutable(join(ptDir, 'conjure-client'));

    expect(resolveLyrebirdBinary(torBin, 'linux', {})).toBe(lyrebirdBin);
  });

  it('resolves pluggable_transports/lyrebird.exe on win32 and supports PULSO_LYREBIRD_BIN override', () => {
    const root = makeTempDir();
    const torDir = join(root, 'tor');
    const ptDir = join(torDir, 'pluggable_transports');
    mkdirSync(ptDir, { recursive: true });

    const torExe = join(torDir, 'tor.exe');
    const lyrebirdExe = join(ptDir, 'lyrebird.exe');
    writeFileSync(torExe, 'MZ', 'utf8');
    writeFileSync(lyrebirdExe, 'MZ', 'utf8');

    expect(resolveLyrebirdBinary(torExe, 'win32', {})).toBe(lyrebirdExe);

    const customBin = createExecutable(join(root, 'custom-lyrebird'));
    expect(resolveLyrebirdBinary(torExe, 'linux', { PULSO_LYREBIRD_BIN: customBin })).toBe(
      customBin,
    );
  });

  it('throws an actionable error when lyrebird is missing even if pt_config.json and conjure-client exist', () => {
    const root = makeTempDir();
    const torDir = join(root, 'tor');
    const ptDir = join(torDir, 'pluggable_transports');
    mkdirSync(ptDir, { recursive: true });

    const torBin = createExecutable(join(torDir, 'tor'));
    createExecutable(join(ptDir, 'conjure-client'));
    writeFileSync(join(ptDir, 'pt_config.json'), '{}', 'utf8');

    expect(() => resolveLyrebirdBinary(torBin, 'linux', {})).toThrow(
      /not found or non-executable.*PULSO_LYREBIRD_BIN/i,
    );
  });
});

describe('sanitizeCustomBridgeLines and bridge torrc generation', () => {
  it('accepts obfs4, snowflake, webtunnel, and meek_lite lines with or without Bridge prefix', () => {
    const rawInput = [
      '',
      '# comment from email',
      'Bridge obfs4 198.51.100.10:443 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA cert=abc+123== iat-mode=0',
      'webtunnel [2001:db8::1]:443 BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB url=https://example.invalid/wt ver=0.0.1',
      'snowflake 192.0.2.3:80 CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC fingerprint=CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      'meek_lite 192.0.2.20:80 url=https://example.invalid front=example.org',
    ].join('\n');

    expect(sanitizeCustomBridgeLines(rawInput)).toEqual([
      'obfs4 198.51.100.10:443 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA cert=abc+123== iat-mode=0',
      'webtunnel [2001:db8::1]:443 BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB url=https://example.invalid/wt ver=0.0.1',
      'snowflake 192.0.2.3:80 CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC fingerprint=CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      'meek_lite 192.0.2.20:80 url=https://example.invalid front=example.org',
    ]);
  });

  it('rejects unsupported transports, torrc directive injections, newlines in array items, and redacts bridge IPs in errors', () => {
    const secretIp = '203.0.113.77:443';
    const validFingerprint = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    let thrownMessage = '';
    try {
      sanitizeCustomBridgeLines(`conjure ${secretIp} ${validFingerprint}`);
    } catch (err) {
      thrownMessage = (err as Error).message;
    }
    expect(thrownMessage).toMatch(/unsupported bridge transport/i);
    expect(thrownMessage).not.toContain('203.0.113.77');

    expect(() =>
      sanitizeCustomBridgeLines([`obfs4 ${secretIp} ${validFingerprint}\nSocksPort 9050`]),
    ).toThrow();

    expect(() =>
      sanitizeCustomBridgeLines(`obfs4 ${secretIp} ${validFingerprint}\nSocksPort 9050`),
    ).toThrow(/unsupported bridge transport/i);

    expect(() =>
      sanitizeCustomBridgeLines(`obfs4 ${secretIp} ${validFingerprint} cert=abc\\`),
    ).toThrow();

    expect(() =>
      sanitizeCustomBridgeLines(`obfs4 ${secretIp} ${validFingerprint} ; ControlPort 9051`),
    ).toThrow();

    expect(() =>
      sanitizeCustomBridgeLines(`obfs4 ${secretIp} ${validFingerprint}\x00`),
    ).toThrow();

    expect(() => sanitizeCustomBridgeLines('   \n# only comments\n')).toThrow(
      /at least one/i,
    );
  });

  it('writes UseBridges 1, ClientTransportPlugin without logging flags, and escaped lyrebird path in torrc', () => {
    const torrc = buildTorrcContent({
      dataDir: '/tmp/pulso-tor-123',
      controlPortFile: '/tmp/pulso-tor-123/control.port',
      cookieFile: '/tmp/pulso-tor-123/control_auth_cookie',
      lyrebirdBinaryPath: 'C:\\Program Files\\PULSO\\tor\\pluggable_transports\\lyrebird.exe',
      bridgeLines: BUILTIN_SNOWFLAKE_BRIDGES,
    });

    expect(torrc).toContain('UseBridges 1');
    expect(torrc).toContain(
      'ClientTransportPlugin meek_lite,obfs4,snowflake,webtunnel exec "C:\\\\Program Files\\\\PULSO\\\\tor\\\\pluggable_transports\\\\lyrebird.exe"',
    );
    expect(torrc).not.toContain('-enableLogging');
    expect(torrc).not.toContain('-unsafeLogging');
    for (const line of BUILTIN_SNOWFLAKE_BRIDGES) {
      expect(torrc).toContain(`Bridge ${line}`);
    }
  });
});

function createMockSpawnWithTorrcCapture(
  cookie: Buffer,
  portToWrite: number,
  options: {
    onSpawn?: (torrcContent: string, torrcMode: number, dataDir: string) => void;
    createPtState?: boolean;
  } = {},
) {
  return vi.fn((_cmd: string, args: string[]) => {
    const fIdx = args.indexOf('-f');
    const torrcPath = fIdx !== -1 ? args[fIdx + 1] : '';
    const torrcContent = readFileSync(torrcPath, 'utf8');
    const torrcMode = statSync(torrcPath).mode & 0o777;
    const dataDir = dirname(torrcPath);

    options.onSpawn?.(torrcContent, torrcMode, dataDir);

    if (options.createPtState) {
      const ptStateDir = join(dataDir, 'pt_state');
      mkdirSync(ptStateDir, { recursive: true });
      writeFileSync(join(ptStateDir, 'state.tmp'), 'ephemeral', 'utf8');
    }

    const portFileMatch = /^ControlPortWriteToFile\s+(.+)$/m.exec(torrcContent);
    const cookieFileMatch = /^CookieAuthFile\s+(.+)$/m.exec(torrcContent);
    if (cookieFileMatch && portFileMatch) {
      writeFileSync(cookieFileMatch[1].trim(), cookie);
      writeFileSync(portFileMatch[1].trim(), `PORT=127.0.0.1:${portToWrite}\n`, 'utf8');
    }

    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdout: EventEmitter;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      kill: (sig?: NodeJS.Signals) => boolean;
    };
    child.stderr = new EventEmitter();
    child.stdout = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn((sig: NodeJS.Signals = 'SIGTERM') => {
      child.signalCode = sig;
      child.emit('exit', null, sig);
      return true;
    });
    return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
  });
}

describe('TorController bridge modes, progress phases, stall detection, and zero-trace purge', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-tor-bridge-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    vi.useRealTimers();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('writes 0o600 torrc with Snowflake bridges BEFORE spawn, signs lyrebird on darwin, never sends SETCONF, emits PT/HS_DESC progress, and purges torrc + pt_state on stop', async () => {
    const root = makeTempDir();
    const torDir = join(root, 'tor');
    const ptDir = join(torDir, 'pluggable_transports');
    mkdirSync(ptDir, { recursive: true });
    const torBin = createExecutable(join(torDir, 'tor'));
    const lyrebirdBin = createExecutable(join(ptDir, 'lyrebird'));
    const dataDir = join(root, 'tmp-tor-data');

    const cookie = Buffer.alloc(32, 0x42);
    const serverNonce = Buffer.alloc(32, 0x24);
    const serviceId = 'vww6ybal4bd7szmgncyruucpgfkqahzddi37ktceo3ah7ngmcopnpyyd';
    const [clientStream, serverStream] = createDuplexPair();
    const commands: string[] = [];

    let buf = '';
    serverStream.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      while (buf.includes('\r\n')) {
        const idx = buf.indexOf('\r\n');
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        commands.push(line);

        if (line.startsWith('AUTHCHALLENGE SAFECOOKIE ')) {
          const clientNonce = Buffer.from(line.slice('AUTHCHALLENGE SAFECOOKIE '.length).trim(), 'hex');
          const serverHash = computeSafeCookieServerHash(cookie, clientNonce, serverNonce);
          serverStream.write(
            `250 AUTHCHALLENGE SERVERHASH=${serverHash.toString('hex')} SERVERNONCE=${serverNonce.toString('hex')}\r\n`,
          );
        } else if (line.startsWith('AUTHENTICATE ') || line.startsWith('SETEVENTS ') || line.startsWith('DEL_ONION ')) {
          serverStream.write('250 OK\r\n');
        } else if (line.startsWith('ADD_ONION ')) {
          serverStream.write(`250-ServiceID=${serviceId}\r\n250 OK\r\n`);
          serverStream.write(
            '650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=5 TAG=conn_pt SUMMARY="Connecting to pluggable transport"\r\n',
          );
          serverStream.write(
            '650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=10 TAG=handshake_pt SUMMARY="Handshaking with pluggable transport"\r\n',
          );
          serverStream.write(
            '650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"\r\n',
          );
          serverStream.write(`650 HS_DESC UPLOAD ${serviceId} NO_AUTH $HSD1\r\n`);
          serverStream.write(`650 HS_DESC UPLOADED ${serviceId} NO_AUTH $HSD1\r\n`);
        } else if (line === 'SIGNAL SHUTDOWN') {
          serverStream.write('250 closing\r\n');
        }
      }
    });

    let torrcBeforeSpawn = '';
    let torrcModeBeforeSpawn = 0;
    const spawnFn = createMockSpawnWithTorrcCapture(cookie, 49901, {
      createPtState: true,
      onSpawn: (torrc, mode) => {
        torrcBeforeSpawn = torrc;
        torrcModeBeforeSpawn = mode;
      },
    });
    const execFileSyncFn = vi.fn();

    const controller = new TorController({
      localPort: 3001,
      dataDir,
      torBinaryPath: torBin,
      bridgeMode: 'snowflake',
      platform: 'darwin',
      startupTimeoutMs: 5000,
      controlFilePollIntervalMs: 10,
      stopTimeoutMs: 200,
      spawnFn,
      connectFn: () => clientStream,
      execFileSyncFn: execFileSyncFn as unknown as typeof import('node:child_process').execFileSync,
    });

    const progressEvents: TorProgressEvent[] = [];
    controller.on('progress', (evt: TorProgressEvent) => progressEvents.push(evt));

    const onion = await controller.start();
    expect(onion).toBe(`http://${serviceId}.onion`);

    if (process.platform !== 'win32') {
      expect(torrcModeBeforeSpawn).toBe(0o600);
    }
    expect(torrcBeforeSpawn).toContain('UseBridges 1');
    expect(torrcBeforeSpawn).toContain(
      `ClientTransportPlugin meek_lite,obfs4,snowflake,webtunnel exec ${lyrebirdBin}`,
    );
    expect(torrcBeforeSpawn).not.toContain('-enableLogging');
    expect(torrcBeforeSpawn).not.toContain('-unsafeLogging');
    expect(torrcBeforeSpawn).toContain(`Bridge ${BUILTIN_SNOWFLAKE_BRIDGES[0]}`);
    expect(commands.some((cmd) => cmd.startsWith('SETCONF'))).toBe(false);

    expect(execFileSyncFn).toHaveBeenCalledWith('codesign', ['-v', torBin], { stdio: 'ignore' });
    expect(execFileSyncFn).toHaveBeenCalledWith('codesign', ['-v', lyrebirdBin], { stdio: 'ignore' });

    expect(progressEvents).toEqual([
      {
        phase: 'conn_pt',
        progress: 5,
        bridgeMode: 'snowflake',
        tag: 'conn_pt',
        summary: 'Connecting to pluggable transport',
      },
      {
        phase: 'handshake_pt',
        progress: 10,
        bridgeMode: 'snowflake',
        tag: 'handshake_pt',
        summary: 'Handshaking with pluggable transport',
      },
      {
        phase: 'bootstrap',
        progress: 100,
        bridgeMode: 'snowflake',
        tag: 'done',
        summary: 'Done',
      },
      {
        phase: 'hs_desc',
        progress: 100,
        bridgeMode: 'snowflake',
        hsDescAction: 'UPLOAD',
      },
      {
        phase: 'hs_desc',
        progress: 100,
        bridgeMode: 'snowflake',
        hsDescAction: 'UPLOADED',
      },
    ]);

    expect(existsSync(join(dataDir, 'pt_state'))).toBe(true);
    await controller.stop();
    expect(existsSync(join(dataDir, 'torrc'))).toBe(false);
    expect(existsSync(join(dataDir, 'pt_state'))).toBe(false);
    expect(existsSync(dataDir)).toBe(false);
  });

  it('supports custom sanitized bridges in torrc without persisting outside dataDir and redacts bridge IPs on failure', async () => {
    const root = makeTempDir();
    const torDir = join(root, 'tor');
    const ptDir = join(torDir, 'pluggable_transports');
    mkdirSync(ptDir, { recursive: true });
    const torBin = createExecutable(join(torDir, 'tor'));
    createExecutable(join(ptDir, 'lyrebird'));
    const dataDir = join(root, 'tmp-custom');

    const secretBridgeIp = '198.51.100.88:443';
    const customBridgeLine = `obfs4 ${secretBridgeIp} AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA cert=secretcert123== iat-mode=0`;

    let capturedTorrc = '';
    const spawnFn = vi.fn((_cmd: string, args: string[]) => {
      const fIdx = args.indexOf('-f');
      capturedTorrc = readFileSync(args[fIdx + 1], 'utf8');
      const child = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        stdout: EventEmitter;
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        kill: () => boolean;
      };
      child.stderr = new EventEmitter();
      child.stdout = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.kill = () => true;

      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from(`Unable to connect to bridge ${secretBridgeIp}\n`));
        child.exitCode = 1;
        child.emit('exit', 1, null);
      });
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    });

    const controller = new TorController({
      localPort: 3001,
      dataDir,
      torBinaryPath: torBin,
      bridgeMode: 'custom',
      customBridges: `Bridge ${customBridgeLine}`,
      platform: 'linux',
      startupTimeoutMs: 2000,
      controlFilePollIntervalMs: 5,
      spawnFn,
    });

    let caughtError!: Error;
    try {
      await controller.start();
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError.message).not.toContain('198.51.100.88');
    expect(caughtError.message).toContain('[REDACTED_IP]');
    expect(capturedTorrc).toContain(`Bridge ${customBridgeLine}`);
    expect(existsSync(dataDir)).toBe(false);
  });

  it('defaults startup timeout to 180_000 ms when bridges are active and 120_000 ms in direct mode', async () => {
    expect(DEFAULT_STARTUP_TIMEOUT_MS).toBe(120_000);
    expect(DEFAULT_BRIDGE_STARTUP_TIMEOUT_MS).toBe(180_000);

    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    const root = makeTempDir();
    const torDir = join(root, 'tor');
    const ptDir = join(torDir, 'pluggable_transports');
    mkdirSync(ptDir, { recursive: true });
    const torBin = createExecutable(join(torDir, 'tor'));
    createExecutable(join(ptDir, 'lyrebird'));
    const dataDir = join(root, 'tmp-timeout');

    let resolveSpawned!: () => void;
    const spawnedPromise = new Promise<void>((resolve) => {
      resolveSpawned = resolve;
    });

    const spawnFn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        stdout: EventEmitter;
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        kill: () => boolean;
      };
      child.stderr = new EventEmitter();
      child.stdout = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.kill = () => {
        child.signalCode = 'SIGTERM';
        child.emit('exit', null, 'SIGTERM');
        return true;
      };
      resolveSpawned();
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    });

    const directController = new TorController({
      localPort: 3001,
      dataDir,
      torBinaryPath: torBin,
      bridgeMode: 'direct',
      platform: 'linux',
    });
    expect(directController.startupTimeoutMs).toBe(120_000);

    const bridgeController = new TorController({
      localPort: 3001,
      dataDir,
      torBinaryPath: torBin,
      bridgeMode: 'snowflake',
      platform: 'linux',
      controlFilePollIntervalMs: 1000,
      stopTimeoutMs: 50,
      spawnFn,
    });

    expect(bridgeController.startupTimeoutMs).toBe(180_000);
    let rejected = false;
    const startPromise = bridgeController.start().catch(() => {
      rejected = true;
    });

    await spawnedPromise;
    await vi.advanceTimersByTimeAsync(125_000);
    expect(rejected).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    for (let i = 0; i < 40 && !rejected; i++) {
      await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(50);
    }
    await startPromise;
    expect(rejected).toBe(true);
  });

  it('emits stall events when stuck <25% past stallTimeoutMs or on WARN BOOTSTRAP without leaking bridge IPs', async () => {
    const root = makeTempDir();
    const torDir = join(root, 'tor');
    mkdirSync(torDir, { recursive: true });
    const torBin = createExecutable(join(torDir, 'tor'));
    const dataDir = join(root, 'tmp-stall');

    const cookie = Buffer.alloc(32, 0x33);
    const serverNonce = Buffer.alloc(32, 0x44);
    const serviceId = 'vww6ybal4bd7szmgncyruucpgfkqahzddi37ktceo3ah7ngmcopnpyyd';
    const [clientStream, serverStream] = createDuplexPair();

    let buf = '';
    serverStream.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      while (buf.includes('\r\n')) {
        const idx = buf.indexOf('\r\n');
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (line.startsWith('AUTHCHALLENGE SAFECOOKIE ')) {
          const clientNonce = Buffer.from(line.slice('AUTHCHALLENGE SAFECOOKIE '.length).trim(), 'hex');
          const serverHash = computeSafeCookieServerHash(cookie, clientNonce, serverNonce);
          serverStream.write(
            `250 AUTHCHALLENGE SERVERHASH=${serverHash.toString('hex')} SERVERNONCE=${serverNonce.toString('hex')}\r\n`,
          );
        } else if (line.startsWith('AUTHENTICATE ') || line.startsWith('SETEVENTS ') || line.startsWith('DEL_ONION ')) {
          serverStream.write('250 OK\r\n');
        } else if (line.startsWith('ADD_ONION ')) {
          serverStream.write(`250-ServiceID=${serviceId}\r\n250 OK\r\n`);
          serverStream.write(
            '650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=10 TAG=conn_or SUMMARY="Connecting to relay"\r\n',
          );
        } else if (line === 'SIGNAL SHUTDOWN') {
          serverStream.write('250 closing\r\n');
        }
      }
    });

    const spawnFn = createMockSpawnWithTorrcCapture(cookie, 49902);
    const controller = new TorController({
      localPort: 3001,
      dataDir,
      torBinaryPath: torBin,
      bridgeMode: 'direct',
      platform: 'linux',
      startupTimeoutMs: 5000,
      stallTimeoutMs: 60,
      controlFilePollIntervalMs: 10,
      stopTimeoutMs: 200,
      spawnFn,
      connectFn: () => clientStream,
    });

    const stalls: TorStallEvent[] = [];
    controller.on('stall', (evt: TorStallEvent) => stalls.push(evt));

    const startPromise = controller.start();

    await vi.waitFor(() => {
      expect(stalls.some((s) => s.reason === 'bootstrap_stalled')).toBe(true);
    });
    expect(stalls[0]).toMatchObject({
      reason: 'bootstrap_stalled',
      bridgeMode: 'direct',
      progress: 10,
      tag: 'conn_or',
    });

    serverStream.write(
      '650 STATUS_CLIENT WARN BOOTSTRAP PROGRESS=10 TAG=conn_or SUMMARY="Problem connecting to 198.51.100.99:443" REASON=NOROUTE\r\n',
    );
    await vi.waitFor(() => {
      expect(stalls.some((s) => s.reason === 'warn_bootstrap')).toBe(true);
    });
    const warnStall = stalls.find((s) => s.reason === 'warn_bootstrap')!;
    expect(warnStall.bootstrapReason).toBe('NOROUTE');
    expect(warnStall.summary).not.toContain('198.51.100.99');
    expect(warnStall.summary).toContain('[REDACTED_IP]');

    serverStream.write(
      '650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"\r\n',
    );
    serverStream.write(`650 HS_DESC UPLOADED ${serviceId} NO_AUTH $HSD1\r\n`);

    await expect(startPromise).resolves.toBe(`http://${serviceId}.onion`);
    expect(controller.getState().stalled).toBe(false);
    await controller.stop();
  });
});
