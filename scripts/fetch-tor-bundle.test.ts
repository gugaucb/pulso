// @vitest-environment node
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOR_BROWSER_VERSION,
  TOR_BROWSER_SIGNING_KEY_FINGERPRINT,
  buildBundleUrls,
  buildTorSigningKeyUrls,
  formatGpgPath,
  parseArgs,
  parseGpgValidSig,
  parseSha256FromChecksums,
  resolveTargetTriple,
  signMacOsBundleBinaries,
  verifyChecksumsPgpSignature,
} from './fetch-tor-bundle.mjs';
import { extractTarGz } from './lib/cli-utils.mjs';

describe('scripts/fetch-tor-bundle.mjs helpers', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-fetch-tor-'));
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

  it('defaults to Tor Browser 16.0+ and maps all supported platforms including linux/arm64 -> linux-aarch64', () => {
    expect(DEFAULT_TOR_BROWSER_VERSION).toMatch(/^16\./);

    expect(resolveTargetTriple('darwin', 'arm64')).toBe('macos-aarch64');
    expect(resolveTargetTriple('darwin', 'x64')).toBe('macos-x86_64');
    expect(resolveTargetTriple('linux', 'x64')).toBe('linux-x86_64');
    expect(resolveTargetTriple('linux', 'arm64')).toBe('linux-aarch64');
    expect(resolveTargetTriple('linux', 'ia32')).toBe('linux-i686');
    expect(resolveTargetTriple('win32', 'x64')).toBe('windows-x86_64');
    expect(resolveTargetTriple('win32', 'ia32')).toBe('windows-i686');
    expect(() => resolveTargetTriple('freebsd', 'x64')).toThrow(/Unsupported platform\/arch/);
  });

  it('builds official Tor archive, sha256sums-signed-build.txt, and .asc URLs', () => {
    const urls = buildBundleUrls('16.0', 'linux-aarch64');
    expect(urls.filename).toBe('tor-expert-bundle-linux-aarch64-16.0.tar.gz');
    expect(urls.archiveUrl).toBe(
      'https://archive.torproject.org/tor-package-archive/torbrowser/16.0/tor-expert-bundle-linux-aarch64-16.0.tar.gz',
    );
    expect(urls.checksumsUrl).toBe(
      'https://archive.torproject.org/tor-package-archive/torbrowser/16.0/sha256sums-signed-build.txt',
    );
    expect(urls.checksumsAscUrl).toBe(
      'https://archive.torproject.org/tor-package-archive/torbrowser/16.0/sha256sums-signed-build.txt.asc',
    );
    expect(urls.ascUrl).toBe(
      'https://archive.torproject.org/tor-package-archive/torbrowser/16.0/tor-expert-bundle-linux-aarch64-16.0.tar.gz.asc',
    );
  });

  it('parses SHA-256 checksums and CLI flags including --require-pgp and --gpg-keyring', () => {
    const checksums = [
      `${'a'.repeat(64)}  tor-expert-bundle-linux-x86_64-16.0.tar.gz`,
      `${'b'.repeat(64)} *./tor-expert-bundle-linux-aarch64-16.0.tar.gz`,
    ].join('\n');

    expect(
      parseSha256FromChecksums(checksums, 'tor-expert-bundle-linux-aarch64-16.0.tar.gz'),
    ).toBe('b'.repeat(64));

    const opts = parseArgs(['--require-pgp', '--gpg-keyring', 'keys/tor.gpg', '--version', '16.0.1']);
    expect(opts.requirePgp).toBe(true);
    expect(opts.gpgKeyring).toMatch(/keys\/tor\.gpg$/);
    expect(opts.version).toBe('16.0.1');
  });

  it('validates GPG status-fd output strictly against the Tor Browser Developers key fingerprint', () => {
    expect(TOR_BROWSER_SIGNING_KEY_FINGERPRINT).toBe('EF6E286DDA85EA2A4BA7DE684E2C6E8793298290');

    const subkeySignedOutput = [
      '[GNUPG:] NEWSIG',
      '[GNUPG:] KEY_CONSIDERED EF6E286DDA85EA2A4BA7DE684E2C6E8793298290 0',
      '[GNUPG:] GOODSIG 1111222233334444 Tor Browser Developers (signing key) <torbrowser@torproject.org>',
      '[GNUPG:] VALIDSIG AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555 2026-01-01 1767225600 0 4 0 1 10 00 EF6E286DDA85EA2A4BA7DE684E2C6E8793298290',
    ].join('\n');

    expect(parseGpgValidSig(subkeySignedOutput)).toEqual({
      valid: true,
      fingerprint: 'EF6E286DDA85EA2A4BA7DE684E2C6E8793298290',
    });

    const wrongKeyOutput =
      '[GNUPG:] VALIDSIG 0000000000000000000000000000000000000001 2026-01-01 1767225600 0 4 0 1 10 00 0000000000000000000000000000000000000002';
    expect(parseGpgValidSig(wrongKeyOutput).valid).toBe(false);

    const badSigOutput = '[GNUPG:] BADSIG 1111222233334444 Unknown';
    expect(parseGpgValidSig(badSigOutput).valid).toBe(false);
  });

  it('skips PGP verification with a warning when gpg is absent locally, but fails when --require-pgp is enabled', async () => {
    const dir = makeTempDir();
    const checksumsPath = join(dir, 'sha256sums-signed-build.txt');
    const ascPath = join(dir, 'sha256sums-signed-build.txt.asc');
    writeFileSync(checksumsPath, 'dummy', 'utf8');
    writeFileSync(ascPath, 'dummy asc', 'utf8');

    const missingGpgExec = vi.fn(() => {
      throw new Error('spawn gpg ENOENT');
    });
    const warnings: string[] = [];

    const skipped = await verifyChecksumsPgpSignature({
      checksumsPath,
      ascPath,
      requirePgp: false,
      execFileSyncFn: missingGpgExec as unknown as typeof import('node:child_process').execFileSync,
      warnFn: (msg: string) => warnings.push(msg),
    });

    expect(skipped.verified).toBe(false);
    expect(skipped.skipped).toBe(true);
    expect(warnings.join('\n')).toMatch(/gpg/i);

    await expect(
      verifyChecksumsPgpSignature({
        checksumsPath,
        ascPath,
        requirePgp: true,
        execFileSyncFn: missingGpgExec as unknown as typeof import('node:child_process').execFileSync,
        warnFn: () => {},
      }),
    ).rejects.toThrow(/--require-pgp/i);
  });

  it('verifies sha256sums-signed-build.txt.asc when gpg is present and rejects BADSIG', async () => {
    const dir = makeTempDir();
    const checksumsPath = join(dir, 'sha256sums-signed-build.txt');
    const ascPath = join(dir, 'sha256sums-signed-build.txt.asc');
    writeFileSync(checksumsPath, 'checksums', 'utf8');
    writeFileSync(ascPath, 'sig', 'utf8');

    const goodExec = vi.fn((_cmd: string, args: string[]) => {
      if (args.includes('--verify')) {
        return '[GNUPG:] VALIDSIG EF6E286DDA85EA2A4BA7DE684E2C6E8793298290 2026-01-01 1767225600 0 4 0 1 10 00 EF6E286DDA85EA2A4BA7DE684E2C6E8793298290\n';
      }
      return '';
    });

    const result = await verifyChecksumsPgpSignature({
      checksumsPath,
      ascPath,
      requirePgp: true,
      execFileSyncFn: goodExec as unknown as typeof import('node:child_process').execFileSync,
      warnFn: () => {},
    });

    expect(result).toEqual({
      verified: true,
      skipped: false,
      fingerprint: TOR_BROWSER_SIGNING_KEY_FINGERPRINT,
    });

    const badSigExec = vi.fn((_cmd: string, args: string[]) => {
      if (args.includes('--verify')) {
        const err = new Error('Command failed: gpg --verify') as Error & { stdout?: string };
        err.stdout = '[GNUPG:] BADSIG 4E2C6E8793298290 Tor Browser Developers';
        throw err;
      }
      return '';
    });

    await expect(
      verifyChecksumsPgpSignature({
        checksumsPath,
        ascPath,
        requirePgp: false,
        execFileSyncFn: badSigExec as unknown as typeof import('node:child_process').execFileSync,
        warnFn: () => {},
      }),
    ).rejects.toThrow(/PGP signature verification failed/i);
  });

  it('applies macOS ad-hoc codesign to *.dylib, tor, and pluggable_transports/lyrebird while ignoring conjure-client', () => {
    const dir = makeTempDir();
    const torDir = join(dir, 'tor');
    const ptDir = join(torDir, 'pluggable_transports');
    mkdirSync(ptDir, { recursive: true });

    const torBin = join(torDir, 'tor');
    const dylib = join(torDir, 'libevent-2.1.7.dylib');
    const lyrebird = join(ptDir, 'lyrebird');
    const conjure = join(ptDir, 'conjure-client');
    writeFileSync(torBin, 'tor', 'utf8');
    writeFileSync(dylib, 'dylib', 'utf8');
    writeFileSync(lyrebird, 'lyrebird', 'utf8');
    writeFileSync(conjure, 'conjure', 'utf8');
    chmodSync(torBin, 0o755);
    chmodSync(lyrebird, 0o755);
    chmodSync(conjure, 0o755);

    const execMock = vi.fn();
    signMacOsBundleBinaries(torBin, execMock as unknown as typeof import('node:child_process').execFileSync);

    expect(execMock).toHaveBeenCalledWith('codesign', ['-s', '-', '--force', dylib], { stdio: 'ignore' });
    expect(execMock).toHaveBeenCalledWith('codesign', ['-s', '-', '--force', torBin], { stdio: 'ignore' });
    expect(execMock).toHaveBeenCalledWith('codesign', ['-s', '-', '--force', lyrebird], { stdio: 'ignore' });
    expect(execMock).not.toHaveBeenCalledWith(
      'codesign',
      ['-s', '-', '--force', conjure],
      expect.anything(),
    );
  });

  it('normalizes Windows backslashes for gpg and falls back across WKD, keys.openpgp.org, and keyserver.ubuntu.com', async () => {
    expect(formatGpgPath('C:\\Users\\runner\\AppData\\Local\\Temp\\pulso-gpg-1\\sig.asc', 'win32')).toBe(
      'C:/Users/runner/AppData/Local/Temp/pulso-gpg-1/sig.asc',
    );
    expect(formatGpgPath('/tmp/pulso-gpg-1/sig.asc', 'linux')).toBe('/tmp/pulso-gpg-1/sig.asc');

    const keyUrls = buildTorSigningKeyUrls(TOR_BROWSER_SIGNING_KEY_FINGERPRINT);
    expect(keyUrls[0]).toContain('openpgpkey.torproject.org');
    expect(keyUrls.some((url) => url.includes('keys.openpgp.org'))).toBe(true);
    expect(keyUrls.some((url) => url.includes('keyserver.ubuntu.com'))).toBe(true);

    const dir = makeTempDir();
    const checksumsPath = join(dir, 'sha256sums-signed-build.txt');
    const ascPath = join(dir, 'sha256sums-signed-build.txt.asc');
    writeFileSync(checksumsPath, 'checksums', 'utf8');
    writeFileSync(ascPath, 'sig', 'utf8');

    const downloadedUrls: string[] = [];
    const downloadMock = vi.fn(async (url: string) => {
      downloadedUrls.push(url);
      if (url.includes('openpgpkey.torproject.org')) {
        throw new Error('HTTP 503 Service Unavailable');
      }
      if (url.includes('keys.openpgp.org')) {
        return Buffer.from('-----BEGIN PGP PUBLIC KEY BLOCK-----\nstripped-uid\n-----END PGP PUBLIC KEY BLOCK-----');
      }
      return Buffer.from('-----BEGIN PGP PUBLIC KEY BLOCK-----\nfull-key\n-----END PGP PUBLIC KEY BLOCK-----');
    });

    const gpgCalls: Array<{ args: string[]; input?: unknown }> = [];
    let defaultKeyImported = false;
    const winExecMock = vi.fn((_cmd: string, args: string[], opts?: { input?: unknown }) => {
      gpgCalls.push({ args, input: opts?.input });
      if (args.includes('--version')) return 'gpg (GnuPG) 2.4.5';
      if (args.includes('--list-keys')) {
        if (!args.includes('--homedir') && defaultKeyImported) {
          return 'pub   rsa4096';
        }
        throw new Error('public key not found');
      }
      if (args.includes('--import')) {
        const keyText = Buffer.isBuffer(opts?.input) ? opts.input.toString('utf8') : String(opts?.input ?? '');
        // Simulate keys.openpgp.org stripped-UID rejection AND MSYS2 --homedir failure
        if (keyText.includes('stripped-uid') || args.includes('--homedir')) {
          const err = new Error('gpg: no valid OpenPGP data found / homedir failed') as Error & { stderr?: string };
          err.stderr = keyText.includes('stripped-uid') ? 'gpg: no user ID' : 'gpg: homedir socket error';
          throw err;
        }
        defaultKeyImported = true;
        return '';
      }
      if (args.includes('--verify')) {
        expect(defaultKeyImported).toBe(true);
        // On win32, no backslashes should remain in any gpg path argument
        for (const a of args) {
          expect(a).not.toContain('\\');
        }
        return `[GNUPG:] VALIDSIG ${TOR_BROWSER_SIGNING_KEY_FINGERPRINT} 2026-01-01 1767225600 0 4 0 1 10 00 ${TOR_BROWSER_SIGNING_KEY_FINGERPRINT}\n`;
      }
      return '';
    });

    const result = await verifyChecksumsPgpSignature({
      checksumsPath: 'C:\\work\\sha256sums-signed-build.txt',
      ascPath: 'C:\\work\\sha256sums-signed-build.txt.asc',
      requirePgp: true,
      platform: 'win32',
      execFileSyncFn: winExecMock as unknown as typeof import('node:child_process').execFileSync,
      downloadToBufferFn: downloadMock,
      warnFn: () => {},
    });

    expect(result.verified).toBe(true);
    expect(downloadedUrls.some((u) => u.includes('openpgpkey.torproject.org'))).toBe(true);
    expect(downloadedUrls.some((u) => u.includes('keys.openpgp.org'))).toBe(true);
    expect(downloadedUrls.some((u) => u.includes('keyserver.ubuntu.com'))).toBe(true);
    expect(gpgCalls.some((c) => c.args.includes('--import') && Buffer.isBuffer(c.input))).toBe(true);
  });

  it('includes captured GPG/network diagnostic reasons when all key import fallbacks fail under --require-pgp', async () => {
    const dir = makeTempDir();
    const checksumsPath = join(dir, 'sha256sums-signed-build.txt');
    const ascPath = join(dir, 'sha256sums-signed-build.txt.asc');
    writeFileSync(checksumsPath, 'checksums', 'utf8');
    writeFileSync(ascPath, 'sig', 'utf8');

    const failDownload = vi.fn(async () => {
      throw new Error('HTTP 429 Too Many Requests');
    });
    const failExec = vi.fn((_cmd: string, args: string[]) => {
      if (args.includes('--version')) return 'gpg 2.4';
      const err = new Error('gpg failed') as Error & { stderr?: string };
      err.stderr = 'gpg: keyserver receive failed: No name';
      throw err;
    });

    await expect(
      verifyChecksumsPgpSignature({
        checksumsPath,
        ascPath,
        requirePgp: true,
        execFileSyncFn: failExec as unknown as typeof import('node:child_process').execFileSync,
        downloadToBufferFn: failDownload,
        warnFn: () => {},
      }),
    ).rejects.toThrow(/HTTP 429 Too Many Requests|keyserver receive failed/i);
  });

  it('extracts .tar.gz archives on Windows without triggering GNU tar remote-host D: parsing', () => {
    const tarCalls: Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }> = [];
    const execSpy = vi.fn((cmd: string, args: string[], opts: Record<string, unknown>) => {
      tarCalls.push({ cmd, args, opts });
      return '';
    });

    extractTarGz(
      'D:\\a\\pulso\\pulso\\.tor-bin\\tor-expert-bundle-windows-x86_64-16.0.tar.gz',
      'D:\\a\\pulso\\pulso\\.tor-bin',
      {
        platform: 'win32',
        execFileSyncFn: execSpy as unknown as typeof import('node:child_process').execFileSync,
      },
    );

    expect(tarCalls[0]).toEqual({
      cmd: 'tar',
      args: ['-xzf', 'tor-expert-bundle-windows-x86_64-16.0.tar.gz'],
      opts: { cwd: 'D:\\a\\pulso\\pulso\\.tor-bin', stdio: 'inherit' },
    });
    expect(tarCalls[0]!.args.join(' ')).not.toContain(':');

    extractTarGz(
      'C:\\temp\\tor-expert-bundle-windows-x86_64-16.0.tar.gz',
      'D:\\a\\pulso\\pulso\\.tor-bin',
      {
        platform: 'win32',
        execFileSyncFn: execSpy as unknown as typeof import('node:child_process').execFileSync,
      },
    );

    expect(tarCalls[1]).toEqual({
      cmd: 'tar',
      args: [
        '--force-local',
        '-xzf',
        'C:/temp/tor-expert-bundle-windows-x86_64-16.0.tar.gz',
        '-C',
        'D:/a/pulso/pulso/.tor-bin',
      ],
      opts: { stdio: 'inherit' },
    });
  });
});
