import { useEffect, useState } from 'react';
import { sanitizeRuntimeInfo } from '../../shared/protocol';
import { normalizeOnionAddress } from '../domain/onionAddress';
import type { RuntimeInfo } from '../domain/types';

const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_RUNTIME_INFO: RuntimeInfo = { runtimeMode: 'normal' };

export interface UseRuntimeInfoOptions {
  pollIntervalMs?: number;
  locationHostname?: string;
  locationOrigin?: string;
}

function resolveOnionOriginRuntime(options?: UseRuntimeInfoOptions): RuntimeInfo | null {
  const hostname =
    options?.locationHostname ??
    (typeof window !== 'undefined' ? window.location.hostname : '');
  if (!hostname.toLowerCase().endsWith('.onion')) {
    return null;
  }

  const origin =
    options?.locationOrigin ??
    (typeof window !== 'undefined' ? window.location.origin : '');
  const normalized = normalizeOnionAddress(origin) ?? origin;

  return {
    runtimeMode: 'tor',
    onionAddress: normalized,
    torStatus: 'ready',
  };
}

/**
 * Discovers live server runtime mode (`normal` vs `tor`) via GET /api/runtime,
 * polling briefly while Tor is bootstrapping, or returning immediately when overridden
 * or served from an `.onion` origin.
 */
export function useRuntimeInfo(
  override?: RuntimeInfo,
  options?: UseRuntimeInfoOptions,
): RuntimeInfo {
  const onionOriginRuntime = resolveOnionOriginRuntime(options);
  const [fetchedRuntime, setFetchedRuntime] = useState<RuntimeInfo>(DEFAULT_RUNTIME_INFO);
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  useEffect(() => {
    if (override || onionOriginRuntime || typeof fetch !== 'function') {
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const fetchRuntime = async () => {
      try {
        const res = await fetch('/api/runtime', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok || cancelled) return;
        const parsed = sanitizeRuntimeInfo(await res.json());
        if (cancelled) return;
        setFetchedRuntime(parsed);

        if (parsed.runtimeMode === 'tor' && parsed.torStatus === 'bootstrapping') {
          pollTimer = setTimeout(() => {
            if (!cancelled) {
              void fetchRuntime();
            }
          }, pollIntervalMs);
        }
      } catch {
        // Fallback silently to default normal runtime when offline or unmounted
      }
    };

    void fetchRuntime();

    return () => {
      cancelled = true;
      controller.abort();
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
  }, [Boolean(override), Boolean(onionOriginRuntime), pollIntervalMs]);

  return override ?? onionOriginRuntime ?? fetchedRuntime;
}
