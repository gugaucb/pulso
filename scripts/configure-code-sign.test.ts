// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureCodeSign, normalizeCertificatePayload } from './configure-code-sign.mjs';

const tempDirs: string[] = [];

function makeTempFiles() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pulso-sign-test-'));
  tempDirs.push(dir);
  const envFile = path.join(dir, 'github.env');
  const outputFile = path.join(dir, 'github.output');
  writeFileSync(envFile, '', 'utf8');
  writeFileSync(outputFile, '', 'utf8');
  return { dir, envFile, outputFile };
}

function parseGithubEnv(filePath: string): Record<string, string> {
  const raw = readFileSync(filePath, 'utf8');
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const heredocMatch = /^([^=<]+)<<(.+)$/.exec(line);
    if (heredocMatch) {
      const [, name, delim] = heredocMatch;
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== delim) {
        bodyLines.push(lines[i]!);
        i++;
      }
      result[name!] = bodyLines.join('\n');
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      result[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
    }
  }
  return result;
}

function parseGithubOutput(filePath: string): Record<string, string> {
  const raw = readFileSync(filePath, 'utf8');
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      result[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
    }
  }
  return result;
}

describe('scripts/configure-code-sign.mjs', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to ad-hoc macOS signing when Apple secrets are empty or unset', () => {
    const { envFile, outputFile } = makeTempFiles();
    const logs: string[] = [];

    const result = configureCodeSign({
      env: {
        RUNNER_OS: 'macOS',
        GITHUB_ENV: envFile,
        GITHUB_OUTPUT: outputFile,
      },
      platform: 'darwin',
      logger: { log: (msg: string) => logs.push(msg), warn: (msg: string) => logs.push(msg) },
    });

    expect(result).toEqual({ mode: 'ad-hoc', adHoc: true });
    const exported = parseGithubEnv(envFile);
    expect(exported.APPLE_CERTIFICATE).toBeUndefined();
    expect(exported.APPLE_CERTIFICATE_PASSWORD).toBeUndefined();
    expect(exported.APPLE_SIGNING_IDENTITY).toBe('-');
    expect(parseGithubOutput(outputFile)).toEqual({ ad_hoc: 'true' });
    expect(logs.some((line) => /ad-hoc/i.test(line))).toBe(true);
  });

  it('treats whitespace-only Apple certificate/password secrets as absent', () => {
    const { envFile, outputFile } = makeTempFiles();
    const logs: string[] = [];

    const result = configureCodeSign({
      env: {
        RUNNER_OS: 'macOS',
        GITHUB_ENV: envFile,
        GITHUB_OUTPUT: outputFile,
        RAW_APPLE_CERTIFICATE: '  \n\t  ',
        RAW_APPLE_CERTIFICATE_PASSWORD: '\n   ',
      },
      platform: 'darwin',
      logger: { log: (msg: string) => logs.push(msg), warn: (msg: string) => logs.push(msg) },
    });

    expect(result).toEqual({ mode: 'ad-hoc', adHoc: true });
    const exported = parseGithubEnv(envFile);
    expect(exported.APPLE_CERTIFICATE).toBeUndefined();
    expect(exported.APPLE_CERTIFICATE_PASSWORD).toBeUndefined();
    expect(exported.APPLE_SIGNING_IDENTITY).toBe('-');
    expect(parseGithubOutput(outputFile)).toEqual({ ad_hoc: 'true' });
  });

  it('warns and falls back to ad-hoc signing when only one of certificate or password is set', () => {
    const { envFile, outputFile } = makeTempFiles();
    const logs: string[] = [];

    const result = configureCodeSign({
      env: {
        RUNNER_OS: 'macOS',
        GITHUB_ENV: envFile,
        GITHUB_OUTPUT: outputFile,
        RAW_APPLE_CERTIFICATE: Buffer.from('mock-p12-bytes').toString('base64'),
        RAW_APPLE_CERTIFICATE_PASSWORD: '',
      },
      platform: 'darwin',
      logger: { log: (msg: string) => logs.push(msg), warn: (msg: string) => logs.push(msg) },
    });

    expect(result).toEqual({ mode: 'ad-hoc', adHoc: true });
    const exported = parseGithubEnv(envFile);
    expect(exported.APPLE_CERTIFICATE).toBeUndefined();
    expect(exported.APPLE_SIGNING_IDENTITY).toBe('-');
    expect(parseGithubOutput(outputFile)).toEqual({ ad_hoc: 'true' });
    expect(logs.some((line) => line.startsWith('::warning::'))).toBe(true);
  });

  it('strips line wraps from valid base64 PKCS#12 and exports Apple secrets without logging them', () => {
    const { envFile, outputFile } = makeTempFiles();
    const logs: string[] = [];
    const rawBytes = Buffer.from('pkcs12-binary-payload-for-test');
    const expectedB64 = rawBytes.toString('base64');
    const wrappedB64 = `  ${expectedB64.slice(0, 12)}\n  ${expectedB64.slice(12)}\r\n `;
    const secretPass = 'super-secret-cert-pass-123';
    const applePassword = 'app-specific-password-xyz';

    const execCalls: Array<{ cmd: string; args: string[] }> = [];
    const execSpy = vi.fn((cmd: string, args: string[]) => {
      execCalls.push({ cmd, args });
      return '';
    });

    const result = configureCodeSign({
      env: {
        RUNNER_OS: 'macOS',
        GITHUB_ENV: envFile,
        GITHUB_OUTPUT: outputFile,
        RAW_APPLE_CERTIFICATE: wrappedB64,
        RAW_APPLE_CERTIFICATE_PASSWORD: ` ${secretPass} `,
        RAW_APPLE_SIGNING_IDENTITY: ' Developer ID Application: PULSO (TEAM123) ',
        RAW_APPLE_ID: ' dev@pulso.example ',
        RAW_APPLE_PASSWORD: applePassword,
        RAW_APPLE_TEAM_ID: ' TEAM123 ',
      },
      platform: 'darwin',
      execFileSyncFn: execSpy,
      logger: { log: (msg: string) => logs.push(msg), warn: (msg: string) => logs.push(msg) },
    });

    expect(result).toEqual({ mode: 'certificate', adHoc: false });
    const exported = parseGithubEnv(envFile);
    expect(exported.APPLE_CERTIFICATE).toBe(expectedB64);
    expect(exported.APPLE_CERTIFICATE_PASSWORD).toBe(secretPass);
    expect(exported.APPLE_SIGNING_IDENTITY).toBe('Developer ID Application: PULSO (TEAM123)');
    expect(exported.APPLE_ID).toBe('dev@pulso.example');
    expect(exported.APPLE_PASSWORD).toBe(applePassword);
    expect(exported.APPLE_TEAM_ID).toBe('TEAM123');
    expect(parseGithubOutput(outputFile)).toEqual({ ad_hoc: 'false' });
    expect(execCalls.some((c) => c.cmd === 'security' && c.args[0] === 'import')).toBe(true);
    expect(execCalls.some((c) => c.cmd === 'security' && c.args[0] === 'delete-keychain')).toBe(true);

    const combinedLogs = logs.join('\n');
    expect(combinedLogs).not.toContain(expectedB64);
    expect(combinedLogs).not.toContain(secretPass);
    expect(combinedLogs).not.toContain(applePassword);
  });

  it('emits warning when APPLE_CERTIFICATE is set without APPLE_SIGNING_IDENTITY', () => {
    const { envFile, outputFile } = makeTempFiles();
    const logs: string[] = [];
    const execSpy = vi.fn(() => '');

    configureCodeSign({
      env: {
        RUNNER_OS: 'macOS',
        GITHUB_ENV: envFile,
        GITHUB_OUTPUT: outputFile,
        RAW_APPLE_CERTIFICATE: Buffer.from('pkcs12-binary-payload').toString('base64'),
        RAW_APPLE_CERTIFICATE_PASSWORD: 'pass',
      },
      platform: 'darwin',
      execFileSyncFn: execSpy,
      logger: { log: (msg: string) => logs.push(msg), warn: (msg: string) => logs.push(msg) },
    });

    expect(logs.some((line) => line.includes('APPLE_SIGNING_IDENTITY') && line.includes('signingIdentity'))).toBe(true);
  });

  it('fails fast with actionable message on invalid base64 without leaking secret value', () => {
    const { envFile, outputFile } = makeTempFiles();
    const badSecret = 'not-valid-base64-!!!-placeholder-secret';

    expect(() => normalizeCertificatePayload(badSecret)).toThrow(/APPLE_CERTIFICATE|base64/i);

    let caught: Error | null = null;
    try {
      configureCodeSign({
        env: {
          RUNNER_OS: 'macOS',
          GITHUB_ENV: envFile,
          GITHUB_OUTPUT: outputFile,
          RAW_APPLE_CERTIFICATE: badSecret,
          RAW_APPLE_CERTIFICATE_PASSWORD: 'password123',
        },
        platform: 'darwin',
      });
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/APPLE_CERTIFICATE/);
    expect(caught!.message).toMatch(/ad-hoc/i);
    expect(caught!.message).not.toContain(badSecret);
    expect(caught!.message).not.toContain('password123');
    expect(parseGithubEnv(envFile)).toEqual({});
  });

  it('converts OpenSSL 3+ PKCS#12 via legacy re-export when initial security import fails', () => {
    const { envFile, outputFile } = makeTempFiles();
    const logs: string[] = [];
    const originalBytes = Buffer.from('openssl3-p12-bytes');
    const convertedBytes = Buffer.from('legacy-p12-bytes');
    let importAttempts = 0;

    const execSpy = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'security' && args[0] === 'import') {
        importAttempts += 1;
        if (importAttempts === 1) {
          throw new Error('security: SecKeychainItemImport: Unable to decode the provided data.');
        }
        return '';
      }
      if (cmd === 'openssl' && args[0] === 'pkcs12') {
        const outIdx = args.indexOf('-out');
        const outPath = args[outIdx + 1]!;
        mkdirSync(path.dirname(outPath), { recursive: true });
        if (args.includes('-export')) {
          writeFileSync(outPath, convertedBytes);
        } else {
          writeFileSync(
            outPath,
            '-----BEGIN CERTIFICATE-----\nmock\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----\n',
          );
        }
        return '';
      }
      return '';
    });

    const result = configureCodeSign({
      env: {
        RUNNER_OS: 'macOS',
        GITHUB_ENV: envFile,
        GITHUB_OUTPUT: outputFile,
        RAW_APPLE_CERTIFICATE: originalBytes.toString('base64'),
        RAW_APPLE_CERTIFICATE_PASSWORD: 'export-password',
      },
      platform: 'darwin',
      execFileSyncFn: execSpy,
      logger: { log: (msg: string) => logs.push(msg), warn: (msg: string) => logs.push(msg) },
    });

    expect(result).toEqual({ mode: 'certificate', adHoc: false });
    expect(importAttempts).toBe(2);
    const exported = parseGithubEnv(envFile);
    expect(exported.APPLE_CERTIFICATE).toBe(convertedBytes.toString('base64'));
    expect(parseGithubOutput(outputFile)).toEqual({ ad_hoc: 'false' });
    expect(logs.some((line) => /legacy PKCS#12/i.test(line))).toBe(true);
    expect(logs.join('\n')).not.toContain('export-password');
    expect(existsSync(path.join(os.tmpdir(), 'nonexistent'))).toBe(false);
  });

  it('rejects PEM certificate that is missing a private key', () => {
    const { envFile, outputFile } = makeTempFiles();
    const certOnlyPem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

    expect(() =>
      configureCodeSign({
        env: {
          RUNNER_OS: 'macOS',
          GITHUB_ENV: envFile,
          GITHUB_OUTPUT: outputFile,
          RAW_APPLE_CERTIFICATE: Buffer.from(certOnlyPem).toString('base64'),
          RAW_APPLE_CERTIFICATE_PASSWORD: 'pass',
        },
        platform: 'darwin',
      }),
    ).toThrow(/private key/i);
  });

  it('normalizes Windows signing secrets cleanly and handles Linux runners without signing vars', () => {
    const winFiles = makeTempFiles();
    const winBytes = Buffer.from('windows-pfx-bytes').toString('base64');
    const winWrapped = `${winBytes.slice(0, 8)}\n${winBytes.slice(8)}`;

    const winResult = configureCodeSign({
      env: {
        RUNNER_OS: 'Windows',
        GITHUB_ENV: winFiles.envFile,
        GITHUB_OUTPUT: winFiles.outputFile,
        RAW_WINDOWS_CERTIFICATE: winWrapped,
        RAW_WINDOWS_CERTIFICATE_PASSWORD: ' win-pass ',
      },
      platform: 'win32',
    });

    expect(winResult).toEqual({ mode: 'certificate', adHoc: false });
    expect(parseGithubEnv(winFiles.envFile)).toEqual({
      WINDOWS_CERTIFICATE: winBytes,
      WINDOWS_CERTIFICATE_PASSWORD: 'win-pass',
    });
    expect(parseGithubOutput(winFiles.outputFile)).toEqual({ ad_hoc: 'false' });

    const linuxFiles = makeTempFiles();
    const linuxResult = configureCodeSign({
      env: {
        RUNNER_OS: 'Linux',
        GITHUB_ENV: linuxFiles.envFile,
        GITHUB_OUTPUT: linuxFiles.outputFile,
      },
      platform: 'linux',
    });

    expect(linuxResult).toEqual({ mode: 'none', adHoc: false });
    expect(parseGithubEnv(linuxFiles.envFile)).toEqual({});
    expect(parseGithubOutput(linuxFiles.outputFile)).toEqual({ ad_hoc: 'false' });
  });
});
