#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { isDirectExecution } from './lib/cli-utils.mjs';

export const SIDECAR_ENTRYPOINT = 'server/sidecar.ts';
export const SIDECAR_BINARY_PREFIX = 'pulso-sidecar';
export const NODE_SEA_SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const SHORT_TARGET_ALIASES = new Map([
  ['macos-arm64', 'aarch64-apple-darwin'],
  ['macos-aarch64', 'aarch64-apple-darwin'],
  ['darwin-arm64', 'aarch64-apple-darwin'],
  ['macos-x64', 'x86_64-apple-darwin'],
  ['macos-x86_64', 'x86_64-apple-darwin'],
  ['darwin-x64', 'x86_64-apple-darwin'],
  ['linux-x64', 'x86_64-unknown-linux-gnu'],
  ['linux-x86_64', 'x86_64-unknown-linux-gnu'],
  ['linux-amd64', 'x86_64-unknown-linux-gnu'],
  ['linux-arm64', 'aarch64-unknown-linux-gnu'],
  ['linux-aarch64', 'aarch64-unknown-linux-gnu'],
  ['windows-x64', 'x86_64-pc-windows-msvc'],
  ['windows-amd64', 'x86_64-pc-windows-msvc'],
  ['windows-x86_64', 'x86_64-pc-windows-msvc'],
  ['win32-x64', 'x86_64-pc-windows-msvc'],
]);

const SUPPORTED_RUST_TRIPLES = new Set([
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-gnu',
  'x86_64-pc-windows-msvc',
]);

/**
 * Resolves the Tauri `externalBin` Rust target triple from OS/arch or an explicit override.
 */
export function resolveRustTargetTriple(
  platform = process.platform,
  arch = process.arch,
  targetOverride = null,
) {
  if (targetOverride) {
    const normalized = String(targetOverride).trim();
    if (SUPPORTED_RUST_TRIPLES.has(normalized)) {
      return normalized;
    }
    const aliased = SHORT_TARGET_ALIASES.get(normalized);
    if (aliased) {
      return aliased;
    }
    throw new Error(`Unsupported target triple or alias: ${normalized}`);
  }

  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  throw new Error(`Unsupported target platform/arch for PULSO sidecar: ${platform}/${arch}`);
}

export function sidecarBinaryName(targetTriple) {
  const ext = targetTriple.includes('windows') ? '.exe' : '';
  return `${SIDECAR_BINARY_PREFIX}-${targetTriple}${ext}`;
}

export function parseNodeSemver(version = process.versions.node) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
  if (!match) {
    throw new Error(`Unable to parse Node.js version: ${version}`);
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

/**
 * Chooses `--build-sea` on Node 25.5+/26+ and `--experimental-sea-config` + `postject` on Node 22 LTS.
 */
export function selectSeaBuildStrategy(nodeVersion = process.versions.node) {
  const { major, minor } = parseNodeSemver(nodeVersion);
  if (major > 25 || (major === 25 && minor >= 5)) {
    return 'build-sea';
  }
  return 'postject';
}

export function buildSeaConfig({
  strategy,
  mainBundlePath,
  blobPath,
  outputPath,
  executablePath = null,
}) {
  if (strategy === 'build-sea') {
    const config = {
      main: mainBundlePath,
      output: outputPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    };
    if (executablePath) {
      config.executable = executablePath;
    }
    return config;
  }

  return {
    main: mainBundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  };
}

export function buildEsbuildOptions({
  entryPoint = SIDECAR_ENTRYPOINT,
  outfile,
}) {
  return {
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    packages: 'bundle',
    sourcemap: false,
    logLevel: 'warning',
  };
}

export function parseArgs(argv) {
  const opts = {
    help: false,
    dryRun: false,
    bundleOnly: false,
    target: null,
    outDir: path.resolve(process.cwd(), 'src-tauri', 'binaries'),
    bundleOut: path.resolve(process.cwd(), 'dist', 'sidecar', 'pulso-sidecar.cjs'),
    nodeBin: process.execPath,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--bundle-only') {
      opts.bundleOnly = true;
    } else if (arg === '--target' && argv[i + 1]) {
      opts.target = argv[++i];
    } else if (arg === '--out-dir' && argv[i + 1]) {
      opts.outDir = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--bundle-out' && argv[i + 1]) {
      opts.bundleOut = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--node-bin' && argv[i + 1]) {
      opts.nodeBin = path.resolve(process.cwd(), argv[++i]);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return opts;
}

export function printHelp() {
  console.log(`PULSO Node.js SEA Sidecar Builder

Usage:
  node scripts/build-sidecar.mjs [options]

Options:
  --target <triple|alias>    Target triple or alias (macos-arm64, macos-x64, windows-x64, linux-x64, linux-arm64)
  --out-dir <dir>            Destination directory for Tauri externalBin (default: src-tauri/binaries)
  --bundle-out <file>        CJS bundle output path (default: dist/sidecar/pulso-sidecar.cjs)
  --node-bin <path>          Path to Node.js binary used to assemble SEA (default: process.execPath)
  --bundle-only              Run only the esbuild CJS bundle step without building SEA
  --dry-run                  Print build plan without executing esbuild or SEA packaging
  -h, --help                 Show this help message`);
}

export function signMacOsSeaExecutable(
  binaryPath,
  { removeExistingSignature = true, execFileSyncFn = execFileSync } = {},
) {
  if (removeExistingSignature) {
    try {
      execFileSyncFn('codesign', ['--remove-signature', binaryPath], { stdio: 'ignore' });
    } catch {
      // Binary may already be unsigned
    }
  }
  execFileSyncFn('codesign', ['-s', '-', '--force', binaryPath], { stdio: 'ignore' });
}

function resolvePostjectExecutable(cwd = process.cwd()) {
  const localName = process.platform === 'win32' ? 'postject.cmd' : 'postject';
  const localPath = path.join(cwd, 'node_modules', '.bin', localName);
  return existsSync(localPath) ? localPath : 'postject';
}

export function injectSeaBlobWithPostject({
  nodeBinaryPath,
  outputPath,
  blobPath,
  targetTriple,
  execFileSyncFn = execFileSync,
  copyFileSyncFn = copyFileSync,
  chmodSyncFn = chmodSync,
  postjectCommand = resolvePostjectExecutable(),
}) {
  copyFileSyncFn(nodeBinaryPath, outputPath);
  const isWindows = targetTriple.includes('windows');
  const isDarwin = targetTriple.includes('apple-darwin');

  if (!isWindows) {
    chmodSyncFn(outputPath, 0o755);
  }

  if (isDarwin) {
    try {
      execFileSyncFn('codesign', ['--remove-signature', outputPath], { stdio: 'ignore' });
    } catch {
      // Ignore if binary has no signature
    }
  }

  const postjectArgs = [
    outputPath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    NODE_SEA_SENTINEL_FUSE,
    ...(isDarwin ? ['--macho-segment-name', 'NODE_SEA'] : []),
  ];
  execFileSyncFn(postjectCommand, postjectArgs, { stdio: 'inherit' });

  if (isDarwin) {
    signMacOsSeaExecutable(outputPath, {
      removeExistingSignature: false,
      execFileSyncFn,
    });
  }
}

export async function buildSidecarExecutable({
  targetTriple,
  outDir,
  bundleOut,
  nodeBinaryPath = process.execPath,
  nodeVersion = process.versions.node,
  bundleOnly = false,
  dryRun = false,
  esbuildFn = esbuild,
  execFileSyncFn = execFileSync,
} = {}) {
  const strategy = selectSeaBuildStrategy(nodeVersion);
  const binaryName = sidecarBinaryName(targetTriple);
  const outputPath = path.join(outDir, binaryName);
  const esbuildOptions = buildEsbuildOptions({
    entryPoint: SIDECAR_ENTRYPOINT,
    outfile: bundleOut,
  });

  if (dryRun) {
    return {
      dryRun: true,
      targetTriple,
      strategy,
      bundleOut,
      outputPath,
      bundleOnly,
    };
  }

  await mkdir(path.dirname(bundleOut), { recursive: true });
  await esbuildFn(esbuildOptions);

  if (bundleOnly) {
    return {
      dryRun: false,
      bundleOnly: true,
      targetTriple,
      strategy,
      bundleOut,
      outputPath,
    };
  }

  await mkdir(outDir, { recursive: true });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'pulso-sea-'));

  try {
    const seaConfigPath = path.join(tempDir, 'sea-config.json');
    const blobPath = path.join(tempDir, 'sea-prep.blob');
    const config = buildSeaConfig({
      strategy,
      mainBundlePath: bundleOut,
      blobPath,
      outputPath,
      executablePath: nodeBinaryPath !== process.execPath ? nodeBinaryPath : null,
    });
    await writeFile(seaConfigPath, JSON.stringify(config, null, 2), 'utf8');

    if (strategy === 'build-sea') {
      execFileSyncFn(nodeBinaryPath, ['--build-sea', seaConfigPath], { stdio: 'inherit' });
      if (!targetTriple.includes('windows')) {
        chmodSync(outputPath, 0o755);
      }
      if (targetTriple.includes('apple-darwin') || process.platform === 'darwin') {
        signMacOsSeaExecutable(outputPath, {
          removeExistingSignature: true,
          execFileSyncFn,
        });
      }
    } else {
      execFileSyncFn(nodeBinaryPath, ['--experimental-sea-config', seaConfigPath], {
        stdio: 'inherit',
      });
      injectSeaBlobWithPostject({
        nodeBinaryPath,
        outputPath,
        blobPath,
        targetTriple,
        execFileSyncFn,
      });
    }

    return {
      dryRun: false,
      bundleOnly: false,
      targetTriple,
      strategy,
      bundleOut,
      outputPath,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return;
  }

  const targetTriple = resolveRustTargetTriple(process.platform, process.arch, opts.target);
  const result = await buildSidecarExecutable({
    targetTriple,
    outDir: opts.outDir,
    bundleOut: opts.bundleOut,
    nodeBinaryPath: opts.nodeBin,
    bundleOnly: opts.bundleOnly,
    dryRun: opts.dryRun,
  });

  if (result.dryRun) {
    console.log(`Target triple: ${result.targetTriple}`);
    console.log(`SEA strategy:  ${result.strategy}`);
    console.log(`Bundle out:    ${result.bundleOut}`);
    console.log(`Sidecar out:   ${result.outputPath}`);
    console.log(`Bundle only:   ${result.bundleOnly}`);
    return;
  }

  if (result.bundleOnly) {
    console.log(`Sidecar CJS bundle written to ${result.bundleOut}`);
    return;
  }

  console.log(`PULSO Node.js SEA sidecar ready at ${result.outputPath}`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
