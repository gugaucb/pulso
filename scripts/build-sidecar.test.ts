// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NODE_SEA_SENTINEL_FUSE,
  buildEsbuildOptions,
  buildSeaConfig,
  buildSidecarExecutable,
  injectSeaBlobWithPostject,
  parseArgs,
  resolveRustTargetTriple,
  selectSeaBuildStrategy,
  sidecarBinaryName,
  signMacOsSeaExecutable,
} from './build-sidecar.mjs';

describe('scripts/build-sidecar.mjs', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-build-sidecar-'));
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

  it('maps OS/arch and short aliases to Tauri externalBin Rust target triples and binary names', () => {
    expect(resolveRustTargetTriple('darwin', 'arm64')).toBe('aarch64-apple-darwin');
    expect(resolveRustTargetTriple('darwin', 'x64')).toBe('x86_64-apple-darwin');
    expect(resolveRustTargetTriple('linux', 'x64')).toBe('x86_64-unknown-linux-gnu');
    expect(resolveRustTargetTriple('linux', 'arm64')).toBe('aarch64-unknown-linux-gnu');
    expect(resolveRustTargetTriple('win32', 'x64')).toBe('x86_64-pc-windows-msvc');

    expect(resolveRustTargetTriple('linux', 'x64', 'macos-arm64')).toBe('aarch64-apple-darwin');
    expect(resolveRustTargetTriple('linux', 'x64', 'macos-x64')).toBe('x86_64-apple-darwin');
    expect(resolveRustTargetTriple('linux', 'x64', 'windows-x64')).toBe('x86_64-pc-windows-msvc');
    expect(resolveRustTargetTriple('linux', 'x64', 'linux-x64')).toBe('x86_64-unknown-linux-gnu');
    expect(resolveRustTargetTriple('linux', 'x64', 'linux-arm64')).toBe('aarch64-unknown-linux-gnu');
    expect(resolveRustTargetTriple('linux', 'x64', 'aarch64-apple-darwin')).toBe('aarch64-apple-darwin');

    expect(sidecarBinaryName('aarch64-apple-darwin')).toBe('pulso-sidecar-aarch64-apple-darwin');
    expect(sidecarBinaryName('x86_64-pc-windows-msvc')).toBe('pulso-sidecar-x86_64-pc-windows-msvc.exe');
    expect(() => resolveRustTargetTriple('freebsd', 'x64')).toThrow(/Unsupported target/i);
  });

  it('selects postject for Node 22 LTS and --build-sea for Node 25.5+/26 and produces valid SEA config & esbuild options', () => {
    expect(selectSeaBuildStrategy('22.14.0')).toBe('postject');
    expect(selectSeaBuildStrategy('25.4.0')).toBe('postject');
    expect(selectSeaBuildStrategy('25.5.0')).toBe('build-sea');
    expect(selectSeaBuildStrategy('26.11.1')).toBe('build-sea');

    expect(
      buildSeaConfig({
        strategy: 'postject',
        mainBundlePath: '/tmp/sidecar.cjs',
        blobPath: '/tmp/sea-prep.blob',
        outputPath: '/tmp/pulso-sidecar-x86_64-unknown-linux-gnu',
      }),
    ).toEqual({
      main: '/tmp/sidecar.cjs',
      output: '/tmp/sea-prep.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    });

    expect(
      buildSeaConfig({
        strategy: 'build-sea',
        mainBundlePath: '/tmp/sidecar.cjs',
        blobPath: '/tmp/sea-prep.blob',
        outputPath: '/tmp/pulso-sidecar-aarch64-apple-darwin',
      }),
    ).toEqual({
      main: '/tmp/sidecar.cjs',
      output: '/tmp/pulso-sidecar-aarch64-apple-darwin',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    });

    expect(
      buildEsbuildOptions({
        entryPoint: 'server/sidecar.ts',
        outfile: 'dist/sidecar/pulso-sidecar.cjs',
      }),
    ).toMatchObject({
      entryPoints: ['server/sidecar.ts'],
      outfile: 'dist/sidecar/pulso-sidecar.cjs',
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      packages: 'bundle',
    });
  });

  it('parses CLI flags (--bundle-only, --dry-run, --target, --out-dir) and runs macOS codesign + postject flow', () => {
    const opts = parseArgs(['--target', 'macos-arm64', '--bundle-only', '--dry-run', '--out-dir', 'custom-bin']);
    expect(opts.target).toBe('macos-arm64');
    expect(opts.bundleOnly).toBe(true);
    expect(opts.dryRun).toBe(true);
    expect(opts.outDir).toMatch(/custom-bin$/);

    const dir = makeTempDir();
    const fakeNode = join(dir, 'node');
    const fakeBlob = join(dir, 'sea-prep.blob');
    const outBin = join(dir, 'pulso-sidecar-aarch64-apple-darwin');
    writeFileSync(fakeNode, 'node-binary', 'utf8');
    writeFileSync(fakeBlob, 'blob-bytes', 'utf8');

    const execMock = vi.fn();
    injectSeaBlobWithPostject({
      nodeBinaryPath: fakeNode,
      outputPath: outBin,
      blobPath: fakeBlob,
      targetTriple: 'aarch64-apple-darwin',
      execFileSyncFn: execMock as unknown as typeof import('node:child_process').execFileSync,
    });

    expect(execMock).toHaveBeenNthCalledWith(1, 'codesign', ['--remove-signature', outBin], {
      stdio: 'ignore',
    });
    expect(execMock).toHaveBeenNthCalledWith(
      2,
      'postject',
      [
        outBin,
        'NODE_SEA_BLOB',
        fakeBlob,
        '--sentinel-fuse',
        NODE_SEA_SENTINEL_FUSE,
        '--macho-segment-name',
        'NODE_SEA',
      ],
      { stdio: 'inherit' },
    );
    expect(execMock).toHaveBeenNthCalledWith(3, 'codesign', ['-s', '-', '--force', outBin], {
      stdio: 'ignore',
    });

    const signExec = vi.fn();
    signMacOsSeaExecutable(outBin, {
      removeExistingSignature: true,
      execFileSyncFn: signExec as unknown as typeof import('node:child_process').execFileSync,
    });
    expect(signExec).toHaveBeenNthCalledWith(1, 'codesign', ['--remove-signature', outBin], {
      stdio: 'ignore',
    });
    expect(signExec).toHaveBeenNthCalledWith(2, 'codesign', ['-s', '-', '--force', outBin], {
      stdio: 'ignore',
    });
  });

  it('orchestrates buildSidecarExecutable for --bundle-only and --build-sea (Node 26) with macOS codesign', async () => {
    const dir = makeTempDir();
    const outDir = join(dir, 'binaries');
    const bundleOut = join(dir, 'bundle', 'pulso-sidecar.cjs');

    const bundleResult = await buildSidecarExecutable({
      targetTriple: 'x86_64-unknown-linux-gnu',
      outDir,
      bundleOut,
      bundleOnly: true,
      esbuildFn: vi.fn(async () => ({ errors: [], warnings: [] })) as never,
    });
    expect(bundleResult.bundleOnly).toBe(true);

    const execMock = vi.fn((_cmd: string, args: string[]) => {
      if (args[0] === '--build-sea') {
        writeFileSync(join(outDir, 'pulso-sidecar-aarch64-apple-darwin'), 'sea-bin', 'utf8');
      }
      return '';
    });

    const seaResult = await buildSidecarExecutable({
      targetTriple: 'aarch64-apple-darwin',
      outDir,
      bundleOut,
      nodeVersion: '26.11.1',
      nodeBinaryPath: '/usr/local/bin/node',
      esbuildFn: vi.fn(async () => ({ errors: [], warnings: [] })) as never,
      execFileSyncFn: execMock as unknown as typeof import('node:child_process').execFileSync,
    });

    expect(seaResult.strategy).toBe('build-sea');
    expect(seaResult.outputPath).toBe(join(outDir, 'pulso-sidecar-aarch64-apple-darwin'));
    expect(execMock).toHaveBeenCalledWith(
      '/usr/local/bin/node',
      ['--build-sea', expect.stringMatching(/sea-config\.json$/)],
      { stdio: 'inherit' },
    );
    expect(execMock).toHaveBeenCalledWith(
      'codesign',
      ['--remove-signature', seaResult.outputPath],
      { stdio: 'ignore' },
    );
    expect(execMock).toHaveBeenCalledWith(
      'codesign',
      ['-s', '-', '--force', seaResult.outputPath],
      { stdio: 'ignore' },
    );
  });
});
