// @vitest-environment node
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { TorController, resolveTorBinary } from './torController';

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
      '98ca64872a16c283e1922e4a2610b91baa71b8ac630e5f18337e225b8751bbf0',
    );
    expect(computeSafeCookieClientHash(cookie, clientNonce, serverNonce).toString('hex')).toBe(
      '8b3bb5b7c72eeda289de53de757f94f8018581e4dc3a819c718962bf2ff729ee',
    );
  });

  it('parses AUTHCHALLENGE, ADD_ONION ServiceID, and STATUS_CLIENT / HS_DESC events', () => {
    const serverHashHex = '98ca64872a16c283e1922e4a2610b91baa71b8ac630e5f18337e225b8751bbf0';
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
