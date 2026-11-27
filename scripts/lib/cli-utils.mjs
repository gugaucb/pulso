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
