import { createHmac, randomBytes } from 'node:crypto';
import type { IceServerConfig } from '../shared/protocol';

const DEFAULT_GOOGLE_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];
const DEFAULT_TURN_TTL_SECONDS = 3600;

function parseUrlList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseTtlSeconds(raw: string | undefined): number {
  if (!raw) return DEFAULT_TURN_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TURN_TTL_SECONDS;
  }
  return parsed;
}

/**
 * Builds ICE server configurations for Normal mode rooms from environment variables.
 * Uses free public Google STUN servers by default when STUN_URLS is unset,
 * and supports static TURN credentials or coturn REST HMAC-SHA1 ephemeral credentials.
 */
export function buildIceServers(
  env: Record<string, string | undefined> = process.env,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): IceServerConfig[] {
  const servers: IceServerConfig[] = [];

  if (env.STUN_URLS === undefined) {
    servers.push({ urls: [...DEFAULT_GOOGLE_STUN_URLS] });
  } else {
    const customStun = parseUrlList(env.STUN_URLS);
    if (customStun.length > 0) {
      servers.push({ urls: customStun });
    }
  }

  const turnUrls = parseUrlList(env.TURN_URLS);
  if (turnUrls.length > 0) {
    const turnSecret = env.TURN_SECRET?.trim();
    if (turnSecret) {
      const ttlSeconds = parseTtlSeconds(env.TURN_TTL_SECONDS);
      const expiryUnix = Math.floor(nowSeconds) + ttlSeconds;
      const randomTag = randomBytes(6).toString('hex');
      const username = `${expiryUnix}:${randomTag}`;
      const credential = createHmac('sha1', turnSecret).update(username).digest('base64');
      servers.push({ urls: turnUrls, username, credential });
    } else {
      const username = env.TURN_USERNAME?.trim();
      const credential = env.TURN_CREDENTIAL?.trim();
      if (username && credential) {
        servers.push({ urls: turnUrls, username, credential });
      } else {
        servers.push({ urls: turnUrls });
      }
    }
  }

  return servers;
}

/**
 * Returns true if at least one ICE server entry configures a turn: or turns: relay URL.
 */
export function hasTurnConfigured(servers: IceServerConfig[]): boolean {
  for (const server of servers) {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    for (const rawUrl of urls) {
      if (typeof rawUrl === 'string' && /^turns?:/i.test(rawUrl.trim())) {
        return true;
      }
    }
  }
  return false;
}
