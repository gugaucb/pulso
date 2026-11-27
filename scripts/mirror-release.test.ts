// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCodebergMirrorPlan,
  buildGitlabMirrorPlan,
  mirrorRelease,
  parseArgs,
  selectTorMirrorFiles,
} from './mirror-release.mjs';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('scripts/mirror-release.mjs', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('filters release assets to mirror only PULSO Tor packages plus SHA256SUMS, SHA256SUMS.asc, and pulso-release-key.asc', () => {
    const selected = selectTorMirrorFiles([
      'pulso-local-v0.1.0-macos-arm64.dmg',
      'pulso-local-v0.1.0-windows-x64.exe',
      'pulso-tor-v0.1.0-macos-arm64.dmg',
      'pulso-tor-v0.1.0-linux-x64.AppImage',
      'pulso-tor-v0.1.0-windows-x64.zip',
      'SHA256SUMS',
      'SHA256SUMS.asc',
      'pulso-release-key.asc',
      'release-manifest.json',
      '.DS_Store',
    ]);

    expect(selected).toEqual([
      'SHA256SUMS',
      'SHA256SUMS.asc',
      'pulso-release-key.asc',
      'pulso-tor-v0.1.0-linux-x64.AppImage',
      'pulso-tor-v0.1.0-macos-arm64.dmg',
      'pulso-tor-v0.1.0-windows-x64.zip',
    ]);
    expect(selected.some((name) => name.startsWith('pulso-local-'))).toBe(false);
  });

  it('builds Codeberg and GitLab mirror payloads accurately and performs zero network calls in dry-run', async () => {
    const root = makeTempDir('pulso-mirror-dry-');
    writeFileSync(path.join(root, 'pulso-tor-v0.1.0-macos-arm64.dmg'), 'tor-dmg');
    writeFileSync(path.join(root, 'pulso-local-v0.1.0-macos-arm64.dmg'), 'local-dmg');
    writeFileSync(path.join(root, 'SHA256SUMS'), 'deadbeef  pulso-tor-v0.1.0-macos-arm64.dmg\n');
    writeFileSync(path.join(root, 'SHA256SUMS.asc'), '-----BEGIN PGP SIGNATURE-----\n');

    const codebergPlan = buildCodebergMirrorPlan({
      baseUrl: 'https://codeberg.org',
      repo: 'pulso-app/pulso',
      version: '0.1.0',
      files: ['SHA256SUMS', 'SHA256SUMS.asc', 'pulso-tor-v0.1.0-macos-arm64.dmg'],
    });
    expect(codebergPlan.releaseCreateUrl).toBe('https://codeberg.org/api/v1/repos/pulso-app/pulso/releases');
    expect(codebergPlan.releasePayload.tag_name).toBe('v0.1.0');
    expect(codebergPlan.files).not.toContain('pulso-local-v0.1.0-macos-arm64.dmg');

    const gitlabPlan = buildGitlabMirrorPlan({
      baseUrl: 'https://gitlab.com',
      project: 'pulso-app/pulso',
      version: 'v0.1.0',
      files: ['SHA256SUMS', 'SHA256SUMS.asc', 'pulso-tor-v0.1.0-macos-arm64.dmg'],
    });
    expect(gitlabPlan.releaseCreateUrl).toBe(
      'https://gitlab.com/api/v4/projects/pulso-app%2Fpulso/releases',
    );
    expect(gitlabPlan.packageUploads).toHaveLength(3);
    expect(gitlabPlan.releasePayload.assets.links).toHaveLength(3);

    const fetchSpy = vi.fn();
    const dryResult = await mirrorRelease({
      dir: root,
      version: '0.1.0',
      provider: 'all',
      codebergRepo: 'pulso-app/pulso',
      gitlabProject: 'pulso-app/pulso',
      dryRun: true,
      fetchFn: fetchSpy as unknown as typeof fetch,
    });

    expect(dryResult.dryRun).toBe(true);
    expect(dryResult.files).toEqual([
      'SHA256SUMS',
      'SHA256SUMS.asc',
      'pulso-tor-v0.1.0-macos-arm64.dmg',
    ]);
    expect(dryResult.plans.map((p) => p.provider)).toEqual(['codeberg', 'gitlab']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips cleanly when mirror secrets are missing and uploads only Tor assets when configured', async () => {
    const root = makeTempDir('pulso-mirror-run-');
    writeFileSync(path.join(root, 'pulso-tor-v0.1.0-linux-x64.AppImage'), 'tor-appimage');
    writeFileSync(path.join(root, 'pulso-local-v0.1.0-linux-x64.AppImage'), 'local-appimage');
    writeFileSync(path.join(root, 'SHA256SUMS'), 'cafe  pulso-tor-v0.1.0-linux-x64.AppImage\n');

    const unconfigured = await mirrorRelease({
      dir: root,
      version: '0.1.0',
      env: {},
      dryRun: false,
    });
    expect(unconfigured.skipped).toBe(true);
    expect(unconfigured.reason).toBe('no_mirror_configured');

    const requests: Array<{ url: string; method: string }> = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ url, method });
      if (method === 'GET' && url.includes('/releases/tags/')) {
        return new Response('Not Found', { status: 404 });
      }
      if (method === 'POST' && url.endsWith('/releases')) {
        return new Response(JSON.stringify({ id: 42, tag_name: 'v0.1.0' }), { status: 201 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    });

    const executed = await mirrorRelease({
      dir: root,
      version: '0.1.0',
      provider: 'codeberg',
      env: {
        CODEBERG_TOKEN: 'cb-token',
        CODEBERG_REPO: 'pulso-app/pulso',
      },
      dryRun: false,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(executed.skipped).toBe(false);
    expect(requests.some((r) => r.url.includes('name=pulso-tor-v0.1.0-linux-x64.AppImage'))).toBe(
      true,
    );
    expect(requests.some((r) => r.url.includes('name=SHA256SUMS'))).toBe(true);
    expect(requests.some((r) => r.url.includes('pulso-local'))).toBe(false);
  });

  it('parses CLI arguments cleanly', () => {
    const opts = parseArgs([
      '--dir',
      './release-assets',
      '--version',
      'v0.1.0',
      '--provider',
      'codeberg',
      '--codeberg-repo',
      'pulso-app/pulso',
      '--dry-run',
    ]);
    expect(opts.version).toBe('v0.1.0');
    expect(opts.provider).toBe('codeberg');
    expect(opts.codebergRepo).toBe('pulso-app/pulso');
    expect(opts.dryRun).toBe(true);
  });
});
