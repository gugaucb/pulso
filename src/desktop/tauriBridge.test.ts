import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareSemver, createTauriDesktopBridge } from './tauriBridge';

describe('tauriBridge', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
    vi.restoreAllMocks();
  });

  it('compares semver strings accurately', () => {
    expect(compareSemver('0.2.0', '0.1.0')).toBe(1);
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('0.1.0', '0.1.1')).toBe(-1);
  });

  it('blocks manual update fetch in Tor flavor and forwards commands to Tauri IPC', async () => {
    const invokeMock = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === 'get_flavor_info') {
        return { flavor: 'tor', appVersion: '0.1.0', torVersion: '16.0' };
      }
      return undefined;
    });
    const listenMock = vi.fn().mockResolvedValue(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    (window as unknown as Record<string, unknown>).__TAURI__ = {
      core: { invoke: invokeMock },
      event: { listen: listenMock },
    };

    const bridge = createTauriDesktopBridge();
    const info = await bridge.getFlavorInfo();
    expect(info.flavor).toBe('tor');

    const updateResult = await bridge.checkUpdatesManual?.();
    expect(updateResult).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    await bridge.startTorInstance({ bridgeMode: 'snowflake' });
    expect(invokeMock).toHaveBeenCalledWith('start_tor_instance', {
      bridgeMode: 'snowflake',
      customBridges: null,
    });

    await bridge.openInBrowser('http://127.0.0.1:41000');
    expect(invokeMock).toHaveBeenCalledWith('open_in_browser', {
      url: 'http://127.0.0.1:41000',
    });
  });
});
