import type { CallSignal } from '../domain/types';
import {
  applyRemoteMediaStateSignal,
  createInitialMediaSnapshot,
  type MediaDeviceOption,
  type MediaErrorCode,
  type MediaPort,
  type MediaPortEvent,
  type MediaStateSignalPayload,
  type MediaStateSnapshot,
  type StartCallOptions,
} from './MediaPort';

export interface FakeMediaPortOptions {
  permissionDenied?: boolean;
  mediaUnavailable?: boolean;
  screenShareDenied?: boolean;
  connectionFailed?: boolean;
  cameras?: MediaDeviceOption[];
  microphones?: MediaDeviceOption[];
  initialAudioLevel?: number;
}

const DEFAULT_CAMERAS: MediaDeviceOption[] = [
  { deviceId: 'fake-cam-1', label: 'FaceTime HD Camera', kind: 'videoinput' },
  { deviceId: 'fake-cam-2', label: 'USB External Camera', kind: 'videoinput' },
];

const DEFAULT_MICROPHONES: MediaDeviceOption[] = [
  { deviceId: 'fake-mic-1', label: 'Built-in Microphone', kind: 'audioinput' },
  { deviceId: 'fake-mic-2', label: 'USB Headset Mic', kind: 'audioinput' },
];

/**
 * Deterministic in-memory MediaPort test double for integration and unit tests.
 */
export class FakeMediaPort implements MediaPort {
  private snapshot: MediaStateSnapshot = createInitialMediaSnapshot();
  private readonly listeners = new Set<(event: MediaPortEvent) => void>();
  private signalSender: ((signal: CallSignal) => Promise<void>) | null = null;
  private localParticipantId: string | null = null;

  private permissionDenied: boolean;
  private mediaUnavailable: boolean;
  private screenShareDenied: boolean;
  private connectionFailed: boolean;
  private readonly cameras: MediaDeviceOption[];
  private readonly microphones: MediaDeviceOption[];
  private readonly initialAudioLevel: number;

  constructor(options: FakeMediaPortOptions = {}) {
    this.permissionDenied = options.permissionDenied ?? false;
    this.mediaUnavailable = options.mediaUnavailable ?? false;
    this.screenShareDenied = options.screenShareDenied ?? false;
    this.connectionFailed = options.connectionFailed ?? false;
    this.cameras = options.cameras ?? DEFAULT_CAMERAS;
    this.microphones = options.microphones ?? DEFAULT_MICROPHONES;
    this.initialAudioLevel = options.initialAudioLevel ?? 42;
  }

  getSnapshot(): MediaStateSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (event: MediaPortEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: MediaPortEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private updateSnapshot(patch: Partial<MediaStateSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit({ type: 'state', snapshot: this.snapshot });
  }

  setSignalSender(sender: ((signal: CallSignal) => Promise<void>) | null): void {
    this.signalSender = sender;
  }

  private async sendMediaStateSignal(): Promise<void> {
    if (!this.signalSender || !this.localParticipantId) return;
    const payload: MediaStateSignalPayload = {
      inCall: this.snapshot.phase === 'active',
      micEnabled: this.snapshot.micEnabled,
      cameraEnabled: this.snapshot.cameraEnabled,
      screenSharing: this.snapshot.screenSharing,
    };
    await this.signalSender({
      type: 'media_state',
      fromId: this.localParticipantId,
      payload,
    });
  }

  private checkDeviceAvailability(): MediaErrorCode | null {
    if (this.permissionDenied) return 'permission_denied';
    if (this.mediaUnavailable) return 'media_unavailable';
    return null;
  }

  async refreshDevices(): Promise<void> {
    if (this.checkDeviceAvailability()) {
      return;
    }
    this.updateSnapshot({
      cameras: this.cameras,
      microphones: this.microphones,
      selectedCameraId:
        this.snapshot.selectedCameraId ?? this.cameras[0]?.deviceId ?? null,
      selectedMicrophoneId:
        this.snapshot.selectedMicrophoneId ?? this.microphones[0]?.deviceId ?? null,
    });
  }

  async startPreview(options?: {
    cameraId?: string | null;
    microphoneId?: string | null;
  }): Promise<boolean> {
    const deviceError = this.checkDeviceAvailability();
    if (deviceError) {
      this.updateSnapshot({ phase: 'idle', error: deviceError });
      return false;
    }

    const selectedCameraId =
      options?.cameraId ?? this.snapshot.selectedCameraId ?? this.cameras[0]?.deviceId ?? null;
    const selectedMicrophoneId =
      options?.microphoneId ??
      this.snapshot.selectedMicrophoneId ??
      this.microphones[0]?.deviceId ??
      null;

    this.updateSnapshot({
      phase: 'previewing',
      cameras: this.cameras,
      microphones: this.microphones,
      selectedCameraId,
      selectedMicrophoneId,
      micEnabled: true,
      cameraEnabled: true,
      audioLevel: this.initialAudioLevel,
      error: null,
    });
    return true;
  }

  stopPreview(): void {
    if (this.snapshot.phase !== 'previewing') return;
    this.updateSnapshot({
      phase: 'idle',
      audioLevel: 0,
      screenSharing: false,
    });
  }

  async selectCamera(deviceId: string): Promise<void> {
    if (!this.cameras.some((c) => c.deviceId === deviceId)) return;
    this.updateSnapshot({ selectedCameraId: deviceId });
  }

  async selectMicrophone(deviceId: string): Promise<void> {
    if (!this.microphones.some((m) => m.deviceId === deviceId)) return;
    this.updateSnapshot({ selectedMicrophoneId: deviceId });
  }

  async startCall(options: StartCallOptions): Promise<boolean> {
    const deviceError = this.checkDeviceAvailability();
    if (deviceError) {
      this.updateSnapshot({ phase: 'idle', error: deviceError });
      return false;
    }

    if (this.connectionFailed) {
      this.updateSnapshot({ phase: 'idle', error: 'connection_failed' });
      return false;
    }

    this.localParticipantId = options.localParticipantId;

    this.updateSnapshot({
      phase: 'active',
      cameras: this.cameras,
      microphones: this.microphones,
      selectedCameraId:
        options.cameraId ?? this.snapshot.selectedCameraId ?? this.cameras[0]?.deviceId ?? null,
      selectedMicrophoneId:
        options.microphoneId ??
        this.snapshot.selectedMicrophoneId ??
        this.microphones[0]?.deviceId ??
        null,
      micEnabled: options.micEnabled ?? this.snapshot.micEnabled,
      cameraEnabled: options.cameraEnabled ?? this.snapshot.cameraEnabled,
      screenSharing: false,
      error: null,
    });

    await this.sendMediaStateSignal();
    return true;
  }

  async endCall(): Promise<void> {
    const wasActive = this.snapshot.phase === 'active';
    const participantId = this.localParticipantId;
    this.localParticipantId = null;

    this.updateSnapshot({
      phase: 'idle',
      localStream: null,
      remoteStream: null,
      screenSharing: false,
      audioLevel: 0,
      micEnabled: true,
      cameraEnabled: true,
    });

    if (wasActive && this.signalSender && participantId) {
      await this.signalSender({
        type: 'hangup',
        fromId: participantId,
      });
    }
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    this.updateSnapshot({
      micEnabled: enabled,
      audioLevel: enabled ? this.initialAudioLevel : 0,
    });
    if (this.snapshot.phase === 'active') {
      await this.sendMediaStateSignal();
    }
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    this.updateSnapshot({ cameraEnabled: enabled });
    if (this.snapshot.phase === 'active') {
      await this.sendMediaStateSignal();
    }
  }

  async startScreenShare(): Promise<boolean> {
    if (this.screenShareDenied) {
      this.updateSnapshot({ error: 'screen_share_denied' });
      return false;
    }
    this.updateSnapshot({ screenSharing: true, error: null });
    if (this.snapshot.phase === 'active') {
      await this.sendMediaStateSignal();
    }
    return true;
  }

  async stopScreenShare(): Promise<void> {
    if (!this.snapshot.screenSharing) return;
    this.updateSnapshot({ screenSharing: false });
    if (this.snapshot.phase === 'active') {
      await this.sendMediaStateSignal();
    }
  }

  async handleSignal(signal: CallSignal): Promise<void> {
    const result = applyRemoteMediaStateSignal(this.snapshot, signal);
    if (!result) return;
    this.updateSnapshot(result.patch);
    for (const event of result.events) {
      this.emit(event);
    }
  }

  clearError(): void {
    this.updateSnapshot({ error: null });
  }

  dispose(): void {
    this.localParticipantId = null;
    this.signalSender = null;
    this.snapshot = createInitialMediaSnapshot();
    this.listeners.clear();
  }

  // --- Deterministic test helpers ---

  setPermissionDenied(denied: boolean): void {
    this.permissionDenied = denied;
  }

  setMediaUnavailable(unavailable: boolean): void {
    this.mediaUnavailable = unavailable;
  }

  setConnectionFailed(failed: boolean): void {
    this.connectionFailed = failed;
  }

  simulatePeerJoinedCall(): void {
    this.updateSnapshot({
      remoteInCall: true,
      remoteMicMuted: false,
      remoteCameraOff: false,
      remoteScreenSharing: false,
    });
  }

  simulatePeerMuted(muted = true): void {
    this.updateSnapshot({
      remoteInCall: true,
      remoteMicMuted: muted,
    });
    this.emit({ type: 'peer_muted', muted });
  }

  simulatePeerCameraOff(cameraOff = true): void {
    this.updateSnapshot({
      remoteInCall: true,
      remoteCameraOff: cameraOff,
    });
    this.emit({ type: 'peer_camera_off', cameraOff });
  }

  simulatePeerLeftCall(): void {
    this.updateSnapshot({
      remoteInCall: false,
      remoteMicMuted: false,
      remoteCameraOff: false,
      remoteScreenSharing: false,
      remoteStream: null,
    });
    this.emit({ type: 'peer_left_call' });
  }

  simulateMediaError(error: MediaErrorCode): void {
    this.updateSnapshot({ error });
  }
}
