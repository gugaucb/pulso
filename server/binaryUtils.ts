import { execFileSync } from 'node:child_process';
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Checks whether `filePath` exists as a regular file and is executable on the given platform.
 */
export function isExecutableFile(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    const mode = platform === 'win32' ? constants.F_OK : constants.X_OK;
    accessSync(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures Mach-O executables on macOS (especially Apple Silicon arm64) carry a valid code signature.
 * Unsigned arm64 binaries are terminated by the macOS kernel with SIGKILL (code 137).
 */
export function ensureDarwinBinarySigned(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform,
  execFileImpl: typeof execFileSync = execFileSync,
): void {
  if (platform !== 'darwin') return;
  try {
    execFileImpl('codesign', ['-v', binaryPath], { stdio: 'ignore' });
  } catch {
    try {
      const binDir = path.dirname(binaryPath);
      try {
        for (const entry of readdirSync(binDir)) {
          if (!entry.endsWith('.dylib')) continue;
          const candidate = path.join(binDir, entry);
          if (statSync(candidate).isFile()) {
            execFileImpl('codesign', ['-s', '-', '--force', candidate], { stdio: 'ignore' });
          }
        }
      } catch {
        // sibling dylibs are optional
      }
      execFileImpl('codesign', ['-s', '-', '--force', binaryPath], { stdio: 'ignore' });
    } catch {
      // If codesign fails or is unavailable, let execution proceed to spawn
    }
  }
}
