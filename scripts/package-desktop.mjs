#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRustTargetTriple, sidecarBinaryName } from './build-sidecar.mjs';

const TRIPLE_TO_ARTIFACT_SLUG = new Map([
  ['aarch64-apple-darwin', 'macos-arm64'],
  ['x86_64-apple-darwin', 'macos-x64'],
  ['x86_64-pc-windows-msvc', 'windows-x64'],
  ['x86_64-unknown-linux-gnu', 'linux-x64'],
  ['aarch64-unknown-linux-gnu', 'linux-arm64'],
]);

function codesignAdHoc(targetPath, execFileSyncFn = execFileSync) {
  execFileSyncFn('codesign', ['-s', '-', '--force', targetPath], { stdio: 'ignore' });
}

export function formatReleaseArtifactName({ flavor, version, targetTriple, ext }) {
  const slug = TRIPLE_TO_ARTIFACT_SLUG.get(targetTriple) ?? targetTriple;
  const normalizedVersion = String(version).trim().replace(/^v/i, '');
  const cleanExt = String(ext).trim().replace(/^\./, '');
  return `pulso-${flavor}-v${normalizedVersion}-${slug}.${cleanExt}`;
}

export function parseArgs(argv) {
  const opts = {
    help: false,
    dryRun: false,
    flavor: 'local',
    target: null,
    version: '0.1.0',
    torSourceDir: path.resolve(process.cwd(), '.tor-bin', 'tor'),
    cloudflaredSourceDir: path.resolve(process.cwd(), '.cloudflared-bin'),
    tauriDir: path.resolve(process.cwd(), 'src-tauri'),
    appPath: null,
    portableSourceDir: null,
    outZipPath: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--flavor' && argv[i + 1]) {
      const value = argv[++i];
      if (value !== 'tor' && value !== 'local') {
        throw new Error(`Invalid flavor '${value}' (expected 'tor' or 'local')`);
      }
      opts.flavor = value;
    } else if (arg === '--target' && argv[i + 1]) {
      opts.target = argv[++i];
    } else if (arg === '--version' && argv[i + 1]) {
      opts.version = argv[++i];
    } else if (arg === '--tor-dir' && argv[i + 1]) {
      opts.torSourceDir = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--cloudflared-dir' && argv[i + 1]) {
      opts.cloudflaredSourceDir = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--tauri-dir' && argv[i + 1]) {
      opts.tauriDir = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--verify-app' && argv[i + 1]) {
      opts.appPath = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--portable-dir' && argv[i + 1]) {
      opts.portableSourceDir = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--out-zip' && argv[i + 1]) {
      opts.outZipPath = path.resolve(process.cwd(), argv[++i]);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return opts;
}

export function printHelp() {
  console.log(`PULSO Desktop Packager & Signer

Usage:
  node scripts/package-desktop.mjs --flavor <tor|local> [options]

Options:
  --flavor <tor|local>        Desktop flavor (default: local)
  --target <triple|alias>     Target triple or alias (default: host)
  --version <semver>          Release version for artifact naming (default: 0.1.0)
  --tor-dir <dir>             Source Tor Expert Bundle dir (default: .tor-bin/tor)
  --cloudflared-dir <dir>     Source cloudflared dir (default: .cloudflared-bin)
  --tauri-dir <dir>           Tauri project root (default: src-tauri)
  --verify-app <path.app>     Verify & ad-hoc sign an existing macOS .app bundle
  --portable-dir <dir>        Source directory to archive into a portable .zip
  --out-zip <file.zip>        Output path for portable .zip
  --dry-run                   Print packaging plan without modifying files
  -h, --help                  Show this help message`);
}

function removeMatchingFiles(dir, prefix) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(prefix)) {
      const fullPath = path.join(dir, entry);
      if (statSync(fullPath).isFile()) {
        rm(fullPath, { force: true }).catch(() => {});
      }
    }
  }
}

/**
 * Stages flavor-specific external binaries and resources under `src-tauri/`,
 * strictly preventing `cloudflared` from leaking into `tor` and `tor`/`lyrebird`
 * from leaking into `local`.
 */
export async function stageFlavorResources({
  flavor,
  targetTriple,
  torSourceDir = path.resolve(process.cwd(), '.tor-bin', 'tor'),
  cloudflaredSourceDir = path.resolve(process.cwd(), '.cloudflared-bin'),
  tauriDir = path.resolve(process.cwd(), 'src-tauri'),
  execFileSyncFn = execFileSync,
} = {}) {
  const binariesDir = path.join(tauriDir, 'binaries');
  const torDestDir = path.join(tauriDir, 'resources', 'tor');
  const isWindows = targetTriple.includes('windows');
  const isDarwin = targetTriple.includes('apple-darwin');
  const ext = isWindows ? '.exe' : '';

  await mkdir(binariesDir, { recursive: true });

  const sidecarPath = path.join(binariesDir, sidecarBinaryName(targetTriple));
  if (isDarwin && existsSync(sidecarPath)) {
    codesignAdHoc(sidecarPath, execFileSyncFn);
  }

  if (flavor === 'tor') {
    removeMatchingFiles(binariesDir, 'cloudflared');
    await rm(torDestDir, { recursive: true, force: true });

    if (!existsSync(torSourceDir)) {
      throw new Error(`Tor source directory not found at ${torSourceDir}`);
    }

    await cp(torSourceDir, torDestDir, {
      recursive: true,
      filter: (src) => path.basename(src) !== 'conjure-client' && path.basename(src) !== 'conjure-client.exe',
    });

    const torBin = path.join(torDestDir, `tor${ext}`);
    const lyrebirdBin = path.join(torDestDir, 'pluggable_transports', `lyrebird${ext}`);

    if (!isWindows) {
      if (existsSync(torBin)) chmodSync(torBin, 0o755);
      if (existsSync(lyrebirdBin)) chmodSync(lyrebirdBin, 0o755);
    }

    if (isDarwin) {
      for (const entry of readdirSync(torDestDir)) {
        if (!entry.endsWith('.dylib')) continue;
        const dylibPath = path.join(torDestDir, entry);
        if (statSync(dylibPath).isFile()) {
          codesignAdHoc(dylibPath, execFileSyncFn);
        }
      }
      if (existsSync(torBin)) codesignAdHoc(torBin, execFileSyncFn);
      if (existsSync(lyrebirdBin)) codesignAdHoc(lyrebirdBin, execFileSyncFn);
    }

    return { flavor, targetTriple, torDestDir, sidecarPath };
  }

  // Local / Tunnel flavor
  await rm(torDestDir, { recursive: true, force: true });
  const cfSrc = path.join(cloudflaredSourceDir, `cloudflared${ext}`);
  if (!existsSync(cfSrc)) {
    throw new Error(`cloudflared binary not found at ${cfSrc}`);
  }
  const cfDest = path.join(binariesDir, `cloudflared-${targetTriple}${ext}`);
  copyFileSync(cfSrc, cfDest);
  if (!isWindows) {
    chmodSync(cfDest, 0o755);
  }
  if (isDarwin) {
    codesignAdHoc(cfDest, execFileSyncFn);
  }

  return { flavor, targetTriple, cloudflaredDest: cfDest, sidecarPath };
}

/**
 * Re-applies macOS ad-hoc signatures across embedded binaries inside `.app`
 * and verifies integrity with `codesign --verify --deep --strict`.
 */
export function verifyMacOsAdHocSignatures({
  appPath,
  flavor = 'local',
  execFileSyncFn = execFileSync,
} = {}) {
  const macOsDir = path.join(appPath, 'Contents', 'MacOS');
  const resourcesDir = path.join(appPath, 'Contents', 'Resources');

  if (existsSync(macOsDir)) {
    for (const entry of readdirSync(macOsDir)) {
      const candidate = path.join(macOsDir, entry);
      if (statSync(candidate).isFile()) {
        codesignAdHoc(candidate, execFileSyncFn);
      }
    }
  }

  if (flavor === 'tor') {
    const torDir = path.join(resourcesDir, 'tor');
    if (existsSync(torDir)) {
      for (const entry of readdirSync(torDir)) {
        if (!entry.endsWith('.dylib')) continue;
        const dylib = path.join(torDir, entry);
        if (statSync(dylib).isFile()) {
          codesignAdHoc(dylib, execFileSyncFn);
        }
      }
      const torBin = path.join(torDir, 'tor');
      if (existsSync(torBin)) codesignAdHoc(torBin, execFileSyncFn);
      const lyrebird = path.join(torDir, 'pluggable_transports', 'lyrebird');
      if (existsSync(lyrebird)) codesignAdHoc(lyrebird, execFileSyncFn);
    }
  }

  codesignAdHoc(appPath, execFileSyncFn);
  execFileSyncFn('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
}

/**
 * Creates a portable `.zip` package (used for Windows x64 portable builds or offline archives).
 */
export async function createPortableZip({
  sourceDir,
  outZipPath,
  platform = process.platform,
  execFileSyncFn = execFileSync,
} = {}) {
  await mkdir(path.dirname(outZipPath), { recursive: true });
  await rm(outZipPath, { force: true });

  if (platform === 'win32') {
    const psCmd = `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${outZipPath.replace(/'/g, "''")}' -Force`;
    execFileSyncFn('powershell.exe', ['-NoProfile', '-Command', psCmd], { stdio: 'inherit' });
  } else {
    execFileSyncFn('zip', ['-r', '-q', outZipPath, '.'], {
      cwd: sourceDir,
      stdio: 'inherit',
    });
  }

  return outZipPath;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return;
  }

  const targetTriple = resolveRustTargetTriple(process.platform, process.arch, opts.target);

  if (opts.dryRun) {
    console.log(`Flavor:        ${opts.flavor}`);
    console.log(`Target triple: ${targetTriple}`);
    console.log(`Tauri config:  ${opts.flavor === 'tor' ? 'src-tauri/tauri.tor.conf.json' : 'src-tauri/tauri.local.conf.json'}`);
    console.log(`Cargo feature: ${opts.flavor === 'tor' ? 'flavor-tor' : 'flavor-local'}`);
    console.log(`Sample zip:    ${formatReleaseArtifactName({ flavor: opts.flavor, version: opts.version, targetTriple, ext: 'zip' })}`);
    return;
  }

  if (opts.appPath) {
    verifyMacOsAdHocSignatures({ appPath: opts.appPath, flavor: opts.flavor });
    console.log(`Verified macOS ad-hoc signature for ${opts.appPath}`);
    return;
  }

  if (opts.portableSourceDir) {
    const outZipPath =
      opts.outZipPath ??
      path.resolve(
        process.cwd(),
        'dist-packages',
        formatReleaseArtifactName({
          flavor: opts.flavor,
          version: opts.version,
          targetTriple,
          ext: 'zip',
        }),
      );
    await createPortableZip({ sourceDir: opts.portableSourceDir, outZipPath });
    console.log(`Portable package created at ${outZipPath}`);
    return;
  }

  await stageFlavorResources({
    flavor: opts.flavor,
    targetTriple,
    torSourceDir: opts.torSourceDir,
    cloudflaredSourceDir: opts.cloudflaredSourceDir,
    tauriDir: opts.tauriDir,
  });
  console.log(`Staged ${opts.flavor} resources for ${targetTriple}`);
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
