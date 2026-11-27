// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMacOsDmg,
  createPortableZip,
  formatReleaseArtifactName,
  parseArgs,
  stageFlavorResources,
  verifyMacOsAdHocSignatures,
} from './package-desktop.mjs';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('scripts/package-desktop.mjs', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stages Tor flavor without cloudflared or conjure-client and ad-hoc signs macOS binaries', async () => {
    const root = makeTempDir('pulso-pkg-tor-');
    const torSourceDir = path.join(root, '.tor-bin', 'tor');
    const tauriDir = path.join(root, 'src-tauri');
    const binariesDir = path.join(tauriDir, 'binaries');
    mkdirSync(path.join(torSourceDir, 'pluggable_transports'), { recursive: true });
    mkdirSync(binariesDir, { recursive: true });

    writeFileSync(path.join(torSourceDir, 'tor'), 'tor-bin');
    writeFileSync(path.join(torSourceDir, 'libevent-2.1.7.dylib'), 'dylib');
    writeFileSync(path.join(torSourceDir, 'pluggable_transports', 'lyrebird'), 'lyrebird');
    writeFileSync(path.join(torSourceDir, 'pluggable_transports', 'conjure-client'), 'experimental');
    writeFileSync(path.join(binariesDir, 'pulso-sidecar-aarch64-apple-darwin'), 'sidecar');
    // Stale cloudflared from a previous local build must be cleaned
    writeFileSync(path.join(binariesDir, 'cloudflared-aarch64-apple-darwin'), 'stale-cf');

    const execSpy = vi.fn();

    await stageFlavorResources({
      flavor: 'tor',
      targetTriple: 'aarch64-apple-darwin',
      torSourceDir,
      tauriDir,
      execFileSyncFn: execSpy,
    });

    expect(existsSync(path.join(tauriDir, 'resources', 'tor', 'tor'))).toBe(true);
    expect(existsSync(path.join(tauriDir, 'resources', 'tor', 'pluggable_transports', 'lyrebird'))).toBe(true);
    expect(
      existsSync(path.join(tauriDir, 'resources', 'tor', 'pluggable_transports', 'conjure-client')),
    ).toBe(false);
    expect(existsSync(path.join(binariesDir, 'cloudflared-aarch64-apple-darwin'))).toBe(false);

    const signedTargets = execSpy.mock.calls.map((call) => call[1][3]);
    expect(signedTargets).toEqual(
      expect.arrayContaining([
        path.join(tauriDir, 'resources', 'tor', 'libevent-2.1.7.dylib'),
        path.join(tauriDir, 'resources', 'tor', 'tor'),
        path.join(tauriDir, 'resources', 'tor', 'pluggable_transports', 'lyrebird'),
        path.join(binariesDir, 'pulso-sidecar-aarch64-apple-darwin'),
      ]),
    );
  });

  it('stages Local flavor with cloudflared and removes any stale tor resources', async () => {
    const root = makeTempDir('pulso-pkg-local-');
    const cloudflaredSourceDir = path.join(root, '.cloudflared-bin');
    const tauriDir = path.join(root, 'src-tauri');
    const binariesDir = path.join(tauriDir, 'binaries');
    const staleTorDir = path.join(tauriDir, 'resources', 'tor');
    mkdirSync(cloudflaredSourceDir, { recursive: true });
    mkdirSync(binariesDir, { recursive: true });
    mkdirSync(staleTorDir, { recursive: true });

    writeFileSync(path.join(cloudflaredSourceDir, 'cloudflared.exe'), 'cf-exe');
    writeFileSync(path.join(binariesDir, 'pulso-sidecar-x86_64-pc-windows-msvc.exe'), 'sidecar');
    writeFileSync(path.join(staleTorDir, 'tor.exe'), 'stale-tor');

    await stageFlavorResources({
      flavor: 'local',
      targetTriple: 'x86_64-pc-windows-msvc',
      cloudflaredSourceDir,
      tauriDir,
    });

    expect(existsSync(path.join(binariesDir, 'cloudflared-x86_64-pc-windows-msvc.exe'))).toBe(true);
    expect(existsSync(staleTorDir)).toBe(false);
  });

  it('verifies and re-signs macOS .app bundle contents and runs codesign --verify --deep --strict', () => {
    const root = makeTempDir('pulso-pkg-verify-');
    const appPath = path.join(root, 'PULSO Tor.app');
    const macOsDir = path.join(appPath, 'Contents', 'MacOS');
    const torResDir = path.join(appPath, 'Contents', 'Resources', 'tor');
    mkdirSync(macOsDir, { recursive: true });
    mkdirSync(path.join(torResDir, 'pluggable_transports'), { recursive: true });

    writeFileSync(path.join(macOsDir, 'PULSO Tor'), 'main');
    writeFileSync(path.join(macOsDir, 'pulso-sidecar'), 'sidecar');
    writeFileSync(path.join(torResDir, 'tor'), 'tor');
    writeFileSync(path.join(torResDir, 'libcrypto.dylib'), 'dylib');
    writeFileSync(path.join(torResDir, 'pluggable_transports', 'lyrebird'), 'lyrebird');

    const execSpy = vi.fn();
    verifyMacOsAdHocSignatures({
      appPath,
      flavor: 'tor',
      execFileSyncFn: execSpy,
    });

    expect(execSpy).toHaveBeenCalledWith(
      'codesign',
      ['-s', '-', '--force', path.join(torResDir, 'pluggable_transports', 'lyrebird')],
      { stdio: 'ignore' },
    );
    expect(execSpy).toHaveBeenCalledWith(
      'codesign',
      ['-s', '-', '--force', appPath],
      { stdio: 'ignore' },
    );
    expect(execSpy).toHaveBeenCalledWith(
      'codesign',
      ['--verify', '--deep', '--strict', appPath],
      { stdio: 'inherit' },
    );
  });

  it('formats standardized release artifact names and creates portable zip packages', async () => {
    expect(
      formatReleaseArtifactName({
        flavor: 'tor',
        version: '0.1.0',
        targetTriple: 'x86_64-pc-windows-msvc',
        ext: 'zip',
      }),
    ).toBe('pulso-tor-v0.1.0-windows-x64.zip');

    expect(
      formatReleaseArtifactName({
        flavor: 'local',
        version: 'v0.1.0',
        targetTriple: 'aarch64-apple-darwin',
        ext: 'dmg',
      }),
    ).toBe('pulso-local-v0.1.0-macos-arm64.dmg');

    const root = makeTempDir('pulso-pkg-zip-');
    const sourceDir = path.join(root, 'bundle');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'PULSO Tor.exe'), 'exe');
    const outZipPath = path.join(root, 'out', 'pulso-tor-v0.1.0-windows-x64.zip');

    const execSpy = vi.fn();
    await createPortableZip({
      sourceDir,
      outZipPath,
      platform: 'linux',
      execFileSyncFn: execSpy,
    });

    expect(execSpy).toHaveBeenCalledWith(
      'zip',
      ['-r', '-q', outZipPath, '.'],
      expect.objectContaining({ cwd: sourceDir }),
    );
  });

  it('parses CLI options cleanly', () => {
    const opts = parseArgs([
      '--flavor',
      'tor',
      '--target',
      'macos-arm64',
      '--create-dmg',
      '/tmp/PULSO Tor.app',
      '--out-dmg',
      '/tmp/out.dmg',
      '--dry-run',
    ]);
    expect(opts.flavor).toBe('tor');
    expect(opts.target).toBe('macos-arm64');
    expect(opts.createDmgAppPath).toBe('/tmp/PULSO Tor.app');
    expect(opts.outDmgPath).toBe('/tmp/out.dmg');
    expect(opts.dryRun).toBe(true);
  });

  it('creates a macOS .dmg from an already-signed .app bundle via hdiutil create', async () => {
    const root = makeTempDir('pulso-pkg-dmg-');
    const appPath = path.join(root, 'PULSO Tor.app');
    mkdirSync(path.join(appPath, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(path.join(appPath, 'Contents', 'MacOS', 'PULSO Tor'), 'signed-bin');
    const outDmgPath = path.join(root, 'dist-packages', 'pulso-tor-v0.1.0-macos-arm64.dmg');

    const commands: Array<{ cmd: string; args: string[] }> = [];
    let observedStagedAppExists = false;
    const execSpy = vi.fn((cmd: string, args: string[]) => {
      commands.push({ cmd, args });
      if (cmd === 'ditto') {
        mkdirSync(args[1]!, { recursive: true });
      }
      if (cmd === 'hdiutil') {
        const srcFolderIdx = args.indexOf('-srcfolder');
        const stageDir = args[srcFolderIdx + 1]!;
        observedStagedAppExists = existsSync(path.join(stageDir, 'PULSO Tor.app'));
        writeFileSync(outDmgPath, 'dmg-bytes');
      }
      return '';
    });

    const createdPath = await createMacOsDmg({
      appPath,
      outDmgPath,
      volumeName: 'PULSO Tor',
      execFileSyncFn: execSpy,
    });

    expect(createdPath).toBe(outDmgPath);
    expect(observedStagedAppExists).toBe(true);
    expect(existsSync(outDmgPath)).toBe(true);
    expect(commands.map((c) => c.cmd)).toEqual(['ditto', 'hdiutil']);
    expect(commands[1]!.args).toEqual(
      expect.arrayContaining([
        'create',
        '-volname',
        'PULSO Tor',
        '-ov',
        '-format',
        'UDZO',
        outDmgPath,
      ]),
    );
  });
});
