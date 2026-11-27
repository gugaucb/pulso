#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, createReadStream, existsSync, realpathSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CLOUDFLARED_VERSION =
  process.env.PULSO_CLOUDFLARED_VERSION?.trim() || '2025.11.1';

const TARGET_ASSET_MAP = {
  'darwin-arm64': {
    filename: 'cloudflared-darwin-arm64.tgz',
    binaryName: 'cloudflared',
    isArchive: true,
  },
  'darwin-amd64': {
    filename: 'cloudflared-darwin-amd64.tgz',
    binaryName: 'cloudflared',
    isArchive: true,
  },
  'linux-amd64': {
    filename: 'cloudflared-linux-amd64',
    binaryName: 'cloudflared',
    isArchive: false,
  },
  'linux-arm64': {
    filename: 'cloudflared-linux-arm64',
    binaryName: 'cloudflared',
    isArchive: false,
  },
  'windows-amd64': {
    filename: 'cloudflared-windows-amd64.exe',
    binaryName: 'cloudflared.exe',
    isArchive: false,
  },
};

const DEFAULT_NOTICE_CONTENT = `cloudflared
Copyright Cloudflare, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

See the accompanying LICENSE file for the full Apache License 2.0 text.
`;

export function resolveCloudflaredTarget(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-amd64';
  if (platform === 'linux' && arch === 'x64') return 'linux-amd64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  if (platform === 'win32' && arch === 'x64') return 'windows-amd64';
  throw new Error(`Unsupported platform/arch for cloudflared: ${platform}/${arch}`);
}

export function buildCloudflaredUrls(version, target) {
  const spec = TARGET_ASSET_MAP[target];
  if (!spec) {
    throw new Error(
      `Unsupported cloudflared target '${target}' (expected: ${Object.keys(TARGET_ASSET_MAP).join(', ')})`,
    );
  }

  const isLatest = version === 'latest';
  const ref = isLatest ? 'master' : version;
  const downloadUrl = isLatest
    ? `https://github.com/cloudflare/cloudflared/releases/latest/download/${spec.filename}`
    : `https://github.com/cloudflare/cloudflared/releases/download/${version}/${spec.filename}`;
  const releaseApiUrl = isLatest
    ? 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest'
    : `https://api.github.com/repos/cloudflare/cloudflared/releases/tags/${version}`;

  return {
    target,
    filename: spec.filename,
    binaryName: spec.binaryName,
    isArchive: spec.isArchive,
    downloadUrl,
    releaseApiUrl,
    licenseUrl: `https://raw.githubusercontent.com/cloudflare/cloudflared/${ref}/LICENSE`,
    noticeUrl: `https://raw.githubusercontent.com/cloudflare/cloudflared/${ref}/NOTICE`,
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

export async function verifyLocalFileSha256(filePath, expectedSha256 = null) {
  const actual = await computeFileSha256(filePath);
  if (expectedSha256) {
    const normalized = expectedSha256.trim().toLowerCase();
    if (actual !== normalized) {
      throw new Error(`SHA-256 mismatch: expected ${normalized}, got ${actual}`);
    }
  }
  return actual;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts a SHA-256 hex digest for `filename` from cloudflared GitHub release notes
 * (`<filename>: <hex>`, markdown table `| <filename> | <hex> |`, or `<hex>  <filename>`).
 */
export function parseSha256FromReleaseNotes(releaseBody, filename) {
  if (!releaseBody || !filename) return null;
  const escaped = escapeRegExp(filename);

  const colonOrTablePattern = new RegExp(
    `(?:^|\\|\\s*)(?:\\.?\\/)?${escaped}\\s*(?::|\\|)\\s*\`?([0-9a-fA-F]{64})\`?`,
    'm',
  );
  const colonMatch = colonOrTablePattern.exec(releaseBody);
  if (colonMatch) {
    return colonMatch[1].toLowerCase();
  }

  for (const rawLine of String(releaseBody).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const shaSumMatch = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (!shaSumMatch) continue;
    const [, digest, entryName] = shaSumMatch;
    if (path.basename(entryName.trim()) === filename) {
      return digest.toLowerCase();
    }
  }

  return null;
}

export function parseSha256FromReleaseJson(releaseJson, filename) {
  if (!releaseJson || typeof releaseJson !== 'object') return null;

  if (Array.isArray(releaseJson.assets)) {
    for (const asset of releaseJson.assets) {
      if (asset?.name === filename && typeof asset.digest === 'string') {
        const match = /^sha256:([0-9a-fA-F]{64})$/i.exec(asset.digest.trim());
        if (match) {
          return match[1].toLowerCase();
        }
      }
    }
  }

  if (typeof releaseJson.body === 'string') {
    return parseSha256FromReleaseNotes(releaseJson.body, filename);
  }

  return null;
}

export function parseArgs(argv) {
  const opts = {
    help: false,
    dryRun: false,
    version: DEFAULT_CLOUDFLARED_VERSION,
    target: null,
    outDir: path.resolve(process.cwd(), '.cloudflared-bin'),
    sha256: process.env.PULSO_CLOUDFLARED_SHA256?.toLowerCase() || null,
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
      opts.sha256 = argv[++i].trim().toLowerCase();
    } else if (arg === '--verify' && argv[i + 1]) {
      opts.verifyFile = path.resolve(process.cwd(), argv[++i]);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return opts;
}

export function printHelp() {
  console.log(`PULSO cloudflared Binary Fetch Helper

Usage:
  node scripts/fetch-cloudflared.mjs [options]

Options:
  --dry-run, --print-url     Print official download URLs without downloading
  --version <ver>            cloudflared release tag or 'latest' (default: ${DEFAULT_CLOUDFLARED_VERSION})
  --target <target>          Override target (darwin-arm64, darwin-amd64, linux-amd64, linux-arm64, windows-amd64)
  --out <dir>                Destination directory (default: .cloudflared-bin)
  --sha256 <hex>             Expected SHA-256 digest to verify against
  --verify <file>            Compute and verify SHA-256 of an already-downloaded file
  -h, --help                 Show this help message`);
}

export async function downloadToBuffer(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export function signMacOsCloudflaredBinary(binaryPath, execFileSyncFn = execFileSync) {
  execFileSyncFn('codesign', ['-s', '-', '--force', binaryPath], { stdio: 'ignore' });
}

/**
 * Preserves Apache 2.0 `LICENSE` and `NOTICE` alongside the fetched `cloudflared` binary.
 */
export async function preserveLicenseFiles({
  outDir,
  licenseUrl,
  noticeUrl,
  downloadToBufferFn = downloadToBuffer,
}) {
  await mkdir(outDir, { recursive: true });
  const licenseBytes = await downloadToBufferFn(licenseUrl);
  await writeFile(path.join(outDir, 'LICENSE'), licenseBytes);

  try {
    const noticeBytes = await downloadToBufferFn(noticeUrl);
    await writeFile(path.join(outDir, 'NOTICE'), noticeBytes);
  } catch {
    await writeFile(path.join(outDir, 'NOTICE'), DEFAULT_NOTICE_CONTENT, 'utf8');
  }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);

  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.verifyFile) {
    const actual = await verifyLocalFileSha256(opts.verifyFile, opts.sha256);
    console.log(`SHA-256 (${opts.verifyFile}): ${actual}`);
    if (opts.sha256) {
      console.log('SHA-256 verification passed.');
    }
    return;
  }

  const target = opts.target ?? resolveCloudflaredTarget();
  const urls = buildCloudflaredUrls(opts.version, target);

  if (opts.dryRun) {
    console.log(`Target:        ${target}`);
    console.log(`Download URL:  ${urls.downloadUrl}`);
    console.log(`Release API:   ${urls.releaseApiUrl}`);
    console.log(`License URL:   ${urls.licenseUrl}`);
    console.log(`Notice URL:    ${urls.noticeUrl}`);
    console.log(`Destination:   ${opts.outDir}`);
    return;
  }

  await mkdir(opts.outDir, { recursive: true });
  const downloadPath = path.join(opts.outDir, urls.filename);
  const expectedBinary = path.join(opts.outDir, urls.binaryName);

  try {
    let expectedSha256 = opts.sha256;
    if (!expectedSha256) {
      console.log(`Fetching release checksum metadata from ${urls.releaseApiUrl} ...`);
      const releaseBuf = await downloadToBuffer(urls.releaseApiUrl, {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pulso-fetch-cloudflared',
      });
      const releaseJson = JSON.parse(releaseBuf.toString('utf8'));
      expectedSha256 = parseSha256FromReleaseJson(releaseJson, urls.filename);
      if (!expectedSha256) {
        throw new Error(
          `Could not resolve official SHA-256 for ${urls.filename} from ${urls.releaseApiUrl}; provide --sha256 explicitly.`,
        );
      }
    }

    console.log(`Downloading ${urls.downloadUrl} ...`);
    const assetBytes = await downloadToBuffer(urls.downloadUrl);
    await writeFile(downloadPath, assetBytes);

    const actualSha256 = await verifyLocalFileSha256(downloadPath, expectedSha256);
    console.log(`Expected SHA-256: ${expectedSha256}`);
    console.log(`Actual SHA-256:   ${actualSha256}`);

    if (urls.isArchive) {
      execFileSync('tar', ['-xzf', downloadPath, '-C', opts.outDir], { stdio: 'inherit' });
    } else if (downloadPath !== expectedBinary) {
      await writeFile(expectedBinary, assetBytes);
    }

    if (!existsSync(expectedBinary)) {
      throw new Error(`Expected cloudflared binary not found at ${expectedBinary}`);
    }

    if (!target.startsWith('windows-')) {
      chmodSync(expectedBinary, 0o755);
    }

    if (target.startsWith('darwin-') || process.platform === 'darwin') {
      try {
        signMacOsCloudflaredBinary(expectedBinary);
        console.log(`Applied macOS ad-hoc code signature to ${expectedBinary}`);
      } catch (err) {
        console.warn(`Warning: Could not ad-hoc codesign ${expectedBinary}: ${err.message}`);
      }
    }

    await preserveLicenseFiles({
      outDir: opts.outDir,
      licenseUrl: urls.licenseUrl,
      noticeUrl: urls.noticeUrl,
    });

    console.log(`cloudflared ready at ${expectedBinary}`);
  } finally {
    if (downloadPath !== expectedBinary) {
      await rm(downloadPath, { force: true });
    }
  }
}

export function isDirectExecution() {
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
