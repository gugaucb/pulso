#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TOR_BROWSER_VERSION =
  process.env.PULSO_TOR_BUNDLE_VERSION?.trim() || '16.0';
export const BASE_DOWNLOAD_URL = 'https://archive.torproject.org/tor-package-archive/torbrowser';
export const TOR_BROWSER_SIGNING_KEY_FINGERPRINT = 'EF6E286DDA85EA2A4BA7DE684E2C6E8793298290';

export function resolveTargetTriple(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'macos-aarch64';
  if (platform === 'darwin' && arch === 'x64') return 'macos-x86_64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x86_64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-aarch64';
  if (platform === 'linux' && arch === 'ia32') return 'linux-i686';
  if (platform === 'win32' && arch === 'x64') return 'windows-x86_64';
  if (platform === 'win32' && arch === 'ia32') return 'windows-i686';
  throw new Error(`Unsupported platform/arch for Tor Expert Bundle: ${platform}/${arch}`);
}

export function buildBundleUrls(version, target) {
  const filename = `tor-expert-bundle-${target}-${version}.tar.gz`;
  const base = `${BASE_DOWNLOAD_URL}/${version}`;
  return {
    filename,
    archiveUrl: `${base}/${filename}`,
    checksumsUrl: `${base}/sha256sums-signed-build.txt`,
    checksumsAscUrl: `${base}/sha256sums-signed-build.txt.asc`,
    ascUrl: `${base}/${filename}.asc`,
  };
}

export async function computeFileSha256(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex').toLowerCase();
}

export function parseSha256FromChecksums(checksumsText, filename) {
  for (const rawLine of checksumsText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (!match) continue;
    const [, digest, entryName] = match;
    if (path.basename(entryName.trim()) === filename) {
      return digest.toLowerCase();
    }
  }
  return null;
}

export function parseArgs(argv) {
  const requirePgpEnv =
    process.env.PULSO_TOR_REQUIRE_PGP === '1' ||
    process.env.PULSO_TOR_REQUIRE_PGP === 'true';

  const opts = {
    help: false,
    dryRun: false,
    version: DEFAULT_TOR_BROWSER_VERSION,
    target: null,
    outDir: path.resolve(process.cwd(), '.tor-bin'),
    sha256: process.env.PULSO_TOR_BUNDLE_SHA256 || null,
    verifyFile: null,
    requirePgp: requirePgpEnv,
    gpgKeyring: process.env.PULSO_TOR_GPG_KEYRING
      ? path.resolve(process.cwd(), process.env.PULSO_TOR_GPG_KEYRING)
      : null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--dry-run' || arg === '--print-url') {
      opts.dryRun = true;
    } else if (arg === '--require-pgp') {
      opts.requirePgp = true;
    } else if (arg === '--gpg-keyring' && argv[i + 1]) {
      opts.gpgKeyring = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--version' && argv[i + 1]) {
      opts.version = argv[++i];
    } else if (arg === '--target' && argv[i + 1]) {
      opts.target = argv[++i];
    } else if (arg === '--out' && argv[i + 1]) {
      opts.outDir = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--sha256' && argv[i + 1]) {
      opts.sha256 = argv[++i].toLowerCase();
    } else if (arg === '--verify' && argv[i + 1]) {
      opts.verifyFile = path.resolve(process.cwd(), argv[++i]);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return opts;
}

export function printHelp() {
  console.log(`PULSO Tor Expert Bundle Helper

Usage:
  node scripts/fetch-tor-bundle.mjs [options]

Options:
  --dry-run, --print-url     Print official download URLs without downloading
  --version <ver>            Tor Browser bundle version (default: ${DEFAULT_TOR_BROWSER_VERSION})
  --target <triple>          Override target (macos-aarch64, macos-x86_64, linux-x86_64, linux-aarch64, linux-i686, windows-x86_64, windows-i686)
  --out <dir>                Destination tools directory (default: .tor-bin)
  --sha256 <hex>             Expected SHA-256 digest to verify against
  --verify <file>            Compute and verify SHA-256 of an already-downloaded tarball
  --require-pgp              Fail if gpg is unavailable or PGP verification cannot complete (recommended in CI)
  --gpg-keyring <file>       Use an explicit PGP keyring containing the Tor Browser Developers key (${TOR_BROWSER_SIGNING_KEY_FINGERPRINT})
  -h, --help                 Show this help message

See docs/tor-mode.md for setup instructions and PULSO_TOR_BIN configuration.`);
}

export async function downloadToBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Parses `gpg --status-fd 1 --verify` output and verifies the signature
 * originates from the expected Tor Browser Developers key fingerprint.
 */
export function parseGpgValidSig(
  statusOutput,
  expectedFingerprint = TOR_BROWSER_SIGNING_KEY_FINGERPRINT,
) {
  const normalizedExpected = expectedFingerprint.toUpperCase();
  const lines = String(statusOutput || '').split(/\r?\n/);

  for (const line of lines) {
    if (line.includes('BADSIG')) {
      return { valid: false, reason: 'GPG reported BADSIG' };
    }
    if (line.includes('ERRSIG')) {
      return { valid: false, reason: 'GPG reported ERRSIG' };
    }
  }

  for (const line of lines) {
    if (!line.startsWith('[GNUPG:] VALIDSIG ')) continue;
    const tokens = line.trim().split(/\s+/);
    const sigFpr = tokens[2]?.toUpperCase();
    const primaryFpr = tokens[11]?.toUpperCase();
    if (sigFpr === normalizedExpected || primaryFpr === normalizedExpected) {
      return { valid: true, fingerprint: normalizedExpected };
    }
    return {
      valid: false,
      reason: `Signature key fingerprint mismatch (expected ${normalizedExpected}, got ${primaryFpr || sigFpr || 'unknown'})`,
    };
  }

  return { valid: false, reason: 'No VALIDSIG record found in GPG output' };
}

function extractCommandOutput(err) {
  if (!err || typeof err !== 'object') return '';
  const parts = [];
  if (typeof err.stdout === 'string') parts.push(err.stdout);
  else if (Buffer.isBuffer(err.stdout)) parts.push(err.stdout.toString('utf8'));
  if (typeof err.stderr === 'string') parts.push(err.stderr);
  else if (Buffer.isBuffer(err.stderr)) parts.push(err.stderr.toString('utf8'));
  return parts.join('\n');
}

/**
 * Verifies sha256sums-signed-build.txt against its detached .asc signature
 * using the Tor Browser Developers signing key.
 */
export async function verifyChecksumsPgpSignature({
  checksumsPath,
  ascPath,
  expectedFingerprint = TOR_BROWSER_SIGNING_KEY_FINGERPRINT,
  requirePgp = false,
  keyringPath = null,
  execFileSyncFn = execFileSync,
  downloadToBufferFn = downloadToBuffer,
  warnFn = console.warn,
}) {
  try {
    execFileSyncFn('gpg', ['--version'], { stdio: 'ignore' });
  } catch {
    if (requirePgp) {
      throw new Error(
        'PGP verification required (--require-pgp) but gpg is not installed or not on PATH',
      );
    }
    warnFn(
      'Warning: gpg not found; skipping PGP signature verification for sha256sums-signed-build.txt (pass --require-pgp in CI).',
    );
    return { verified: false, skipped: true, reason: 'gpg_unavailable' };
  }

  let tempGpgHome = null;
  try {
    let baseArgs = keyringPath ? ['--no-default-keyring', '--keyring', keyringPath] : [];
    let keyAvailable = false;

    try {
      execFileSyncFn('gpg', [...baseArgs, '--list-keys', expectedFingerprint], { stdio: 'ignore' });
      keyAvailable = true;
    } catch {
      keyAvailable = false;
    }

    if (!keyAvailable && !keyringPath) {
      tempGpgHome = mkdtempSync(path.join(os.tmpdir(), 'pulso-gpg-'), { mode: 0o700 });
      baseArgs = ['--homedir', tempGpgHome];
      try {
        const keyUrl = `https://keys.openpgp.org/vks/v1/by-fingerprint/${expectedFingerprint}`;
        const keyBytes = await downloadToBufferFn(keyUrl);
        const keyFile = path.join(tempGpgHome, 'tor-browser-dev.asc');
        await writeFile(keyFile, keyBytes, { mode: 0o600 });
        execFileSyncFn('gpg', [...baseArgs, '--batch', '--import', keyFile], { stdio: 'ignore' });
        keyAvailable = true;
      } catch {
        try {
          execFileSyncFn(
            'gpg',
            [...baseArgs, '--batch', '--keyserver', 'hkps://keys.openpgp.org', '--recv-keys', expectedFingerprint],
            { stdio: 'ignore' },
          );
          keyAvailable = true;
        } catch {
          keyAvailable = false;
        }
      }
    }

    if (!keyAvailable) {
      const msg = `Tor Browser Developers PGP key (${expectedFingerprint}) is not available locally`;
      if (requirePgp) {
        throw new Error(`${msg}; import it or provide --gpg-keyring`);
      }
      warnFn(`Warning: ${msg}; skipping PGP verification (pass --require-pgp to enforce).`);
      return { verified: false, skipped: true, reason: 'key_unavailable' };
    }

    let statusOutput = '';
    try {
      const result = execFileSyncFn(
        'gpg',
        [...baseArgs, '--batch', '--status-fd', '1', '--verify', ascPath, checksumsPath],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      statusOutput = typeof result === 'string' ? result : String(result || '');
    } catch (err) {
      const detail = extractCommandOutput(err);
      const parsed = parseGpgValidSig(detail, expectedFingerprint);
      throw new Error(
        `PGP signature verification failed for ${path.basename(checksumsPath)}: ${parsed.reason || (err instanceof Error ? err.message : String(err))}`,
      );
    }

    const parsed = parseGpgValidSig(statusOutput, expectedFingerprint);
    if (!parsed.valid) {
      throw new Error(
        `PGP signature verification failed for ${path.basename(checksumsPath)}: ${parsed.reason}`,
      );
    }

    return { verified: true, skipped: false, fingerprint: parsed.fingerprint };
  } finally {
    if (tempGpgHome) {
      await rm(tempGpgHome, { recursive: true, force: true });
    }
  }
}

/**
 * Applies macOS ad-hoc code signature to sibling *.dylibs, tor binary,
 * and pluggable_transports/lyrebird (ignoring experimental conjure-client).
 */
export function signMacOsBundleBinaries(expectedTorBinary, execFileSyncFn = execFileSync) {
  const binDir = path.dirname(expectedTorBinary);
  for (const entry of readdirSync(binDir)) {
    if (!entry.endsWith('.dylib')) continue;
    const candidate = path.join(binDir, entry);
    if (statSync(candidate).isFile()) {
      execFileSyncFn('codesign', ['-s', '-', '--force', candidate], { stdio: 'ignore' });
    }
  }
  execFileSyncFn('codesign', ['-s', '-', '--force', expectedTorBinary], { stdio: 'ignore' });

  const lyrebirdPath = path.join(binDir, 'pluggable_transports', 'lyrebird');
  if (existsSync(lyrebirdPath) && statSync(lyrebirdPath).isFile()) {
    execFileSyncFn('codesign', ['-s', '-', '--force', lyrebirdPath], { stdio: 'ignore' });
  }
}

export async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.verifyFile) {
    const actual = await computeFileSha256(opts.verifyFile);
    console.log(`SHA-256 (${opts.verifyFile}): ${actual}`);
    if (opts.sha256) {
      if (actual !== opts.sha256) {
        throw new Error(`SHA-256 mismatch: expected ${opts.sha256}, got ${actual}`);
      }
      console.log('SHA-256 verification passed.');
    }
    return;
  }

  const target = opts.target ?? resolveTargetTriple();
  const urls = buildBundleUrls(opts.version, target);

  if (opts.dryRun) {
    console.log(`Target:        ${target}`);
    console.log(`Archive URL:   ${urls.archiveUrl}`);
    console.log(`Checksums:     ${urls.checksumsUrl}`);
    console.log(`Checksums Asc: ${urls.checksumsAscUrl}`);
    console.log(`Signature:     ${urls.ascUrl}`);
    console.log(`Destination:   ${opts.outDir}`);
    return;
  }

  await mkdir(opts.outDir, { recursive: true });
  const archivePath = path.join(opts.outDir, urls.filename);
  const checksumsPath = path.join(opts.outDir, 'sha256sums-signed-build.txt');
  const checksumsAscPath = path.join(opts.outDir, 'sha256sums-signed-build.txt.asc');

  try {
    console.log(`Downloading ${urls.archiveUrl} ...`);
    const archiveBytes = await downloadToBuffer(urls.archiveUrl);
    await writeFile(archivePath, archiveBytes);

    let expectedSha256 = opts.sha256;
    if (!expectedSha256 || opts.requirePgp) {
      console.log(`Fetching ${urls.checksumsUrl} ...`);
      const checksumsBytes = await downloadToBuffer(urls.checksumsUrl);
      await writeFile(checksumsPath, checksumsBytes);
      const checksumsText = checksumsBytes.toString('utf8');

      try {
        const ascBytes = await downloadToBuffer(urls.checksumsAscUrl);
        await writeFile(checksumsAscPath, ascBytes);
        const pgpResult = await verifyChecksumsPgpSignature({
          checksumsPath,
          ascPath: checksumsAscPath,
          requirePgp: opts.requirePgp,
          keyringPath: opts.gpgKeyring,
        });
        if (pgpResult.verified) {
          console.log(`PGP signature verified against ${pgpResult.fingerprint}`);
        }
      } catch (err) {
        if (opts.requirePgp || (err instanceof Error && err.message.startsWith('PGP signature verification failed'))) {
          throw err;
        }
        console.warn(`Warning: Could not verify PGP signature: ${err instanceof Error ? err.message : String(err)}`);
      }

      const parsedSha256 = parseSha256FromChecksums(checksumsText, urls.filename);
      if (!expectedSha256) {
        expectedSha256 = parsedSha256;
        if (!expectedSha256) {
          throw new Error(`Could not find ${urls.filename} in sha256sums-signed-build.txt`);
        }
      } else if (parsedSha256 && parsedSha256 !== expectedSha256) {
        throw new Error(`Provided --sha256 does not match signed sha256sums-signed-build.txt entry for ${urls.filename}`);
      }
    }

    const actualSha256 = await computeFileSha256(archivePath);
    console.log(`Expected SHA-256: ${expectedSha256}`);
    console.log(`Actual SHA-256:   ${actualSha256}`);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`SHA-256 verification failed for ${urls.filename}`);
    }

    execFileSync('tar', ['-xzf', archivePath, '-C', opts.outDir], { stdio: 'inherit' });

    const binaryName = target.startsWith('windows-') ? 'tor.exe' : 'tor';
    const expectedBinary = path.join(opts.outDir, 'tor', binaryName);
    if (!existsSync(expectedBinary)) {
      throw new Error(`Extracted bundle did not contain expected binary at ${expectedBinary}`);
    }

    if (target.startsWith('macos-') || process.platform === 'darwin') {
      try {
        signMacOsBundleBinaries(expectedBinary);
        console.log(`Applied macOS ad-hoc code signature to ${expectedBinary} and lyrebird`);
      } catch (err) {
        console.warn(`Warning: Could not ad-hoc codesign ${expectedBinary}: ${err.message}`);
      }
    }

    console.log(`Tor Expert Bundle ready at ${expectedBinary}`);
  } finally {
    await rm(archivePath, { force: true });
    await rm(checksumsPath, { force: true });
    await rm(checksumsAscPath, { force: true });
  }
}

function isDirectExecution() {
  if (process.env.VITEST) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entry);
  } catch {
    return fileURLToPath(import.meta.url) === path.resolve(entry);
  }
}

if (isDirectExecution()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
