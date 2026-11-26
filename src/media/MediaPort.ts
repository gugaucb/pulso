import type { CallSignal } from '../domain/types';

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
  kind: 'videoinput' | 'audioinput';
}

export type MediaErrorCode =
  | 'permission_denied'
  | 'media_unavailable'
  | 'screen_share_denied'
  | 'connection_failed';

export type MediaCallPhase = 'idle' | 'previewing' | 'active';

export interface MediaStateSignalPayload {
  inCall: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
}

export interface MediaStateSnapshot {
  phase: MediaCallPhase;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  cameras: MediaDeviceOption[];
  microphones: MediaDeviceOption[];
  selectedCameraId: string | null;
  selectedMicrophoneId: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  audioLevel: number;
  remoteInCall: boolean;
  remoteMicMuted: boolean;
  remoteCameraOff: boolean;
  remoteScreenSharing: boolean;
  error: MediaErrorCode | null;
}

export type MediaPortEvent =
  | { type: 'state'; snapshot: MediaStateSnapshot }
  | { type: 'peer_muted'; muted: boolean }
  | { type: 'peer_camera_off'; cameraOff: boolean }
  | { type: 'peer_left_call' };

export interface StartCallOptions {
  localParticipantId: string;
  cameraId?: string | null;
  microphoneId?: string | null;
  micEnabled?: boolean;
  cameraEnabled?: boolean;
}

/**
 * Single boundary isolating hardware media permissions, device enumeration,
 * local preview, screen sharing, and 1:1 call signaling/RTC lifecycle.
 */
export interface MediaPort {
  getSnapshot(): MediaStateSnapshot;
  subscribe(listener: (event: MediaPortEvent) => void): () => void;
  setSignalSender(sender: ((signal: CallSignal) => Promise<void>) | null): void;
  refreshDevices?(): Promise<void>;
  startPreview(options?: {
    cameraId?: string | null;
    microphoneId?: string | null;
  }): Promise<boolean>;
  stopPreview(): void;
  selectCamera(deviceId: string): Promise<void>;
  selectMicrophone(deviceId: string): Promise<void>;
  startCall(options: StartCallOptions): Promise<boolean>;
  endCall(): Promise<void>;
  setMicEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  startScreenShare(): Promise<boolean>;
  stopScreenShare(): Promise<void>;
  handleSignal(signal: CallSignal): Promise<void>;
  clearError(): void;
  dispose(): void;
}

export function createInitialMediaSnapshot(): MediaStateSnapshot {
  return {
    phase: 'idle',
    localStream: null,
    remoteStream: null,
    cameras: [],
    microphones: [],
    selectedCameraId: null,
    selectedMicrophoneId: null,
    micEnabled: true,
    cameraEnabled: true,
    screenSharing: false,
    audioLevel: 0,
    remoteInCall: false,
    remoteMicMuted: false,
    remoteCameraOff: false,
    remoteScreenSharing: false,
    error: null,
  };
}

export interface RemoteMediaSignalResult {
  patch: Partial<MediaStateSnapshot>;
  events: MediaPortEvent[];
}

export function applyRemoteMediaStateSignal(
  snapshot: MediaStateSnapshot,
  signal: CallSignal,
): RemoteMediaSignalResult | null {
  if (signal.type === 'hangup') {
    const events: MediaPortEvent[] = snapshot.remoteInCall ? [{ type: 'peer_left_call' }] : [];
    return {
      patch: {
        remoteInCall: false,
        remoteMicMuted: false,
        remoteCameraOff: false,
        remoteScreenSharing: false,
        remoteStream: null,
      },
      events,
    };
  }

  if (signal.type === 'media_state' && signal.payload && typeof signal.payload === 'object') {
    const payload = signal.payload as MediaStateSignalPayload;
    if (!payload.inCall) {
      const events: MediaPortEvent[] = snapshot.remoteInCall ? [{ type: 'peer_left_call' }] : [];
      return {
        patch: {
          remoteInCall: false,
          remoteMicMuted: false,
          remoteCameraOff: false,
          remoteScreenSharing: false,
          remoteStream: null,
        },
        events,
      };
    }

    const nextMuted = !payload.micEnabled;
    const nextCamOff = !payload.cameraEnabled;
    const events: MediaPortEvent[] = [];

    if (snapshot.remoteInCall && nextMuted !== snapshot.remoteMicMuted) {
      events.push({ type: 'peer_muted', muted: nextMuted });
    }
    if (snapshot.remoteInCall && nextCamOff !== snapshot.remoteCameraOff) {
      events.push({ type: 'peer_camera_off', cameraOff: nextCamOff });
    }

    return {
      patch: {
        remoteInCall: true,
        remoteMicMuted: nextMuted,
        remoteCameraOff: nextCamOff,
        remoteScreenSharing: payload.screenSharing,
      },
      events,
    };
  }

  return null;
}
