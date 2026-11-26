import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserMediaPort } from './BrowserMediaPort';

describe('BrowserMediaPort graceful degradation', () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

  afterEach(() => {
    if (originalMediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
    vi.restoreAllMocks();
  });

  it('reports media_unavailable when navigator.mediaDevices is missing', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
    });

    const port = new BrowserMediaPort();
    const ok = await port.startPreview();
    expect(ok).toBe(false);
    expect(port.getSnapshot().error).toBe('media_unavailable');
    port.dispose();
  });

  it('maps NotAllowedError to permission_denied and NotFoundError to media_unavailable', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Denied'), { name: 'NotAllowedError' }))
      .mockRejectedValueOnce(Object.assign(new Error('No camera'), { name: 'NotFoundError' }));

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia,
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
      configurable: true,
    });

    const port = new BrowserMediaPort();

    expect(await port.startPreview()).toBe(false);
    expect(port.getSnapshot().error).toBe('permission_denied');

    expect(await port.startPreview()).toBe(false);
    expect(port.getSnapshot().error).toBe('media_unavailable');

    expect(await port.startScreenShare()).toBe(false);
    expect(port.getSnapshot().error).toBe('screen_share_denied');

    port.dispose();
  });
});
