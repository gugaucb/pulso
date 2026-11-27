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

function shouldPollRuntime(runtime: RuntimeInfo): boolean {
  if (runtime.runtimeMode === 'tor' && runtime.torStatus === 'bootstrapping') {
    return true;
  }
  if (runtime.runtimeMode === 'normal' && runtime.tunnelActive === true && !runtime.publicOrigin) {
    return true;
  }
  return false;
}

/**
 * Discovers live server runtime mode (`normal` vs `tor`) via GET /api/runtime,
 * polling briefly while Tor is bootstrapping or a normal-mode tunnel is pending its
 * public origin, and refreshing on window focus / visibility return.
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
    let inFlight = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const clearPollTimer = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const fetchRuntime = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      clearPollTimer();
      try {
        const res = await fetch('/api/runtime', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok || cancelled) return;
        const parsed = sanitizeRuntimeInfo(await res.json());
        if (cancelled) return;
        setFetchedRuntime(parsed);

        if (shouldPollRuntime(parsed)) {
          pollTimer = setTimeout(() => {
            if (!cancelled) {
              void fetchRuntime();
            }
          }, pollIntervalMs);
        }
      } catch {
        // Fallback silently to default normal runtime when offline or unmounted
      } finally {
        inFlight = false;
      }
    };

    const handleFocus = () => {
      void fetchRuntime();
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void fetchRuntime();
      }
    };

    void fetchRuntime();

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      cancelled = true;
      controller.abort();
      clearPollTimer();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [Boolean(override), Boolean(onionOriginRuntime), pollIntervalMs]);

  return override ?? onionOriginRuntime ?? fetchedRuntime;
}
