import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Computes the lowercase hexadecimal SHA-256 digest of a file via streaming read.
 */
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
 * Returns true only when the calling module (`import.meta.url`) is executed directly from CLI
 * outside Vitest.
 */
export function isDirectExecution(importMetaUrl) {
  if (process.env.VITEST) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(importMetaUrl) === realpathSync(entry);
  } catch {
    return fileURLToPath(importMetaUrl) === path.resolve(entry);
  }
}

/**
 * Extracts a `.tar.gz` archive into `outDir` safely across POSIX and Windows runners.
 * Avoids passing Windows `D:\...` drive prefixes to MSYS2 GNU `tar` (which treats `D:` as a remote SSH host).
 */
export function extractTarGz(
  archivePath,
  outDir,
  { platform = process.platform, execFileSyncFn = execFileSync } = {},
) {
  const pathMod = platform === 'win32' ? path.win32 : path.posix;
  const rel = pathMod.relative(outDir, archivePath);

  if (rel && !rel.startsWith('..') && !pathMod.isAbsolute(rel) && !rel.includes(':')) {
    const safeRel = platform === 'win32' ? rel.replace(/\\/g, '/') : rel;
    execFileSyncFn('tar', ['-xzf', safeRel], { cwd: outDir, stdio: 'inherit' });
    return;
  }

  if (platform === 'win32') {
    const formattedArchive = String(archivePath).replace(/\\/g, '/');
    const formattedOutDir = String(outDir).replace(/\\/g, '/');
    execFileSyncFn('tar', ['--force-local', '-xzf', formattedArchive, '-C', formattedOutDir], {
      stdio: 'inherit',
    });
    return;
  }

  execFileSyncFn('tar', ['-xzf', archivePath, '-C', outDir], { stdio: 'inherit' });
}
