// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CLOUDFLARED_VERSION,
  buildCloudflaredUrls,
  computeFileSha256,
  parseArgs,
  parseSha256FromReleaseJson,
  parseSha256FromReleaseNotes,
  preserveLicenseFiles,
  resolveCloudflaredTarget,
  signMacOsCloudflaredBinary,
  verifyLocalFileSha256,
} from './fetch-cloudflared.mjs';

describe('scripts/fetch-cloudflared.mjs helpers', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-fetch-cf-'));
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

  it('maps all supported OS/arch combinations and rejects unsupported targets', () => {
    expect(DEFAULT_CLOUDFLARED_VERSION.length).toBeGreaterThan(0);
    expect(resolveCloudflaredTarget('darwin', 'arm64')).toBe('darwin-arm64');
    expect(resolveCloudflaredTarget('darwin', 'x64')).toBe('darwin-amd64');
    expect(resolveCloudflaredTarget('linux', 'x64')).toBe('linux-amd64');
    expect(resolveCloudflaredTarget('linux', 'arm64')).toBe('linux-arm64');
    expect(resolveCloudflaredTarget('win32', 'x64')).toBe('windows-amd64');
    expect(() => resolveCloudflaredTarget('freebsd', 'x64')).toThrow(/Unsupported platform\/arch/);
  });

  it('builds official cloudflared GitHub Release, API, and Apache-2.0 LICENSE/NOTICE URLs', () => {
    const darwin = buildCloudflaredUrls('2025.11.1', 'darwin-arm64');
    expect(darwin).toMatchObject({
      filename: 'cloudflared-darwin-arm64.tgz',
      binaryName: 'cloudflared',
      isArchive: true,
      downloadUrl:
        'https://github.com/cloudflare/cloudflared/releases/download/2025.11.1/cloudflared-darwin-arm64.tgz',
      releaseApiUrl:
        'https://api.github.com/repos/cloudflare/cloudflared/releases/tags/2025.11.1',
      licenseUrl:
        'https://raw.githubusercontent.com/cloudflare/cloudflared/2025.11.1/LICENSE',
      noticeUrl:
        'https://raw.githubusercontent.com/cloudflare/cloudflared/2025.11.1/NOTICE',
    });

    const winLatest = buildCloudflaredUrls('latest', 'windows-amd64');
    expect(winLatest).toMatchObject({
      filename: 'cloudflared-windows-amd64.exe',
      binaryName: 'cloudflared.exe',
      isArchive: false,
      downloadUrl:
        'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
      releaseApiUrl: 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest',
    });
  });

  it('parses SHA-256 digests from GitHub release asset metadata and release body formats', () => {
    const body = [
      '### SHA256 Checksums:',
      `cloudflared-darwin-arm64.tgz: ${'a'.repeat(64)}`,
      `| cloudflared-linux-arm64 | \`${'b'.repeat(64)}\` |`,
      `${'c'.repeat(64)}  cloudflared-windows-amd64.exe`,
    ].join('\n');

    expect(parseSha256FromReleaseNotes(body, 'cloudflared-darwin-arm64.tgz')).toBe('a'.repeat(64));
    expect(parseSha256FromReleaseNotes(body, 'cloudflared-linux-arm64')).toBe('b'.repeat(64));
    expect(parseSha256FromReleaseNotes(body, 'cloudflared-windows-amd64.exe')).toBe('c'.repeat(64));
    expect(parseSha256FromReleaseNotes(body, 'missing-asset')).toBeNull();

    expect(
      parseSha256FromReleaseJson(
        {
          assets: [
            { name: 'cloudflared-linux-amd64', digest: `sha256:${'d'.repeat(64).toUpperCase()}` },
          ],
          body,
        },
        'cloudflared-linux-amd64',
      ),
    ).toBe('d'.repeat(64));

    expect(
      parseSha256FromReleaseJson({ assets: [], body }, 'cloudflared-darwin-arm64.tgz'),
    ).toBe('a'.repeat(64));
  });

  it('parses CLI flags and verifies local file SHA-256 digests', async () => {
    const opts = parseArgs([
      '--dry-run',
      '--target',
      'darwin-arm64',
      '--version',
      '2025.11.1',
      '--out',
      'custom-cf',
      '--sha256',
      'AB'.repeat(32),
    ]);
    expect(opts.dryRun).toBe(true);
    expect(opts.target).toBe('darwin-arm64');
    expect(opts.version).toBe('2025.11.1');
    expect(opts.outDir).toMatch(/custom-cf$/);
    expect(opts.sha256).toBe('ab'.repeat(32));

    const dir = makeTempDir();
    const file = join(dir, 'cloudflared');
    const content = Buffer.from('cloudflared-binary-payload');
    const expectedHash = createHash('sha256').update(content).digest('hex');
    writeFileSync(file, content);

    expect(await computeFileSha256(file)).toBe(expectedHash);
    expect(await verifyLocalFileSha256(file, expectedHash)).toBe(expectedHash);
    await expect(verifyLocalFileSha256(file, '0'.repeat(64))).rejects.toThrow(/SHA-256 mismatch/);
  });

  it('applies macOS ad-hoc codesign and preserves Apache 2.0 LICENSE and NOTICE files', async () => {
    const dir = makeTempDir();
    const cfBin = join(dir, 'cloudflared');
    writeFileSync(cfBin, 'cf', 'utf8');

    const execMock = vi.fn();
    signMacOsCloudflaredBinary(
      cfBin,
      execMock as unknown as typeof import('node:child_process').execFileSync,
    );
    expect(execMock).toHaveBeenCalledWith('codesign', ['-s', '-', '--force', cfBin], {
      stdio: 'ignore',
    });

    const downloadMock = vi.fn(async (url: string) => {
      if (url.endsWith('/LICENSE')) {
        return Buffer.from('Apache License\nVersion 2.0, January 2004\n');
      }
      throw new Error('HTTP 404 Not Found');
    });

    await preserveLicenseFiles({
      outDir: dir,
      licenseUrl: 'https://example.invalid/LICENSE',
      noticeUrl: 'https://example.invalid/NOTICE',
      downloadToBufferFn: downloadMock,
    });

    expect(existsSync(join(dir, 'LICENSE'))).toBe(true);
    expect(readFileSync(join(dir, 'LICENSE'), 'utf8')).toContain('Apache License');
    expect(existsSync(join(dir, 'NOTICE'))).toBe(true);
    expect(readFileSync(join(dir, 'NOTICE'), 'utf8')).toContain('Cloudflare');
  });
});
