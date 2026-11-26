import { normalizeOnionAddress } from './onionAddress';
import { formatRoomCode, isValidRoomCode } from './roomCode';
import type { RoomMode } from './types';

export interface BuildInviteUrlParams {
  origin: string;
  roomCode: string;
  secretKey?: string;
  mode?: RoomMode;
  onionAddress?: string;
}

export interface ParsedInviteUrl {
  roomCode: string;
  secretKey?: string;
  mode: RoomMode;
  onionAddress?: string;
}

/**
 * Builds an invite URL keeping any cryptographic secret solely inside the URL hash fragment.
 */
export function buildInviteUrl({
  origin,
  roomCode,
  secretKey,
  mode = 'normal',
  onionAddress,
}: BuildInviteUrlParams): string {
  const baseOrigin = mode === 'tor' && onionAddress ? onionAddress.replace(/\/+$/, '') : origin.replace(/\/+$/, '');
  const formattedCode = formatRoomCode(roomCode);
  const url = new URL(`${baseOrigin}/`);
  url.searchParams.set('room', formattedCode);

  if (mode === 'tor') {
    url.searchParams.set('mode', 'tor');
  }

  if (secretKey) {
    url.hash = `k=${encodeURIComponent(secretKey)}`;
  }

  return url.toString();
}

/**
 * Parses `/?room=XXXX-XXXX#k=...` or `/s/XXXX-XXXX#k=...` invite links.
 */
export function parseInviteUrl(rawUrl: string): ParsedInviteUrl | null {
  try {
    const url = new URL(rawUrl, 'https://pulso.local');
    let rawCode = url.searchParams.get('room');

    if (!rawCode) {
      const shortMatch = url.pathname.match(/^\/s\/([^/]+)\/?$/i);
      if (shortMatch) {
        rawCode = decodeURIComponent(shortMatch[1]);
      }
    }

    if (!rawCode || !isValidRoomCode(rawCode)) {
      return null;
    }

    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const secretKey = hashParams.get('k') ?? undefined;
    const rawOnionParam = url.searchParams.get('onion');
    const normalizedOnionParam = rawOnionParam ? normalizeOnionAddress(rawOnionParam) : null;
    const originOnion = url.hostname.endsWith('.onion') ? url.origin : undefined;
    const isTor =
      url.searchParams.get('mode') === 'tor' ||
      url.hostname.endsWith('.onion') ||
      rawOnionParam !== null;

    return {
      roomCode: formatRoomCode(rawCode),
      secretKey,
      mode: isTor ? 'tor' : 'normal',
      onionAddress: isTor ? (originOnion ?? normalizedOnionParam ?? undefined) : undefined,
    };
  } catch {
    return null;
  }
}
