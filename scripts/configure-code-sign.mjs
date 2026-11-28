#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDirectExecution } from './lib/cli-utils.mjs';

const PEM_CERT_RE = /-----BEGIN CERTIFICATE-----/;
const PEM_KEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const STRICT_BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Appends a variable to GitHub Actions GITHUB_ENV using a randomized heredoc delimiter.
 */
function appendGithubEnv(envFilePath, name, value) {
  if (!envFilePath) return;
  const delim = `PULSO_ENV_EOF_${randomBytes(8).toString('hex')}`;
  appendFileSync(envFilePath, `${name}<<${delim}\n${value}\n${delim}\n`, 'utf8');
}

/**
 * Appends a key=value output pair to GitHub Actions GITHUB_OUTPUT.
 */
function appendGithubOutput(outputFilePath, name, value) {
  if (!outputFilePath) return;
  appendFileSync(outputFilePath, `${name}=${value}\n`, 'utf8');
}

/**
 * Normalizes a certificate secret (raw PEM, base64-encoded PEM, or base64-encoded PKCS#12).
 * Throws an actionable error without leaking secret material when the payload is malformed.
 */
export function normalizeCertificatePayload(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('-----BEGIN')) {
    return { kind: 'pem', pemText: trimmed };
  }

  const cleaned = trimmed.replace(/\s+/g, '');
  if (cleaned.length % 4 !== 0 || !STRICT_BASE64_RE.test(cleaned)) {
    throw new Error(
      'Invalid APPLE_CERTIFICATE secret: expected a base64-encoded PKCS#12 (.p12) file or PEM bundle. ' +
        'Ensure no extra quotes or non-base64 characters were pasted, or delete APPLE_CERTIFICATE and APPLE_CERTIFICATE_PASSWORD from GitHub Actions Secrets to use ad-hoc signing.',
    );
  }

  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length === 0) {
    throw new Error(
      'Invalid APPLE_CERTIFICATE secret: decoded certificate payload is empty. ' +
        'Re-encode your .p12 file cleanly or delete APPLE_CERTIFICATE and APPLE_CERTIFICATE_PASSWORD from GitHub Actions Secrets to use ad-hoc signing.',
    );
  }

  const asUtf8 = buffer.toString('utf8').trim();
  if (asUtf8.startsWith('-----BEGIN')) {
    return { kind: 'pem', pemText: asUtf8 };
  }

  return { kind: 'pkcs12', base64: cleaned, buffer };
}

function validatePemBundleHasPrivateKey(pemText) {
  if (!PEM_CERT_RE.test(pemText) || !PEM_KEY_RE.test(pemText)) {
    throw new Error(
      'Invalid APPLE_CERTIFICATE secret: PEM bundle must contain both a certificate (-----BEGIN CERTIFICATE-----) and a private key (-----BEGIN ... PRIVATE KEY-----). ' +
        'Export both from Keychain Access as a .p12 file, or delete APPLE_CERTIFICATE and APPLE_CERTIFICATE_PASSWORD from GitHub Actions Secrets to use ad-hoc signing.',
    );
  }
}

function createTempKeychain(tmpDir, execFileSyncFn) {
  const kcPath = path.join(tmpDir, 'pulso-validate.keychain-db');
  const kcPass = randomBytes(24).toString('hex');
  execFileSyncFn('security', ['create-keychain', '-p', kcPass, kcPath], { stdio: 'pipe' });
  execFileSyncFn('security', ['unlock-keychain', '-p', kcPass, kcPath], { stdio: 'pipe' });
  return kcPath;
}

function trySecurityImportPkcs12(p12Path, kcPath, password, execFileSyncFn) {
  try {
    execFileSyncFn(
      'security',
      ['import', p12Path, '-k', kcPath, '-f', 'pkcs12', '-P', password, '-T', '/usr/bin/codesign'],
      { stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
}

function exportLegacyPkcs12WithOpenSSL(pemPath, outP12Path, opensslEnv, execFileSyncFn) {
  const baseArgs = ['pkcs12', '-export', '-in', pemPath, '-out', outP12Path, '-passout', 'env:PULSO_P12_PASS'];
  const attempts = [
    [...baseArgs, '-legacy', '-passin', 'env:PULSO_P12_PASS'],
    [...baseArgs, '-certpbe', 'PBE-SHA1-3DES', '-keypbe', 'PBE-SHA1-3DES', '-macalg', 'sha1', '-passin', 'env:PULSO_P12_PASS'],
    [...baseArgs, '-legacy'],
    [...baseArgs, '-certpbe', 'PBE-SHA1-3DES', '-keypbe', 'PBE-SHA1-3DES', '-macalg', 'sha1'],
  ];

  for (const args of attempts) {
    try {
      execFileSyncFn('openssl', args, { env: opensslEnv, stdio: 'pipe' });
      return true;
    } catch {
      // Try next cipher/flag variant
    }
  }
  return false;
}

function extractPemFromPkcs12WithOpenSSL(p12Path, outPemPath, opensslEnv, execFileSyncFn) {
  const attempts = [
    ['pkcs12', '-in', p12Path, '-nodes', '-passin', 'env:PULSO_P12_PASS', '-out', outPemPath],
    ['pkcs12', '-legacy', '-in', p12Path, '-nodes', '-passin', 'env:PULSO_P12_PASS', '-out', outPemPath],
  ];

  for (const args of attempts) {
    try {
      execFileSyncFn('openssl', args, { env: opensslEnv, stdio: 'pipe' });
      return true;
    } catch {
      // Try legacy provider flag if OpenSSL 3+ rejects default cipher
    }
  }
  return false;
}

function validateAndNormalizeAppleCertificateOnMacOS({ normalized, password, env, execFileSyncFn, logger }) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'pulso-sign-'));
  chmodSync(tmpDir, 0o700);
  const opensslEnv = { ...env, PULSO_P12_PASS: password };
  let kcPath = null;

  try {
    kcPath = createTempKeychain(tmpDir, execFileSyncFn);

    if (normalized.kind === 'pkcs12') {
      const inputP12 = path.join(tmpDir, 'input.p12');
      writeFileSync(inputP12, normalized.buffer, { mode: 0o600 });

      if (trySecurityImportPkcs12(inputP12, kcPath, password, execFileSyncFn)) {
        return normalized.base64;
      }

      const extractedPem = path.join(tmpDir, 'extracted.pem');
      const legacyP12 = path.join(tmpDir, 'legacy.p12');
      if (
        extractPemFromPkcs12WithOpenSSL(inputP12, extractedPem, opensslEnv, execFileSyncFn) &&
        exportLegacyPkcs12WithOpenSSL(extractedPem, legacyP12, opensslEnv, execFileSyncFn) &&
        trySecurityImportPkcs12(legacyP12, kcPath, password, execFileSyncFn)
      ) {
        logger.log('macOS code signing: converted OpenSSL 3+ PKCS#12 certificate to macOS-compatible legacy PKCS#12.');
        return readFileSync(legacyP12).toString('base64');
      }
    } else {
      const inputPem = path.join(tmpDir, 'input.pem');
      const legacyP12 = path.join(tmpDir, 'legacy.p12');
      writeFileSync(inputPem, normalized.pemText, { mode: 0o600 });

      if (
        exportLegacyPkcs12WithOpenSSL(inputPem, legacyP12, opensslEnv, execFileSyncFn) &&
        trySecurityImportPkcs12(legacyP12, kcPath, password, execFileSyncFn)
      ) {
        logger.log('macOS code signing: converted PEM bundle to macOS-compatible legacy PKCS#12.');
        return readFileSync(legacyP12).toString('base64');
      }
    }

    throw new Error(
      'Failed to validate APPLE_CERTIFICATE for macOS keychain import (security import -f pkcs12). ' +
        'Confirm APPLE_CERTIFICATE contains both your certificate and private key and APPLE_CERTIFICATE_PASSWORD matches the export password. ' +
        'Re-export with `openssl pkcs12 -export -legacy -in cert.p12 -out legacy.p12` and `base64 -i legacy.p12 | tr -d "\\n"`, ' +
        'or delete APPLE_CERTIFICATE and APPLE_CERTIFICATE_PASSWORD from GitHub Actions Secrets to use ad-hoc signing.',
    );
  } finally {
    if (kcPath) {
      try {
        execFileSyncFn('security', ['delete-keychain', kcPath], { stdio: 'pipe' });
      } catch {
        // Ignore cleanup failure for disposable keychain
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function configureMacOSCodeSign({ env, envFile, outputFile, platform, execFileSyncFn, logger }) {
  const rawCert = String(env.RAW_APPLE_CERTIFICATE ?? '').trim();
  const certPassword = String(env.RAW_APPLE_CERTIFICATE_PASSWORD ?? '').trim();
  const signingIdentity = String(env.RAW_APPLE_SIGNING_IDENTITY ?? '').trim();
  const appleId = String(env.RAW_APPLE_ID ?? '').trim();
  const applePassword = String(env.RAW_APPLE_PASSWORD ?? '').trim();
  const appleTeamId = String(env.RAW_APPLE_TEAM_ID ?? '').trim();

  if (!rawCert || !certPassword) {
    if (rawCert || certPassword) {
      logger.warn(
        '::warning::Only one of APPLE_CERTIFICATE / APPLE_CERTIFICATE_PASSWORD is set; falling back to ad-hoc macOS signing (\'-\').',
      );
    }
    appendGithubEnv(envFile, 'APPLE_SIGNING_IDENTITY', '-');
    appendGithubOutput(outputFile, 'ad_hoc', 'true');
    logger.log("macOS code signing: ad-hoc ('-')");
    return { mode: 'ad-hoc', adHoc: true };
  }

  const normalized = normalizeCertificatePayload(rawCert);
  if (normalized.kind === 'pem') {
    validatePemBundleHasPrivateKey(normalized.pemText);
  }

  const finalCertificateBase64 =
    platform === 'darwin'
      ? validateAndNormalizeAppleCertificateOnMacOS({
          normalized,
          password: certPassword,
          env,
          execFileSyncFn,
          logger,
        })
      : normalized.kind === 'pkcs12'
        ? normalized.base64
        : Buffer.from(normalized.pemText, 'utf8').toString('base64');

  appendGithubEnv(envFile, 'APPLE_CERTIFICATE', finalCertificateBase64);
  appendGithubEnv(envFile, 'APPLE_CERTIFICATE_PASSWORD', certPassword);

  if (signingIdentity) {
    appendGithubEnv(envFile, 'APPLE_SIGNING_IDENTITY', signingIdentity);
  } else {
    logger.warn(
      '::warning::APPLE_CERTIFICATE is set without APPLE_SIGNING_IDENTITY; src-tauri/tauri.conf.json still configures "signingIdentity": "-".',
    );
  }

  if (appleId && applePassword && appleTeamId) {
    appendGithubEnv(envFile, 'APPLE_ID', appleId);
    appendGithubEnv(envFile, 'APPLE_PASSWORD', applePassword);
    appendGithubEnv(envFile, 'APPLE_TEAM_ID', appleTeamId);
  }

  appendGithubOutput(outputFile, 'ad_hoc', 'false');
  logger.log('macOS code signing: official certificate (verified)');
  return { mode: 'certificate', adHoc: false };
}

function configureWindowsCodeSign({ env, envFile, outputFile, logger }) {
  const rawCert = String(env.RAW_WINDOWS_CERTIFICATE ?? '').trim();
  const certPassword = String(env.RAW_WINDOWS_CERTIFICATE_PASSWORD ?? '').trim();

  if (rawCert && certPassword) {
    const cleaned = rawCert.replace(/\s+/g, '');
    if (cleaned.length % 4 !== 0 || !STRICT_BASE64_RE.test(cleaned)) {
      throw new Error(
        'Invalid WINDOWS_CERTIFICATE secret: expected a base64-encoded PKCS#12 (.pfx/.p12) certificate.',
      );
    }
    appendGithubEnv(envFile, 'WINDOWS_CERTIFICATE', cleaned);
    appendGithubEnv(envFile, 'WINDOWS_CERTIFICATE_PASSWORD', certPassword);
    appendGithubOutput(outputFile, 'ad_hoc', 'false');
    logger.log('Windows code signing: official certificate');
    return { mode: 'certificate', adHoc: false };
  }

  if (rawCert || certPassword) {
    logger.warn('::warning::Only one of WINDOWS_CERTIFICATE / WINDOWS_CERTIFICATE_PASSWORD is set; skipping Windows signing.');
  } else {
    logger.log('Windows code signing: unsigned (no certificate configured)');
  }

  appendGithubOutput(outputFile, 'ad_hoc', 'false');
  return { mode: 'none', adHoc: false };
}

/**
 * Normalizes and validates optional CI code-signing secrets, exporting only non-empty verified values
 * to GITHUB_ENV and setting `ad_hoc` on GITHUB_OUTPUT.
 */
export function configureCodeSign({
  env = process.env,
  platform = process.platform,
  execFileSyncFn = execFileSync,
  logger = console,
} = {}) {
  const runnerOs = String(env.RUNNER_OS ?? '');
  const envFile = env.GITHUB_ENV ?? '';
  const outputFile = env.GITHUB_OUTPUT ?? '';

  if (runnerOs === 'macOS' || (!runnerOs && platform === 'darwin')) {
    return configureMacOSCodeSign({ env, envFile, outputFile, platform, execFileSyncFn, logger });
  }

  if (runnerOs === 'Windows' || (!runnerOs && platform === 'win32')) {
    return configureWindowsCodeSign({ env, envFile, outputFile, logger });
  }

  appendGithubOutput(outputFile, 'ad_hoc', 'false');
  logger.log('Linux code signing: not applicable');
  return { mode: 'none', adHoc: false };
}

if (isDirectExecution(import.meta.url)) {
  try {
    configureCodeSign();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
