import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserMediaPort } from './BrowserMediaPort';

describe('BrowserMediaPort graceful degradation', () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;

  afterEach(() => {
    if (originalMediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
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

  it('creates RTCPeerConnection with empty iceServers (zero external STUN requests) and enumerates devices via refreshDevices', async () => {
    const fakeTrack = {
      kind: 'video',
      enabled: true,
      stop: vi.fn(),
      getSettings: () => ({ deviceId: 'cam-1' }),
    };
    const fakeAudioTrack = {
      kind: 'audio',
      enabled: true,
      stop: vi.fn(),
      getSettings: () => ({ deviceId: 'mic-1' }),
    };
    const fakeStream = {
      getTracks: () => [fakeAudioTrack, fakeTrack],
      getAudioTracks: () => [fakeAudioTrack],
      getVideoTracks: () => [fakeTrack],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(fakeStream),
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: 'cam-1', label: 'Cam 1' },
          { kind: 'audioinput', deviceId: 'mic-1', label: 'Mic 1' },
        ]),
      },
      configurable: true,
    });

    const rtcConfigs: RTCConfiguration[] = [];
    class FakeRTCPeerConnection {
      onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
      ontrack: ((ev: RTCTrackEvent) => void) | null = null;
      onconnectionstatechange: (() => void) | null = null;
      connectionState = 'new';
      constructor(config: RTCConfiguration) {
        rtcConfigs.push(config);
      }
      getSenders() {
        return [];
      }
      addTrack() {}
      createOffer() {
        return Promise.resolve({ type: 'offer', sdp: 'v=0' } as RTCSessionDescriptionInit);
      }
      setLocalDescription() {
        return Promise.resolve();
      }
      close() {}
    }
    globalThis.RTCPeerConnection = FakeRTCPeerConnection as unknown as typeof RTCPeerConnection;

    const port = new BrowserMediaPort();
    await port.refreshDevices();
    expect(port.getSnapshot().cameras).toEqual([
      { deviceId: 'cam-1', label: 'Cam 1', kind: 'videoinput' },
    ]);
    expect(port.getSnapshot().microphones).toEqual([
      { deviceId: 'mic-1', label: 'Mic 1', kind: 'audioinput' },
    ]);

    const started = await port.startCall({ localParticipantId: 'host-1' });
    expect(started).toBe(true);
    expect(rtcConfigs).toHaveLength(1);
    expect(rtcConfigs[0].iceServers).toEqual([]);

    port.dispose();
  });
});
