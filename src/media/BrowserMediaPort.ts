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

function mapGetUserMediaError(error: unknown): MediaErrorCode {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = String((error as { name: unknown }).name);
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return 'permission_denied';
    }
  }
  return 'media_unavailable';
}

function stopStreamTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * Browser MediaPort implementation backed by navigator.mediaDevices and RTCPeerConnection.
 * Degrades gracefully when media APIs are missing or permissions are denied.
 */
export class BrowserMediaPort implements MediaPort {
  private snapshot: MediaStateSnapshot = createInitialMediaSnapshot();
  private readonly listeners = new Set<(event: MediaPortEvent) => void>();
  private signalSender: ((signal: CallSignal) => Promise<void>) | null = null;
  private localParticipantId: string | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private cameraStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private pendingOffer: RTCSessionDescriptionInit | null = null;
  private audioContext: AudioContext | null = null;
  private audioTimer: ReturnType<typeof setInterval> | null = null;

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

  private async enumerateMediaDevices(): Promise<{
    cameras: MediaDeviceOption[];
    microphones: MediaDeviceOption[];
  }> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return { cameras: [], microphones: [] };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras: MediaDeviceOption[] = [];
      const microphones: MediaDeviceOption[] = [];
      for (const device of devices) {
        if (!device.deviceId) continue;
        if (device.kind === 'videoinput') {
          cameras.push({
            deviceId: device.deviceId,
            label: device.label || `Camera ${cameras.length + 1}`,
            kind: 'videoinput',
          });
        } else if (device.kind === 'audioinput') {
          microphones.push({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${microphones.length + 1}`,
            kind: 'audioinput',
          });
        }
      }
      return { cameras, microphones };
    } catch {
      return { cameras: [], microphones: [] };
    }
  }

  async refreshDevices(): Promise<void> {
    const { cameras, microphones } = await this.enumerateMediaDevices();
    this.updateSnapshot({
      cameras,
      microphones,
      selectedCameraId: this.snapshot.selectedCameraId ?? cameras[0]?.deviceId ?? null,
      selectedMicrophoneId:
        this.snapshot.selectedMicrophoneId ?? microphones[0]?.deviceId ?? null,
    });
  }

  private startAudioMeter(stream: MediaStream): void {
    this.stopAudioMeter();
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx || stream.getAudioTracks().length === 0) return;

    try {
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      this.audioContext = ctx;
      this.audioTimer = setInterval(() => {
        if (!this.snapshot.micEnabled) {
          if (this.snapshot.audioLevel !== 0) {
            this.updateSnapshot({ audioLevel: 0 });
          }
          return;
        }
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
        }
        const avg = data.length > 0 ? sum / data.length : 0;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        this.updateSnapshot({ audioLevel: normalized });
      }, 180);
    } catch {
      // Ignore AudioContext failures in restricted environments
    }
  }

  private stopAudioMeter(): void {
    if (this.audioTimer) {
      clearInterval(this.audioTimer);
      this.audioTimer = null;
    }
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  private async acquireStream(
    cameraId?: string | null,
    microphoneId?: string | null,
  ): Promise<MediaStream | null> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.updateSnapshot({ error: 'media_unavailable' });
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
      });
      return stream;
    } catch (error) {
      this.updateSnapshot({ error: mapGetUserMediaError(error) });
      return null;
    }
  }

  async startPreview(options?: {
    cameraId?: string | null;
    microphoneId?: string | null;
  }): Promise<boolean> {
    const cameraId = options?.cameraId ?? this.snapshot.selectedCameraId;
    const microphoneId = options?.microphoneId ?? this.snapshot.selectedMicrophoneId;

    const stream = await this.acquireStream(cameraId, microphoneId);
    if (!stream) {
      this.updateSnapshot({ phase: 'idle' });
      return false;
    }

    stopStreamTracks(this.cameraStream);
    this.cameraStream = stream;

    const { cameras, microphones } = await this.enumerateMediaDevices();
    const activeVideoTrack = stream.getVideoTracks()[0];
    const activeAudioTrack = stream.getAudioTracks()[0];

    const resolvedCameraId =
      cameraId ??
      activeVideoTrack?.getSettings?.().deviceId ??
      cameras[0]?.deviceId ??
      null;
    const resolvedMicId =
      microphoneId ??
      activeAudioTrack?.getSettings?.().deviceId ??
      microphones[0]?.deviceId ??
      null;

    this.updateSnapshot({
      phase: 'previewing',
      localStream: stream,
      cameras,
      microphones,
      selectedCameraId: resolvedCameraId,
      selectedMicrophoneId: resolvedMicId,
      micEnabled: true,
      cameraEnabled: true,
      error: null,
    });
    this.startAudioMeter(stream);
    return true;
  }

  stopPreview(): void {
    if (this.snapshot.phase !== 'previewing') return;
    this.stopAudioMeter();
    stopStreamTracks(this.cameraStream);
    this.cameraStream = null;
    this.updateSnapshot({
      phase: 'idle',
      localStream: null,
      audioLevel: 0,
      screenSharing: false,
    });
  }

  private async replaceDeviceStream(
    cameraId: string | null,
    microphoneId: string | null,
  ): Promise<void> {
    const nextStream = await this.acquireStream(cameraId, microphoneId);
    if (!nextStream) return;

    for (const track of nextStream.getAudioTracks()) {
      track.enabled = this.snapshot.micEnabled;
    }
    for (const track of nextStream.getVideoTracks()) {
      track.enabled = this.snapshot.cameraEnabled;
    }

    if (this.peerConnection) {
      const senders = this.peerConnection.getSenders();
      const nextAudio = nextStream.getAudioTracks()[0];
      const nextVideo = nextStream.getVideoTracks()[0];
      for (const sender of senders) {
        if (sender.track?.kind === 'audio' && nextAudio) {
          await sender.replaceTrack(nextAudio);
        } else if (sender.track?.kind === 'video' && nextVideo && !this.snapshot.screenSharing) {
          await sender.replaceTrack(nextVideo);
        }
      }
    }

    stopStreamTracks(this.cameraStream);
    this.cameraStream = nextStream;
    this.startAudioMeter(nextStream);
    this.updateSnapshot({
      localStream: this.snapshot.screenSharing ? this.screenStream : nextStream,
      selectedCameraId: cameraId,
      selectedMicrophoneId: microphoneId,
    });
  }

  async selectCamera(deviceId: string): Promise<void> {
    if (this.snapshot.phase === 'idle') {
      this.updateSnapshot({ selectedCameraId: deviceId });
      return;
    }
    await this.replaceDeviceStream(deviceId, this.snapshot.selectedMicrophoneId);
  }

  async selectMicrophone(deviceId: string): Promise<void> {
    if (this.snapshot.phase === 'idle') {
      this.updateSnapshot({ selectedMicrophoneId: deviceId });
      return;
    }
    await this.replaceDeviceStream(this.snapshot.selectedCameraId, deviceId);
  }

  private ensurePeerConnection(): RTCPeerConnection | null {
    if (this.peerConnection) return this.peerConnection;
    if (typeof RTCPeerConnection === 'undefined') return null;

    const pc = new RTCPeerConnection({
      iceServers: [],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && this.signalSender && this.localParticipantId) {
        void this.signalSender({
          type: 'ice',
          fromId: this.localParticipantId,
          payload: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.updateSnapshot({ remoteStream, remoteInCall: true });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.updateSnapshot({ error: 'connection_failed' });
      }
    };

    this.peerConnection = pc;
    return pc;
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

  async startCall(options: StartCallOptions): Promise<boolean> {
    this.localParticipantId = options.localParticipantId;

    if (!this.cameraStream) {
      const ok = await this.startPreview({
        cameraId: options.cameraId,
        microphoneId: options.microphoneId,
      });
      if (!ok || !this.cameraStream) {
        return false;
      }
    }

    const micEnabled = options.micEnabled ?? this.snapshot.micEnabled;
    const cameraEnabled = options.cameraEnabled ?? this.snapshot.cameraEnabled;

    for (const track of this.cameraStream.getAudioTracks()) {
      track.enabled = micEnabled;
    }
    for (const track of this.cameraStream.getVideoTracks()) {
      track.enabled = cameraEnabled;
    }

    try {
      const pc = this.ensurePeerConnection();
      if (pc) {
        const existingTracks = new Set(pc.getSenders().map((s) => s.track));
        for (const track of this.cameraStream.getTracks()) {
          if (!existingTracks.has(track)) {
            pc.addTrack(track, this.cameraStream);
          }
        }

        if (this.pendingOffer) {
          const offerToApply = this.pendingOffer;
          this.pendingOffer = null;
          await pc.setRemoteDescription(offerToApply);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (this.signalSender) {
            await this.signalSender({
              type: 'answer',
              fromId: options.localParticipantId,
              payload: answer,
            });
          }
        } else {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (this.signalSender) {
            await this.signalSender({
              type: 'offer',
              fromId: options.localParticipantId,
              payload: offer,
            });
          }
        }
      }

      this.updateSnapshot({
        phase: 'active',
        localStream: this.cameraStream,
        micEnabled,
        cameraEnabled,
        screenSharing: false,
        error: null,
      });

      await this.sendMediaStateSignal();
      return true;
    } catch {
      this.updateSnapshot({ phase: 'idle', error: 'connection_failed' });
      return false;
    }
  }

  async endCall(): Promise<void> {
    const wasActive = this.snapshot.phase === 'active';
    const participantId = this.localParticipantId;
    this.localParticipantId = null;
    this.pendingOffer = null;
    this.stopAudioMeter();

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    stopStreamTracks(this.screenStream);
    this.screenStream = null;
    stopStreamTracks(this.cameraStream);
    this.cameraStream = null;

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
    if (this.cameraStream) {
      for (const track of this.cameraStream.getAudioTracks()) {
        track.enabled = enabled;
      }
    }
    this.updateSnapshot({
      micEnabled: enabled,
      audioLevel: enabled ? this.snapshot.audioLevel : 0,
    });
    if (this.snapshot.phase === 'active') {
      await this.sendMediaStateSignal();
    }
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (this.cameraStream) {
      for (const track of this.cameraStream.getVideoTracks()) {
        track.enabled = enabled;
      }
    }
    this.updateSnapshot({ cameraEnabled: enabled });
    if (this.snapshot.phase === 'active') {
      await this.sendMediaStateSignal();
    }
  }

  async startScreenShare(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      this.updateSnapshot({ error: 'screen_share_denied' });
      return false;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) {
        stopStreamTracks(displayStream);
        this.updateSnapshot({ error: 'screen_share_denied' });
        return false;
      }

      screenTrack.onended = () => {
        void this.stopScreenShare();
      };

      if (this.peerConnection) {
        const videoSender = this.peerConnection
          .getSenders()
          .find((s) => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
        }
      }

      stopStreamTracks(this.screenStream);
      this.screenStream = displayStream;

      this.updateSnapshot({
        screenSharing: true,
        localStream: displayStream,
        error: null,
      });
      if (this.snapshot.phase === 'active') {
        await this.sendMediaStateSignal();
      }
      return true;
    } catch {
      this.updateSnapshot({ error: 'screen_share_denied' });
      return false;
    }
  }

  async stopScreenShare(): Promise<void> {
    if (!this.snapshot.screenSharing) return;

    stopStreamTracks(this.screenStream);
    this.screenStream = null;

    if (this.peerConnection && this.cameraStream) {
      const cameraTrack = this.cameraStream.getVideoTracks()[0];
      const videoSender = this.peerConnection
        .getSenders()
        .find((s) => s.track?.kind === 'video');
      if (videoSender && cameraTrack) {
        await videoSender.replaceTrack(cameraTrack);
      }
    }

    this.updateSnapshot({
      screenSharing: false,
      localStream: this.cameraStream,
    });
    if (this.snapshot.phase === 'active') {
      await this.sendMediaStateSignal();
    }
  }

  async handleSignal(signal: CallSignal): Promise<void> {
    const remoteStateResult = applyRemoteMediaStateSignal(this.snapshot, signal);
    if (remoteStateResult) {
      if (signal.type === 'hangup') {
        this.pendingOffer = null;
      }
      this.updateSnapshot(remoteStateResult.patch);
      for (const event of remoteStateResult.events) {
        this.emit(event);
      }
      return;
    }

    if (signal.type === 'offer' && signal.payload) {
      const offer = signal.payload as RTCSessionDescriptionInit;
      if (this.snapshot.phase !== 'active') {
        this.pendingOffer = offer;
        return;
      }
      const pc = this.ensurePeerConnection();
      if (!pc) return;
      try {
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (this.signalSender && this.localParticipantId) {
          await this.signalSender({
            type: 'answer',
            fromId: this.localParticipantId,
            payload: answer,
          });
        }
      } catch {
        this.updateSnapshot({ error: 'connection_failed' });
      }
      return;
    }

    if (signal.type === 'answer' && signal.payload) {
      const pc = this.peerConnection;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
      } catch {
        this.updateSnapshot({ error: 'connection_failed' });
      }
      return;
    }

    if (signal.type === 'ice' && signal.payload) {
      const pc = this.peerConnection;
      if (!pc || !pc.remoteDescription) return;
      try {
        await pc.addIceCandidate(signal.payload as RTCIceCandidateInit);
      } catch {
        // Ignore stale ICE candidates
      }
    }
  }

  clearError(): void {
    this.updateSnapshot({ error: null });
  }

  dispose(): void {
    void this.endCall();
    this.signalSender = null;
    this.listeners.clear();
  }
}
