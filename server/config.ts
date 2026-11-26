export const DEFAULT_SERVER_PORT = 3001;

/**
 * Resolves a valid positive TCP port from `env.PORT`, falling back when missing or invalid.
 */
export function resolvePort(
  env: NodeJS.ProcessEnv = process.env,
  fallback: number = DEFAULT_SERVER_PORT,
): number {
  const raw = env.PORT;
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
