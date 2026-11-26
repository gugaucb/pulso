#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TOR_BROWSER_VERSION = process.env.PULSO_TOR_BUNDLE_VERSION || '14.5.4';
const BASE_DOWNLOAD_URL = 'https://archive.torproject.org/tor-package-archive/torbrowser';

function resolveTargetTriple(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'macos-aarch64';
  if (platform === 'darwin' && arch === 'x64') return 'macos-x86_64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x86_64';
  if (platform === 'linux' && arch === 'ia32') return 'linux-i686';
  if (platform === 'win32' && arch === 'x64') return 'windows-x86_64';
  if (platform === 'win32' && arch === 'ia32') return 'windows-i686';
  throw new Error(`Unsupported platform/arch for Tor Expert Bundle: ${platform}/${arch}`);
}

function buildBundleUrls(version, target) {
  const filename = `tor-expert-bundle-${target}-${version}.tar.gz`;
  const base = `${BASE_DOWNLOAD_URL}/${version}`;
  return {
    filename,
    archiveUrl: `${base}/${filename}`,
    checksumsUrl: `${base}/sha256sums-signed-build.txt`,
    ascUrl: `${base}/${filename}.asc`,
  };
}

async function computeFileSha256(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex').toLowerCase();
}

function parseSha256FromChecksums(checksumsText, filename) {
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

function parseArgs(argv) {
  const opts = {
    help: false,
    dryRun: false,
    version: DEFAULT_TOR_BROWSER_VERSION,
    target: null,
    outDir: path.resolve(process.cwd(), '.tor-bin'),
    sha256: process.env.PULSO_TOR_BUNDLE_SHA256 || null,
    verifyFile: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--dry-run' || arg === '--print-url') {
      opts.dryRun = true;
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

function printHelp() {
  console.log(`PULSO Tor Expert Bundle Helper

Usage:
  node scripts/fetch-tor-bundle.mjs [options]

Options:
  --dry-run, --print-url     Print official download URLs without downloading
  --version <ver>            Tor Browser bundle version (default: ${DEFAULT_TOR_BROWSER_VERSION})
  --target <triple>          Override target (macos-aarch64, macos-x86_64, linux-x86_64, windows-x86_64)
  --out <dir>                Destination tools directory (default: .tor-bin)
  --sha256 <hex>             Expected SHA-256 digest to verify against
  --verify <file>            Compute and verify SHA-256 of an already-downloaded tarball
  -h, --help                 Show this help message

See docs/tor-mode.md for setup instructions and PULSO_TOR_BIN configuration.`);
}

async function downloadToBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
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
    console.log(`Target:       ${target}`);
    console.log(`Archive URL:  ${urls.archiveUrl}`);
    console.log(`Checksums:    ${urls.checksumsUrl}`);
    console.log(`Signature:    ${urls.ascUrl}`);
    console.log(`Destination:  ${opts.outDir}`);
    return;
  }

  await mkdir(opts.outDir, { recursive: true });
  const archivePath = path.join(opts.outDir, urls.filename);

  try {
    console.log(`Downloading ${urls.archiveUrl} ...`);
    const archiveBytes = await downloadToBuffer(urls.archiveUrl);
    await writeFile(archivePath, archiveBytes);

    let expectedSha256 = opts.sha256;
    if (!expectedSha256) {
      console.log(`Fetching ${urls.checksumsUrl} ...`);
      const checksumsText = (await downloadToBuffer(urls.checksumsUrl)).toString('utf8');
      expectedSha256 = parseSha256FromChecksums(checksumsText, urls.filename);
      if (!expectedSha256) {
        throw new Error(`Could not find ${urls.filename} in sha256sums-signed-build.txt`);
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
    console.log(`Tor Expert Bundle ready at ${expectedBinary}`);
  } finally {
    await rm(archivePath, { force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
