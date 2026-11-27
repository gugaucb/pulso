import { createHmac, randomBytes } from 'node:crypto';
import { systemClock, type Clock } from './clock';

export const SECRET_BYTES = 32;
export const MAX_WS_PAYLOAD_BYTES = 64 * 1024;
export const DEFAULT_MAX_ROOMS = 1000;
export const DEFAULT_SECRET_ROTATION_MS = 60 * 60 * 1000;

export const DEFAULT_WS_CONNECT_MAX = 60;
export const DEFAULT_WS_CONNECT_WINDOW_MS = 60 * 1000;
export const DEFAULT_CREATE_ROOM_MAX = 20;
export const DEFAULT_CREATE_ROOM_WINDOW_MS = 60 * 1000;
export const DEFAULT_FAILED_JOIN_MAX = 15;
export const DEFAULT_FAILED_JOIN_WINDOW_MS = 5 * 60 * 1000;

export interface SecurityOptions {
  secretRotationMs?: number;
  wsConnectMax?: number;
  wsConnectWindowMs?: number;
  createRoomMax?: number;
  createRoomWindowMs?: number;
  failedJoinMax?: number;
  failedJoinWindowMs?: number;
}

export type OperationalNoticeEvent =
  | { event: 'server_listening'; port: number }
  | { event: 'server_stopping' }
  | { event: 'server_stopped' }
  | { event: 'server_start_failed'; code?: string };

function resolvePositiveInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/**
 * In-RAM sliding-window counter keyed strictly by anonymized origin hashes.
 */
class SlidingWindowBucketMap {
  private readonly buckets = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  private pruneKey(key: string, now: number): number[] {
    const existing = this.buckets.get(key);
    if (!existing || existing.length === 0) {
      return [];
    }
    const cutoff = now - this.windowMs;
    const recent = existing.filter((ts) => ts > cutoff);
    if (recent.length === 0) {
      this.buckets.delete(key);
    } else if (recent.length !== existing.length) {
      this.buckets.set(key, recent);
    }
    return recent;
  }

  isExceeded(key: string, now: number): boolean {
    return this.pruneKey(key, now).length >= this.max;
  }

  record(key: string, now: number): void {
    const recent = this.pruneKey(key, now);
    recent.push(now);
    this.buckets.set(key, recent);
  }

  consume(key: string, now: number): boolean {
    const recent = this.pruneKey(key, now);
    if (recent.length >= this.max) {
      return false;
    }
    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }

  clear(): void {
    this.buckets.clear();
  }
}

/**
 * In-RAM zero-trace security coordinator.
 * Derives anonymous origin keys via HMAC-SHA256 with a rotating 256-bit secret
 * and enforces sliding-window rate limits without ever storing raw IPs.
 */
export class SecurityManager {
  private readonly clock: Clock;
  private readonly secretRotationMs: number;
  private readonly wsConnectLimiter: SlidingWindowBucketMap;
  private readonly createRoomLimiter: SlidingWindowBucketMap;
  private readonly failedJoinLimiter: SlidingWindowBucketMap;
  private currentSecret: Buffer;
  private secretRotatedAt: number;

  constructor(clock: Clock = systemClock, options: SecurityOptions = {}) {
    this.clock = clock;
    this.secretRotationMs = resolvePositiveInt(
      options.secretRotationMs,
      DEFAULT_SECRET_ROTATION_MS,
    );
    this.wsConnectLimiter = new SlidingWindowBucketMap(
      resolvePositiveInt(options.wsConnectMax, DEFAULT_WS_CONNECT_MAX),
      resolvePositiveInt(options.wsConnectWindowMs, DEFAULT_WS_CONNECT_WINDOW_MS),
    );
    this.createRoomLimiter = new SlidingWindowBucketMap(
      resolvePositiveInt(options.createRoomMax, DEFAULT_CREATE_ROOM_MAX),
      resolvePositiveInt(options.createRoomWindowMs, DEFAULT_CREATE_ROOM_WINDOW_MS),
    );
    this.failedJoinLimiter = new SlidingWindowBucketMap(
      resolvePositiveInt(options.failedJoinMax, DEFAULT_FAILED_JOIN_MAX),
      resolvePositiveInt(options.failedJoinWindowMs, DEFAULT_FAILED_JOIN_WINDOW_MS),
    );
    this.currentSecret = randomBytes(SECRET_BYTES);
    this.secretRotatedAt = this.clock.now();
  }

  /**
   * Returns a non-reversible HMAC-SHA256 digest for the origin IP.
   */
  hashOrigin(ip: string): string {
    this.rotateSecretIfDue();
    const normalized = ip.trim() || 'unknown';
    return createHmac('sha256', this.currentSecret).update(normalized).digest('hex');
  }

  allowWsConnect(originHash: string): boolean {
    const now = this.rotateSecretIfDue();
    return this.wsConnectLimiter.consume(originHash, now);
  }

  allowCreateRoom(originHash: string): boolean {
    const now = this.rotateSecretIfDue();
    return this.createRoomLimiter.consume(originHash, now);
  }

  isFailedJoinRateLimited(originHash: string): boolean {
    const now = this.rotateSecretIfDue();
    return this.failedJoinLimiter.isExceeded(originHash, now);
  }

  recordFailedJoin(originHash: string): void {
    const now = this.rotateSecretIfDue();
    this.failedJoinLimiter.record(originHash, now);
  }

  private rotateSecretIfDue(): number {
    const now = this.clock.now();
    if (now - this.secretRotatedAt < this.secretRotationMs) {
      return now;
    }
    this.currentSecret.fill(0);
    this.currentSecret = randomBytes(SECRET_BYTES);
    this.secretRotatedAt = now;
    this.wsConnectLimiter.clear();
    this.createRoomLimiter.clear();
    this.failedJoinLimiter.clear();
    return now;
  }
}

/**
 * Emits a strictly neutral operational lifecycle notice with zero user/network identifiers.
 */
export function logOperationalNotice(notice: OperationalNoticeEvent): void {
  switch (notice.event) {
    case 'server_listening':
      process.stdout.write(`[pulso] server_listening port=${Math.floor(notice.port)}\n`);
      break;
    case 'server_stopping':
      process.stdout.write('[pulso] server_stopping\n');
      break;
    case 'server_stopped':
      process.stdout.write('[pulso] server_stopped\n');
      break;
    case 'server_start_failed': {
      const safeCode =
        typeof notice.code === 'string' && /^[A-Z0-9_]+$/.test(notice.code)
          ? ` code=${notice.code}`
          : '';
      process.stderr.write(`[pulso] server_start_failed${safeCode}\n`);
      break;
    }
  }
}
