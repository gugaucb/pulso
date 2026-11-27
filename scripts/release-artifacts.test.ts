// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLatestReleaseManifest } from '../src/desktop/tauriBridge.ts';
import {
  buildReleaseManifest,
  collectAndRenameArtifacts,
  generateReleaseOutputs,
  generateSha256Sums,
  getStandardizedArtifactName,
  normalizeVersion,
  parseArgs,
  parseArtifactFilename,
  signSha256Sums,
  verifySha256Sums,
} from './release-artifacts.mjs';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function parseWorkflowYaml(relativePath: string): { raw: string; parsed: Record<string, unknown> } {
  const fullPath = path.resolve(process.cwd(), relativePath);
  const raw = readFileSync(fullPath, 'utf8');
  const jsonStr = execFileSync(
    'python3',
    [
      '-c',
      'import sys, json, yaml; d = yaml.safe_load(sys.stdin.read()); print(json.dumps({str(k): v for k, v in d.items()}))',
    ],
    { input: raw, encoding: 'utf8' },
  );
  return { raw, parsed: JSON.parse(jsonStr) as Record<string, unknown> };
}

describe('scripts/release-artifacts.mjs', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe('Slice 1: standardized artifact naming & collection', () => {
    it('normalizes versions and formats standardized pulso-tor and pulso-local artifact names', () => {
      expect(normalizeVersion('v0.1.0')).toBe('0.1.0');
      expect(normalizeVersion('0.2.3-rc.1')).toBe('0.2.3-rc.1');
      expect(() => normalizeVersion('../evil')).toThrow();

      expect(
        getStandardizedArtifactName({
          flavor: 'tor',
          version: 'v1.2.0',
          target: 'aarch64-apple-darwin',
          ext: 'dmg',
        }),
      ).toBe('pulso-tor-v1.2.0-macos-arm64.dmg');

      expect(
        getStandardizedArtifactName({
          flavor: 'local',
          version: '1.2.0',
          target: 'x86_64-pc-windows-msvc',
          ext: 'exe',
        }),
      ).toBe('pulso-local-v1.2.0-windows-x64.exe');

      expect(
        getStandardizedArtifactName({
          flavor: 'tor',
          version: '1.2.0',
          target: 'aarch64-unknown-linux-gnu',
          ext: 'AppImage',
        }),
      ).toBe('pulso-tor-v1.2.0-linux-arm64.AppImage');
    });

    it('parses standardized artifact filenames into flavor, version, os, arch, and ext', () => {
      expect(parseArtifactFilename('pulso-tor-v0.1.0-linux-x64.AppImage')).toEqual({
        name: 'pulso-tor-v0.1.0-linux-x64.AppImage',
        flavor: 'tor',
        version: '0.1.0',
        os: 'linux',
        arch: 'x64',
        ext: 'AppImage',
      });
      expect(parseArtifactFilename('pulso-local-v0.1.0-windows-x64.zip')).toEqual({
        name: 'pulso-local-v0.1.0-windows-x64.zip',
        flavor: 'local',
        version: '0.1.0',
        os: 'windows',
        arch: 'x64',
        ext: 'zip',
      });
      expect(parseArtifactFilename('SHA256SUMS')).toBeNull();
    });

    it('collects Tauri bundle artifacts into standardized filenames and supports dry-run', async () => {
      const root = makeTempDir('pulso-rel-collect-');
      const bundleDir = path.join(root, 'target', 'x86_64-pc-windows-msvc', 'release', 'bundle');
      const nsisDir = path.join(bundleDir, 'nsis');
      const portableDir = path.join(root, 'dist-packages');
      const outDir = path.join(root, 'release-out');
      mkdirSync(nsisDir, { recursive: true });
      mkdirSync(portableDir, { recursive: true });

      writeFileSync(path.join(nsisDir, 'PULSO Tor_0.1.0_x64-setup.exe'), 'installer-bytes');
      writeFileSync(path.join(nsisDir, 'PULSO Tor_0.1.0_x64-setup.exe.sig'), 'ignore-sig');
      writeFileSync(path.join(portableDir, 'pulso-tor-v0.1.0-windows-x64.zip'), 'zip-bytes');

      const dryPlan = await collectAndRenameArtifacts({
        inputDirs: [bundleDir, portableDir],
        outputDir: outDir,
        flavor: 'tor',
        version: 'v0.1.0',
        target: 'x86_64-pc-windows-msvc',
        dryRun: true,
      });

      expect(dryPlan.map((entry) => entry.targetName).sort()).toEqual([
        'pulso-tor-v0.1.0-windows-x64.exe',
        'pulso-tor-v0.1.0-windows-x64.zip',
      ]);
      expect(existsSync(outDir)).toBe(false);

      const results = await collectAndRenameArtifacts({
        inputDirs: [bundleDir, portableDir],
        outputDir: outDir,
        flavor: 'tor',
        version: 'v0.1.0',
        target: 'x86_64-pc-windows-msvc',
        dryRun: false,
      });

      expect(results).toHaveLength(2);
      expect(existsSync(path.join(outDir, 'pulso-tor-v0.1.0-windows-x64.exe'))).toBe(true);
      expect(existsSync(path.join(outDir, 'pulso-tor-v0.1.0-windows-x64.zip'))).toBe(true);
    });
  });

  describe('Slice 2: SHA256SUMS generation, verification & optional PGP signing', () => {
    it('generates deterministic SHA256SUMS excluding metadata files and verifies valid/tampered checksums', async () => {
      const root = makeTempDir('pulso-rel-sha-');
      writeFileSync(path.join(root, 'pulso-local-v0.1.0-linux-x64.deb'), 'abc');
      writeFileSync(path.join(root, 'pulso-tor-v0.1.0-macos-arm64.dmg'), 'hello');
      // Existing metadata files must never be hashed inside SHA256SUMS
      writeFileSync(path.join(root, 'SHA256SUMS'), 'old');
      writeFileSync(path.join(root, 'SHA256SUMS.asc'), 'old-sig');
      writeFileSync(path.join(root, 'pulso-release-key.asc'), 'old-pub-key');
      writeFileSync(path.join(root, 'release-manifest.json'), '{}');

      const { content, entries } = await generateSha256Sums({ dir: root });
      // Known SHA-256 literals for "abc" and "hello"
      expect(content).toBe(
        [
          'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  pulso-local-v0.1.0-linux-x64.deb',
          '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  pulso-tor-v0.1.0-macos-arm64.dmg',
          '',
        ].join('\n'),
      );
      expect(entries).toHaveLength(2);
      expect(readFileSync(path.join(root, 'SHA256SUMS'), 'utf8')).toBe(content);

      const verified = await verifySha256Sums({ dir: root });
      expect(verified.verifiedFiles).toEqual([
        'pulso-local-v0.1.0-linux-x64.deb',
        'pulso-tor-v0.1.0-macos-arm64.dmg',
      ]);

      // Tamper with a file -> verifySha256Sums must fail
      writeFileSync(path.join(root, 'pulso-tor-v0.1.0-macos-arm64.dmg'), 'tampered');
      await expect(verifySha256Sums({ dir: root })).rejects.toThrow(/SHA-256 mismatch/i);
    });

    it('skips PGP signing when key is absent and invokes gpg detached armor signing when key is provided', async () => {
      const root = makeTempDir('pulso-rel-pgp-');
      const checksumsPath = path.join(root, 'SHA256SUMS');
      const ascPath = path.join(root, 'SHA256SUMS.asc');
      writeFileSync(checksumsPath, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  pulso-tor-v0.1.0-macos-arm64.dmg\n');

      const skipped = await signSha256Sums({
        checksumsPath,
        ascPath,
        privateKeyArmored: '',
      });
      expect(skipped).toEqual({ signed: false, skipped: true, reason: 'no_private_key' });
      expect(existsSync(ascPath)).toBe(false);

      const gpgCalls: Array<{ cmd: string; args: string[] }> = [];
      const expectedPublicKeyPath = path.join(root, 'pulso-release-key.asc');
      const execSpy = vi.fn((cmd: string, args: string[]) => {
        gpgCalls.push({ cmd, args });
        if (args.includes('--detach-sign')) {
          const outIdx = args.indexOf('-o');
          writeFileSync(args[outIdx + 1]!, '-----BEGIN PGP SIGNATURE-----\nmock\n-----END PGP SIGNATURE-----\n');
        }
        if (args.includes('--export')) {
          const outIdx = args.indexOf('-o');
          writeFileSync(
            args[outIdx + 1]!,
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\nmock\n-----END PGP PUBLIC KEY BLOCK-----\n',
          );
        }
        return '';
      });

      const signed = await signSha256Sums({
        checksumsPath,
        ascPath,
        privateKeyArmored: '-----BEGIN PGP PRIVATE KEY BLOCK-----\nmock\n-----END PGP PRIVATE KEY BLOCK-----',
        passphrase: 'secret-passphrase',
        execFileSyncFn: execSpy,
      });

      expect(signed).toEqual({
        signed: true,
        skipped: false,
        ascPath,
        publicKeyPath: expectedPublicKeyPath,
      });
      expect(existsSync(ascPath)).toBe(true);
      expect(existsSync(expectedPublicKeyPath)).toBe(true);
      expect(gpgCalls.some((c) => c.cmd === 'gpg' && c.args.includes('--import'))).toBe(true);
      expect(
        gpgCalls.some(
          (c) =>
            c.cmd === 'gpg' &&
            c.args.includes('--detach-sign') &&
            c.args.includes('--armor') &&
            c.args.includes('--pinentry-mode'),
        ),
      ).toBe(true);
      expect(
        gpgCalls.some(
          (c) =>
            c.cmd === 'gpg' &&
            c.args.includes('--export') &&
            c.args.includes('--armor') &&
            c.args.includes(expectedPublicKeyPath),
        ),
      ).toBe(true);
    });
  });

  describe('Slice 3: release-manifest.json & CLI dry-run', () => {
    it('builds release-manifest.json compatible with fetchLatestReleaseManifest in tauriBridge.ts', async () => {
      const manifest = buildReleaseManifest({
        version: 'v0.2.0',
        repository: 'pulso-app/pulso',
        publishedAt: '2026-11-27T00:00:00Z',
        entries: [
          {
            name: 'pulso-local-v0.2.0-macos-arm64.dmg',
            sha256: 'a'.repeat(64),
            size: 1024,
          },
          {
            name: 'pulso-tor-v0.2.0-linux-x64.AppImage',
            sha256: 'b'.repeat(64),
            size: 2048,
          },
        ],
      });

      expect(manifest.tag_name).toBe('v0.2.0');
      expect(manifest.version).toBe('0.2.0');
      expect(manifest.html_url).toBe('https://github.com/pulso-app/pulso/releases/tag/v0.2.0');
      expect(manifest.assets).toEqual([
        {
          name: 'pulso-local-v0.2.0-macos-arm64.dmg',
          flavor: 'local',
          os: 'macos',
          arch: 'arm64',
          ext: 'dmg',
          sha256: 'a'.repeat(64),
          size: 1024,
          download_url:
            'https://github.com/pulso-app/pulso/releases/download/v0.2.0/pulso-local-v0.2.0-macos-arm64.dmg',
        },
        {
          name: 'pulso-tor-v0.2.0-linux-x64.AppImage',
          flavor: 'tor',
          os: 'linux',
          arch: 'x64',
          ext: 'AppImage',
          sha256: 'b'.repeat(64),
          size: 2048,
          download_url:
            'https://github.com/pulso-app/pulso/releases/download/v0.2.0/pulso-tor-v0.2.0-linux-x64.AppImage',
        },
      ]);

      // Verify direct interoperability with src/desktop/tauriBridge.ts
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const parsedByBridge = await fetchLatestReleaseManifest(
        '0.1.0',
        'https://github.com/pulso-app/pulso/releases/latest/download/release-manifest.json',
        mockFetch as unknown as typeof fetch,
      );
      expect(parsedByBridge).toEqual({
        latestVersion: '0.2.0',
        releaseUrl: 'https://github.com/pulso-app/pulso/releases/tag/v0.2.0',
        updateAvailable: true,
      });
    });

    it('runs generateReleaseOutputs in dry-run without writing files and parses CLI flags', async () => {
      const root = makeTempDir('pulso-rel-dry-');
      writeFileSync(path.join(root, 'pulso-tor-v0.1.0-macos-arm64.dmg'), 'dmg-content');

      const dryResult = await generateReleaseOutputs({
        dir: root,
        version: '0.1.0',
        repository: 'pulso-app/pulso',
        dryRun: true,
      });

      expect(dryResult.dryRun).toBe(true);
      expect(dryResult.manifest.tag_name).toBe('v0.1.0');
      expect(dryResult.sha256Sums.entries).toHaveLength(1);
      expect(existsSync(path.join(root, 'SHA256SUMS'))).toBe(false);
      expect(existsSync(path.join(root, 'release-manifest.json'))).toBe(false);

      const opts = parseArgs([
        '--dir',
        root,
        '--version',
        'v0.1.0',
        '--repo',
        'pulso-app/pulso',
        '--dry-run',
      ]);
      expect(opts.dir).toBe(path.resolve(root));
      expect(opts.version).toBe('v0.1.0');
      expect(opts.repo).toBe('pulso-app/pulso');
      expect(opts.dryRun).toBe(true);
    });
  });

  describe('Slice 5: .github/workflows/release-server.yml validation', () => {
    it('defines valid YAML with v* + workflow_dispatch triggers, multi-arch GHCR, optional Docker Hub mirror, hardened smoke test, and attestations', () => {
      const { raw, parsed } = parseWorkflowYaml('.github/workflows/release-server.yml');

      const triggers = (parsed.on ?? parsed.True) as Record<string, unknown>;
      expect(triggers).toBeDefined();
      expect((triggers.push as { tags?: string[] })?.tags).toContain('v*');
      expect(triggers.workflow_dispatch).toBeDefined();

      const permissions = parsed.permissions as Record<string, string>;
      expect(permissions.packages).toBe('write');
      expect(permissions['id-token']).toBe('write');
      expect(permissions.attestations).toBe('write');

      expect(raw).toContain('linux/amd64,linux/arm64');
      expect(raw).toContain('ghcr.io/');
      expect(raw).toContain('DOCKERHUB_USERNAME');
      expect(raw).toContain('DOCKERHUB_TOKEN');
      expect(raw).toContain('actions/attest-build-provenance');

      // Smoke test hardening & endpoint assertions
      expect(raw).toContain('65532');
      expect(raw).toContain('--read-only');
      expect(raw).toContain('--cap-drop=ALL');
      expect(raw).toContain('/healthz');
      expect(raw).toContain('/api/runtime');
    });
  });

  describe('Slice 6: .github/workflows/release-desktop.yml validation', () => {
    it('defines valid YAML with 5x2 matrix, verification hooks, optional signing secrets, SHA256SUMS, attestations, and Tor mirror', () => {
      const { raw, parsed } = parseWorkflowYaml('.github/workflows/release-desktop.yml');

      const triggers = (parsed.on ?? parsed.True) as Record<string, unknown>;
      expect(triggers).toBeDefined();
      expect((triggers.push as { tags?: string[] })?.tags).toContain('v*');
      expect(triggers.workflow_dispatch).toBeDefined();

      const permissions = parsed.permissions as Record<string, string>;
      expect(permissions.contents).toBe('write');
      expect(permissions['id-token']).toBe('write');
      expect(permissions.attestations).toBe('write');

      // Matrix coverage: 5 OS/arch targets x 2 flavors (tor, local)
      const jobs = parsed.jobs as Record<
        string,
        { strategy?: { matrix?: { flavor?: string[]; platform?: Array<{ os: string; rust_triple: string }> } } }
      >;
      const matrix = jobs.build?.strategy?.matrix;
      expect(matrix?.flavor).toEqual(['tor', 'local']);
      expect(matrix?.platform?.map((p) => p.os)).toEqual([
        'macos-latest',
        'macos-latest',
        'windows-latest',
        'ubuntu-22.04',
        'ubuntu-24.04-arm',
      ]);
      expect(matrix?.platform?.map((p) => p.rust_triple)).toEqual([
        'aarch64-apple-darwin',
        'x86_64-apple-darwin',
        'x86_64-pc-windows-msvc',
        'x86_64-unknown-linux-gnu',
        'aarch64-unknown-linux-gnu',
      ]);

      // Entry verification & build pipeline
      expect(raw).toContain('fetch-tor-bundle.mjs');
      expect(raw).toContain('--require-pgp');
      expect(raw).toContain('fetch-cloudflared.mjs');
      expect(raw).toContain('build-sidecar.mjs');
      expect(raw).toContain('package-desktop.mjs');
      expect(raw).toContain('tauri-apps/tauri-action');
      expect(raw).toContain('release-artifacts.mjs');
      expect(raw).toContain('mirror-release.mjs');
      expect(raw).toContain('actions/attest-build-provenance');

      // Optional official signing hooks + ad-hoc fallback
      for (const secretName of [
        'APPLE_CERTIFICATE',
        'APPLE_CERTIFICATE_PASSWORD',
        'APPLE_SIGNING_IDENTITY',
        'APPLE_ID',
        'APPLE_PASSWORD',
        'APPLE_TEAM_ID',
        'WINDOWS_CERTIFICATE',
        'WINDOWS_CERTIFICATE_PASSWORD',
        'PULSO_PGP_PRIVATE_KEY',
      ]) {
        expect(raw).toContain(secretName);
      }
      expect(raw).toContain("'-'");
      expect(raw).toContain('SHA256SUMS');
      expect(raw).toContain('pulso-release-key.asc');
      expect(raw).toContain('release-manifest.json');

      // macOS must build .app first, verify/ad-hoc sign .app, then package .dmg from signed .app
      const macPlatforms = (matrix?.platform ?? []) as Array<{ os: string; bundles?: string }>;
      for (const p of macPlatforms.filter((item) => item.os === 'macos-latest')) {
        expect(p.bundles).toBe('app');
      }
      expect(raw).toContain('--verify-app');
      expect(raw).toContain('--create-dmg');
      expect(raw.indexOf('--verify-app')).toBeLessThan(raw.indexOf('--create-dmg'));
    });
  });
});
