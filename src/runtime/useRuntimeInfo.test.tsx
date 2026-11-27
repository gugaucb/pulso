import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeInfo } from '../domain/types';
import { useRuntimeInfo } from './useRuntimeInfo';

function Probe({
  overrideRuntimeInfo,
  pollIntervalMs,
  locationOrigin,
  locationHostname,
}: {
  overrideRuntimeInfo?: RuntimeInfo;
  pollIntervalMs?: number;
  locationOrigin?: string;
  locationHostname?: string;
}) {
  const info = useRuntimeInfo(overrideRuntimeInfo, {
    pollIntervalMs,
    locationOrigin,
    locationHostname,
  });
  return <pre data-testid="runtime">{JSON.stringify(info)}</pre>;
}

describe('useRuntimeInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns override runtimeInfo directly without calling fetch and updates when prop changes', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const onion = `http://${'a'.repeat(56)}.onion`;

    const { rerender } = render(
      <Probe overrideRuntimeInfo={{ runtimeMode: 'tor', torStatus: 'bootstrapping' }} />,
    );
    expect(JSON.parse(screen.getByTestId('runtime').textContent!)).toEqual({
      runtimeMode: 'tor',
      torStatus: 'bootstrapping',
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    rerender(
      <Probe
        overrideRuntimeInfo={{
          runtimeMode: 'tor',
          torStatus: 'ready',
          onionAddress: onion,
        }}
      />,
    );
    expect(JSON.parse(screen.getByTestId('runtime').textContent!)).toEqual({
      runtimeMode: 'tor',
      torStatus: 'ready',
      onionAddress: onion,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats .onion browser origin as ready Tor runtime without fetching /api/runtime', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const host = `${'c'.repeat(56)}.onion`;
    const origin = `http://${host}`;

    render(<Probe locationHostname={host} locationOrigin={origin} />);

    expect(JSON.parse(screen.getByTestId('runtime').textContent!)).toEqual({
      runtimeMode: 'tor',
      onionAddress: origin,
      torStatus: 'ready',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('queries GET /api/runtime on mount and polls while bootstrapping until ready', async () => {
    const onion = `http://${'d'.repeat(56)}.onion`;
    const responses: RuntimeInfo[] = [
      { runtimeMode: 'tor', torStatus: 'bootstrapping' },
      { runtimeMode: 'tor', torStatus: 'bootstrapping' },
      { runtimeMode: 'tor', torStatus: 'ready', onionAddress: onion },
    ];
    let callCount = 0;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const payload = responses[Math.min(callCount, responses.length - 1)];
      callCount += 1;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    render(<Probe pollIntervalMs={10} />);

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('runtime').textContent!)).toEqual({
        runtimeMode: 'tor',
        torStatus: 'ready',
        onionAddress: onion,
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/runtime',
      expect.objectContaining({ cache: 'no-store' }),
    );
    const countAfterReady = fetchMock.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(fetchMock.mock.calls.length).toBe(countAfterReady);
  });

  it('falls back gracefully to normal runtime when /api/runtime fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network down'));

    render(<Probe pollIntervalMs={10} />);

    await new Promise((r) => setTimeout(r, 25));
    expect(JSON.parse(screen.getByTestId('runtime').textContent!)).toEqual({
      runtimeMode: 'normal',
    });
  });

  it('polls while normal mode tunnelActive is true and publicOrigin is pending, then stops once ready', async () => {
    const responses: RuntimeInfo[] = [
      { runtimeMode: 'normal', tunnelActive: true, tunnelProvider: 'cloudflare' },
      {
        runtimeMode: 'normal',
        tunnelActive: true,
        tunnelProvider: 'cloudflare',
        publicOrigin: 'https://pending-ready.trycloudflare.com',
      },
    ];
    let callCount = 0;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const payload = responses[Math.min(callCount, responses.length - 1)];
      callCount += 1;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    render(<Probe pollIntervalMs={10} />);

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('runtime').textContent!)).toEqual({
        runtimeMode: 'normal',
        tunnelActive: true,
        tunnelProvider: 'cloudflare',
        publicOrigin: 'https://pending-ready.trycloudflare.com',
      });
    });

    const countAfterReady = fetchMock.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(fetchMock.mock.calls.length).toBe(countAfterReady);
  });

  it('refreshes /api/runtime on window focus and visible visibilitychange when tunnel becomes ready later', async () => {
    const responses: RuntimeInfo[] = [
      { runtimeMode: 'normal', tunnelActive: false },
      {
        runtimeMode: 'normal',
        tunnelActive: true,
        tunnelProvider: 'cloudflare',
        publicOrigin: 'https://focus-refresh.trycloudflare.com',
      },
      {
        runtimeMode: 'normal',
        tunnelActive: true,
        tunnelProvider: 'cloudflare',
        publicOrigin: 'https://visibility-refresh.trycloudflare.com',
      },
    ];
    let callCount = 0;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const payload = responses[Math.min(callCount, responses.length - 1)];
      callCount += 1;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    render(<Probe pollIntervalMs={10} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(JSON.parse(screen.getByTestId('runtime').textContent!)).toEqual({
      runtimeMode: 'normal',
      tunnelActive: false,
    });

    // No idle polling happens without focus/visibility
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.focus(window);
    });

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('runtime').textContent!)).toEqual({
        runtimeMode: 'normal',
        tunnelActive: true,
        tunnelProvider: 'cloudflare',
        publicOrigin: 'https://focus-refresh.trycloudflare.com',
      });
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('runtime').textContent!)).toEqual({
        runtimeMode: 'normal',
        tunnelActive: true,
        tunnelProvider: 'cloudflare',
        publicOrigin: 'https://visibility-refresh.trycloudflare.com',
      });
    });
  });
});
