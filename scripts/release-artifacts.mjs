#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGET_TO_SLUG = new Map([
  ['aarch64-apple-darwin', 'macos-arm64'],
  ['macos-arm64', 'macos-arm64'],
  ['x86_64-apple-darwin', 'macos-x64'],
  ['macos-x64', 'macos-x64'],
  ['x86_64-pc-windows-msvc', 'windows-x64'],
  ['windows-x64', 'windows-x64'],
  ['x86_64-unknown-linux-gnu', 'linux-x64'],
  ['linux-x64', 'linux-x64'],
  ['aarch64-unknown-linux-gnu', 'linux-arm64'],
  ['linux-arm64', 'linux-arm64'],
]);

const BUNDLE_EXTENSIONS = ['dmg', 'exe', 'zip', 'AppImage', 'deb'];
const VALID_FLAVORS = new Set(['tor', 'local']);

/**
 * Normalizes a release version string (stripping leading `v`) and validates it
 * against path-traversal or malformed characters.
 */
export function normalizeVersion(rawVersion) {
  const cleaned = String(rawVersion ?? '').trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(cleaned)) {
    throw new Error(`Invalid release version '${rawVersion}' (expected semver like 0.1.0 or v0.1.0)`);
  }
  return cleaned;
}

export function formatReleaseTag(rawVersion) {
  return `v${normalizeVersion(rawVersion)}`;
}

/**
 * Resolves a Rust target triple or slug to the canonical `<os>-<arch>` slug.
 */
export function resolveArtifactSlug(target) {
  const normalized = String(target ?? '').trim();
  const slug = TARGET_TO_SLUG.get(normalized);
  if (!slug) {
    throw new Error(`Unsupported release target '${target}'`);
  }
  return slug;
}

/**
 * Formats a standardized PULSO desktop release artifact filename:
 * `pulso-<flavor>-vX.Y.Z-<os>-<arch>.<ext>`.
 */
export function getStandardizedArtifactName({ flavor, version, target, ext }) {
  if (!VALID_FLAVORS.has(flavor)) {
    throw new Error(`Invalid flavor '${flavor}' (expected 'tor' or 'local')`);
  }
  const normalizedVersion = normalizeVersion(version);
  const slug = resolveArtifactSlug(target);
  const cleanExt = String(ext ?? '').trim().replace(/^\./, '');
  if (!cleanExt) {
    throw new Error('Artifact extension must not be empty');
  }
  return `pulso-${flavor}-v${normalizedVersion}-${slug}.${cleanExt}`;
}

/**
 * Parses a standardized artifact filename back into its metadata components.
 */
export function parseArtifactFilename(filename) {
  const base = path.basename(String(filename ?? '').trim());
  const match = /^pulso-(tor|local)-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(macos|windows|linux)-(arm64|x64)\.([A-Za-z0-9]+)$/.exec(
    base,
  );
  if (!match) return null;
  const [, flavor, version, osName, arch, ext] = match;
  return {
    name: base,
    flavor,
    version,
    os: osName,
    arch,
    ext,
  };
}

function detectBundleExtension(fileName) {
  if (fileName.startsWith('rw.')) return null;
  for (const ext of BUNDLE_EXTENSIONS) {
    if (fileName.endsWith(`.${ext}`)) {
      return ext;
    }
  }
  return null;
}

function walkFiles(dir, results = []) {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      // Skip macOS .app directories as a whole; we distribute .dmg on macOS
      if (!entry.endsWith('.app')) {
        walkFiles(fullPath, results);
      }
    } else if (st.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Finds bundle artifacts across input directories, computes their standardized
 * `pulso-<flavor>-vX.Y.Z-<os>-<arch>.<ext>` names, and copies them to `outputDir`.
 */
export async function collectAndRenameArtifacts({
  inputDirs,
  outputDir,
  flavor,
  version,
  target,
  dryRun = false,
}) {
  const dirs = Array.isArray(inputDirs) ? inputDirs : [inputDirs];
  const planned = [];
  const seenTargetNames = new Set();

  for (const dir of dirs) {
    for (const filePath of walkFiles(dir).sort()) {
      const ext = detectBundleExtension(path.basename(filePath));
      if (!ext) continue;
      const targetName = getStandardizedArtifactName({ flavor, version, target, ext });
      if (seenTargetNames.has(targetName)) {
        continue;
      }
      seenTargetNames.add(targetName);
      planned.push({
        sourcePath: filePath,
        targetName,
        destinationPath: path.join(outputDir, targetName),
        ext,
      });
    }
  }

  if (!dryRun) {
    await mkdir(outputDir, { recursive: true });
    for (const item of planned) {
      copyFileSync(item.sourcePath, item.destinationPath);
    }
  }

  return planned;
}

const EXCLUDED_CHECKSUM_FILES = new Set([
  'SHA256SUMS',
  'SHA256SUMS.asc',
  'release-manifest.json',
  '.DS_Store',
]);

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

/**
 * Generates deterministic GNU-compatible `SHA256SUMS` over release files in `dir`.
 */
export async function generateSha256Sums({
  dir,
  files = null,
  outPath = path.join(dir, 'SHA256SUMS'),
  dryRun = false,
}) {
  const discoveredFiles =
    files ??
    (existsSync(dir)
      ? readdirSync(dir).filter((name) => {
          if (EXCLUDED_CHECKSUM_FILES.has(name)) return false;
          const fullPath = path.join(dir, name);
          return existsSync(fullPath) && statSync(fullPath).isFile();
        })
      : []);

  const targetNames = discoveredFiles
    .filter((name) => !EXCLUDED_CHECKSUM_FILES.has(path.basename(name)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const entries = [];
  for (const name of targetNames) {
    const fullPath = path.join(dir, name);
    const sha256 = await computeFileSha256(fullPath);
    const size = statSync(fullPath).size;
    entries.push({ name, sha256, size });
  }

  const content =
    entries.map((entry) => `${entry.sha256}  ${entry.name}`).join('\n') +
    (entries.length > 0 ? '\n' : '');

  if (!dryRun) {
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, content, 'utf8');
  }

  return { outPath, content, entries };
}

/**
 * Verifies every entry in `SHA256SUMS` against files present in `dir`.
 */
export async function verifySha256Sums({
  dir,
  checksumsPath = path.join(dir, 'SHA256SUMS'),
  checksumsContent = null,
}) {
  const raw = checksumsContent ?? readFileSync(checksumsPath, 'utf8');
  const verifiedFiles = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (!match) {
      throw new Error(`Malformed SHA256SUMS line: ${line}`);
    }
    const [, expectedDigest, entryName] = match;
    const fileName = path.basename(entryName.trim());
    const fullPath = path.join(dir, fileName);
    if (!existsSync(fullPath)) {
      throw new Error(`Missing file listed in SHA256SUMS: ${fileName}`);
    }
    const actualDigest = await computeFileSha256(fullPath);
    if (actualDigest !== expectedDigest.toLowerCase()) {
      throw new Error(
        `SHA-256 mismatch for ${fileName}: expected ${expectedDigest.toLowerCase()}, got ${actualDigest}`,
      );
    }
    verifiedFiles.push(fileName);
  }

  return { verifiedFiles };
}

/**
 * Signs `SHA256SUMS` using an armored PGP private key when configured; skips cleanly otherwise.
 */
export async function signSha256Sums({
  checksumsPath,
  ascPath = `${checksumsPath}.asc`,
  privateKeyArmored = process.env.PULSO_PGP_PRIVATE_KEY ?? '',
  passphrase = process.env.PULSO_PGP_PASSPHRASE ?? '',
  execFileSyncFn = execFileSync,
  dryRun = false,
}) {
  const keyText = String(privateKeyArmored ?? '').trim();
  if (!keyText) {
    return { signed: false, skipped: true, reason: 'no_private_key' };
  }

  if (dryRun) {
    return { signed: true, skipped: false, dryRun: true, ascPath };
  }

  const gpgHome = mkdtempSync(path.join(os.tmpdir(), 'pulso-rel-gpg-'), { mode: 0o700 });
  try {
    const keyFile = path.join(gpgHome, 'release-key.asc');
    await writeFile(keyFile, keyText, { mode: 0o600 });

    execFileSyncFn('gpg', ['--homedir', gpgHome, '--batch', '--import', keyFile], {
      stdio: 'ignore',
    });

    const signArgs = [
      '--homedir',
      gpgHome,
      '--batch',
      '--yes',
      '--armor',
      '--detach-sign',
      '--pinentry-mode',
      'loopback',
    ];
    if (passphrase) {
      signArgs.push('--passphrase', passphrase);
    }
    signArgs.push('-o', ascPath, checksumsPath);

    execFileSyncFn('gpg', signArgs, { stdio: 'ignore' });
    return { signed: true, skipped: false, ascPath };
  } finally {
    await rm(gpgHome, { recursive: true, force: true });
  }
}

/**
 * Builds `release-manifest.json` matching the schema consumed by `fetchLatestReleaseManifest`
 * in `src/desktop/tauriBridge.ts` (`tag_name`, `html_url`) plus per-asset metadata.
 */
export function buildReleaseManifest({
  version,
  repository = process.env.GITHUB_REPOSITORY || 'pulso-app/pulso',
  entries = [],
  publishedAt = new Date().toISOString(),
}) {
  const normalizedVersion = normalizeVersion(version);
  const tag = formatReleaseTag(normalizedVersion);
  const repoSlug = String(repository).trim().replace(/^\/+|\/+$/g, '') || 'pulso-app/pulso';
  const htmlUrl = `https://github.com/${repoSlug}/releases/tag/${tag}`;

  const assets = entries.map((entry) => {
    const parsed = parseArtifactFilename(entry.name);
    return {
      name: entry.name,
      flavor: parsed?.flavor ?? null,
      os: parsed?.os ?? null,
      arch: parsed?.arch ?? null,
      ext: parsed?.ext ?? path.extname(entry.name).replace(/^\./, ''),
      sha256: entry.sha256,
      size: entry.size,
      download_url: `https://github.com/${repoSlug}/releases/download/${tag}/${entry.name}`,
    };
  });

  return {
    tag_name: tag,
    version: normalizedVersion,
    html_url: htmlUrl,
    published_at: publishedAt,
    assets,
  };
}

/**
 * Generates `SHA256SUMS`, optional `SHA256SUMS.asc`, and `release-manifest.json` for `dir`.
 */
export async function generateReleaseOutputs({
  dir,
  version,
  repository = process.env.GITHUB_REPOSITORY || 'pulso-app/pulso',
  privateKeyArmored = process.env.PULSO_PGP_PRIVATE_KEY ?? '',
  passphrase = process.env.PULSO_PGP_PASSPHRASE ?? '',
  execFileSyncFn = execFileSync,
  publishedAt = new Date().toISOString(),
  dryRun = false,
}) {
  const sha256Sums = await generateSha256Sums({ dir, dryRun });
  const pgp = await signSha256Sums({
    checksumsPath: sha256Sums.outPath,
    ascPath: `${sha256Sums.outPath}.asc`,
    privateKeyArmored,
    passphrase,
    execFileSyncFn,
    dryRun,
  });
  const manifest = buildReleaseManifest({
    version,
    repository,
    entries: sha256Sums.entries,
    publishedAt,
  });
  const manifestPath = path.join(dir, 'release-manifest.json');

  if (!dryRun) {
    await mkdir(dir, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  return {
    dryRun,
    sha256Sums,
    pgp,
    manifestPath,
    manifest,
  };
}

function readDefaultPackageVersion() {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.version === 'string' && pkg.version.trim()) {
        return pkg.version.trim();
      }
    }
  } catch {
    // Fall back to 0.1.0
  }
  return '0.1.0';
}

export function parseArgs(argv) {
  const opts = {
    help: false,
    dryRun: false,
    collect: false,
    verify: false,
    dir: path.resolve(process.cwd(), 'release-assets'),
    inputDirs: [],
    outputDir: path.resolve(process.cwd(), 'release-assets'),
    flavor: null,
    target: null,
    version: readDefaultPackageVersion(),
    repo: process.env.GITHUB_REPOSITORY || 'pulso-app/pulso',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--collect') {
      opts.collect = true;
    } else if (arg === '--verify') {
      opts.verify = true;
    } else if (arg === '--dir' && argv[i + 1]) {
      opts.dir = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--input-dir' && argv[i + 1]) {
      opts.inputDirs.push(path.resolve(process.cwd(), argv[++i]));
    } else if (arg === '--output-dir' && argv[i + 1]) {
      opts.outputDir = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--flavor' && argv[i + 1]) {
      opts.flavor = argv[++i];
    } else if (arg === '--target' && argv[i + 1]) {
      opts.target = argv[++i];
    } else if (arg === '--version' && argv[i + 1]) {
      opts.version = argv[++i];
    } else if (arg === '--repo' && argv[i + 1]) {
      opts.repo = argv[++i];
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return opts;
}

export function printHelp() {
  console.log(`PULSO Release Artifacts, Checksums & Manifest Tool

Usage:
  node scripts/release-artifacts.mjs [options]

Options:
  --collect                  Collect & rename Tauri bundle outputs into standardized names
  --input-dir <dir>          Source bundle directory (repeatable with --collect)
  --output-dir <dir>         Destination directory for --collect (default: release-assets)
  --flavor <tor|local>       Flavor for --collect
  --target <triple|slug>     Target triple or slug for --collect
  --dir <dir>                Release assets directory (default: release-assets)
  --version <semver>         Release version (default: package.json version)
  --repo <owner/repo>        GitHub repository slug (default: GITHUB_REPOSITORY or pulso-app/pulso)
  --verify                   Verify existing SHA256SUMS in --dir
  --dry-run                  Print planned output without writing files or invoking gpg
  -h, --help                 Show this help message`);
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.collect) {
    if (!opts.flavor || !opts.target) {
      throw new Error('--collect requires --flavor <tor|local> and --target <triple|slug>');
    }
    const items = await collectAndRenameArtifacts({
      inputDirs: opts.inputDirs.length > 0 ? opts.inputDirs : [path.resolve(process.cwd(), 'src-tauri', 'target')],
      outputDir: opts.outputDir,
      flavor: opts.flavor,
      version: opts.version,
      target: opts.target,
      dryRun: opts.dryRun,
    });
    console.log(`${opts.dryRun ? '[dry-run] ' : ''}Collected ${items.length} artifact(s):`);
    for (const item of items) {
      console.log(`  ${item.sourcePath} -> ${item.targetName}`);
    }
    return;
  }

  if (opts.verify) {
    const result = await verifySha256Sums({ dir: opts.dir });
    console.log(`Verified ${result.verifiedFiles.length} file(s) against SHA256SUMS`);
    return;
  }

  const result = await generateReleaseOutputs({
    dir: opts.dir,
    version: opts.version,
    repository: opts.repo,
    dryRun: opts.dryRun,
  });

  const prefix = opts.dryRun ? '[dry-run] ' : '';
  console.log(`${prefix}Release tag:  ${result.manifest.tag_name}`);
  console.log(`${prefix}Manifest URL: ${result.manifest.html_url}`);
  console.log(`${prefix}Assets:       ${result.sha256Sums.entries.length}`);
  console.log(`${prefix}PGP signed:   ${result.pgp.signed ? 'yes' : `no (${result.pgp.reason})`}`);
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
