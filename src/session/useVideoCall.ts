import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CallLayout,
  IceServerConfig,
  Participant,
  RoomMode,
  TransportEvent,
} from '../domain/types';
import { BrowserMediaPort } from '../media/BrowserMediaPort';
import {
  createInitialMediaSnapshot,
  type MediaErrorCode,
  type MediaPort,
  type MediaPortEvent,
  type MediaStateSnapshot,
} from '../media/MediaPort';
import type { RoomTransport } from '../transport/RoomTransport';

export type RemoteCallNoticeKind = 'muted' | 'cameraOff' | 'leftCall';

export interface UseVideoCallOptions {
  transport: RoomTransport;
  mediaPort?: MediaPort;
  localParticipant: Participant | null;
  remoteParticipant: Participant | null;
  isInRoom: boolean;
  roomMode?: RoomMode;
  iceServers?: IceServerConfig[];
}

export interface VideoCallController {
  snapshot: MediaStateSnapshot;
  isCallActive: boolean;
  previewOpen: boolean;
  layout: CallLayout;
  focusChatOpen: boolean;
  activeNotices: RemoteCallNoticeKind[];
  error: MediaErrorCode | null;
  openPreview: () => Promise<void>;
  closePreview: () => void;
  confirmStartCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  selectCamera: (deviceId: string) => Promise<void>;
  selectMicrophone: (deviceId: string) => Promise<void>;
  refreshDevices: () => Promise<void>;
  setLayout: (layout: CallLayout) => void;
  setFocusChatOpen: (open: boolean) => void;
  dismissNotice: (kind: RemoteCallNoticeKind) => void;
  dismissError: () => void;
}

export function useVideoCall({
  transport,
  mediaPort: providedMediaPort,
  localParticipant,
  isInRoom,
  roomMode = 'normal',
  iceServers,
}: UseVideoCallOptions): VideoCallController {
  const isTorMode = roomMode === 'tor';
  const ownsMediaPortRef = useRef(false);
  const mediaPortRef = useRef<MediaPort | null>(null);

  if (!isTorMode && !mediaPortRef.current) {
    if (providedMediaPort) {
      mediaPortRef.current = providedMediaPort;
      ownsMediaPortRef.current = false;
    } else {
      mediaPortRef.current = new BrowserMediaPort();
      ownsMediaPortRef.current = true;
    }
  }

  const [snapshot, setSnapshot] = useState<MediaStateSnapshot>(() =>
    createInitialMediaSnapshot(),
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [layout, setLayout] = useState<CallLayout>('hybrid');
  const [focusChatOpen, setFocusChatOpen] = useState(false);
  const [activeNotices, setActiveNotices] = useState<RemoteCallNoticeKind[]>([]);

  useEffect(() => {
    if (isTorMode || !isInRoom) {
      setPreviewOpen(false);
      setLayout('hybrid');
      setFocusChatOpen(false);
      setActiveNotices([]);
      setSnapshot(createInitialMediaSnapshot());
      return;
    }

    const mediaPort = mediaPortRef.current;
    if (!mediaPort) return;

    setSnapshot(mediaPort.getSnapshot());
    mediaPort.setSignalSender((signal) => transport.sendCallSignal(signal));

    const unsubscribeMedia = mediaPort.subscribe((event: MediaPortEvent) => {
      if (event.type === 'state') {
        setSnapshot(event.snapshot);
        return;
      }
      if (event.type === 'peer_muted') {
        setActiveNotices((prev) => {
          const without = prev.filter((k) => k !== 'muted');
          return event.muted ? [...without, 'muted'] : without;
        });
        return;
      }
      if (event.type === 'peer_camera_off') {
        setActiveNotices((prev) => {
          const without = prev.filter((k) => k !== 'cameraOff');
          return event.cameraOff ? [...without, 'cameraOff'] : without;
        });
        return;
      }
      if (event.type === 'peer_left_call') {
        setActiveNotices((prev) => {
          const without = prev.filter((k) => k !== 'muted' && k !== 'cameraOff' && k !== 'leftCall');
          return [...without, 'leftCall'];
        });
      }
    });

    const unsubscribeTransport = transport.subscribe((event: TransportEvent) => {
      if (event.type === 'call_signal') {
        void mediaPort.handleSignal(event.signal);
      } else if (event.type === 'participant_left') {
        void mediaPort.handleSignal({ type: 'hangup', fromId: event.participantId });
      } else if (event.type === 'room_expired') {
        setPreviewOpen(false);
        setActiveNotices([]);
        void mediaPort.endCall();
      }
    });

    return () => {
      unsubscribeMedia();
      unsubscribeTransport();
      mediaPort.setSignalSender(null);
      const currentPhase = mediaPort.getSnapshot().phase;
      if (currentPhase === 'previewing') {
        mediaPort.stopPreview();
      } else if (currentPhase === 'active') {
        void mediaPort.endCall();
      }
    };
  }, [isInRoom, isTorMode, transport]);

  useEffect(() => {
    if (isTorMode || !isInRoom) return;
    const mediaPort = mediaPortRef.current;
    if (!mediaPort?.setIceServers) return;
    mediaPort.setIceServers(iceServers ?? []);
  }, [iceServers, isInRoom, isTorMode]);

  useEffect(() => {
    return () => {
      if (ownsMediaPortRef.current && mediaPortRef.current) {
        mediaPortRef.current.dispose();
      }
    };
  }, []);

  const openPreview = useCallback(async () => {
    const mediaPort = mediaPortRef.current;
    if (isTorMode || !isInRoom || !mediaPort) return;
    mediaPort.clearError();
    const ok = await mediaPort.startPreview();
    if (ok) {
      setPreviewOpen(true);
    } else {
      setPreviewOpen(false);
    }
  }, [isInRoom, isTorMode]);

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    const mediaPort = mediaPortRef.current;
    if (isTorMode || !mediaPort) return;
    mediaPort.stopPreview();
  }, [isTorMode]);

  const confirmStartCall = useCallback(async () => {
    const mediaPort = mediaPortRef.current;
    if (isTorMode || !isInRoom || !localParticipant || !mediaPort) return;
    setPreviewOpen(false);
    const current = mediaPort.getSnapshot();
    const ok = await mediaPort.startCall({
      localParticipantId: localParticipant.id,
      cameraId: current.selectedCameraId,
      microphoneId: current.selectedMicrophoneId,
      micEnabled: current.micEnabled,
      cameraEnabled: current.cameraEnabled,
    });
    if (ok) {
      setLayout('hybrid');
      setFocusChatOpen(false);
      setActiveNotices((prev) => prev.filter((k) => k !== 'leftCall'));
    }
  }, [isInRoom, isTorMode, localParticipant]);

  const endCall = useCallback(async () => {
    setPreviewOpen(false);
    setLayout('hybrid');
    setFocusChatOpen(false);
    const mediaPort = mediaPortRef.current;
    if (isTorMode || !mediaPort) return;
    await mediaPort.endCall();
  }, [isTorMode]);

  const toggleMic = useCallback(async () => {
    const mediaPort = mediaPortRef.current;
    if (isTorMode || !mediaPort) return;
    await mediaPort.setMicEnabled(!mediaPort.getSnapshot().micEnabled);
  }, [isTorMode]);

  const toggleCamera = useCallback(async () => {
    const mediaPort = mediaPortRef.current;
    if (isTorMode || !mediaPort) return;
    await mediaPort.setCameraEnabled(!mediaPort.getSnapshot().cameraEnabled);
  }, [isTorMode]);

  const toggleScreenShare = useCallback(async () => {
    const mediaPort = mediaPortRef.current;
    if (isTorMode || !mediaPort) return;
    if (mediaPort.getSnapshot().screenSharing) {
      await mediaPort.stopScreenShare();
    } else {
      await mediaPort.startScreenShare();
    }
  }, [isTorMode]);

  const selectCamera = useCallback(
    async (deviceId: string) => {
      const mediaPort = mediaPortRef.current;
      if (isTorMode || !mediaPort) return;
      await mediaPort.selectCamera(deviceId);
    },
    [isTorMode],
  );

  const selectMicrophone = useCallback(
    async (deviceId: string) => {
      const mediaPort = mediaPortRef.current;
      if (isTorMode || !mediaPort) return;
      await mediaPort.selectMicrophone(deviceId);
    },
    [isTorMode],
  );

  const refreshDevices = useCallback(async () => {
    const mediaPort = mediaPortRef.current;
    if (isTorMode || !isInRoom || !mediaPort?.refreshDevices) return;
    await mediaPort.refreshDevices();
  }, [isInRoom, isTorMode]);

  const dismissNotice = useCallback((kind: RemoteCallNoticeKind) => {
    setActiveNotices((prev) => prev.filter((item) => item !== kind));
  }, []);

  const dismissError = useCallback(() => {
    const mediaPort = mediaPortRef.current;
    if (isTorMode || !mediaPort) return;
    mediaPort.clearError();
  }, [isTorMode]);

  const isCallActive = !isTorMode && snapshot.phase === 'active';

  return useMemo(
    () => ({
      snapshot,
      isCallActive,
      previewOpen: !isTorMode && previewOpen,
      layout,
      focusChatOpen,
      activeNotices: isTorMode ? [] : activeNotices,
      error: isTorMode ? null : snapshot.error,
      openPreview,
      closePreview,
      confirmStartCall,
      endCall,
      toggleMic,
      toggleCamera,
      toggleScreenShare,
      selectCamera,
      selectMicrophone,
      refreshDevices,
      setLayout,
      setFocusChatOpen,
      dismissNotice,
      dismissError,
    }),
    [
      activeNotices,
      closePreview,
      confirmStartCall,
      dismissError,
      dismissNotice,
      endCall,
      focusChatOpen,
      isCallActive,
      isInRoom,
      isTorMode,
      layout,
      openPreview,
      previewOpen,
      refreshDevices,
      selectCamera,
      selectMicrophone,
      snapshot,
      toggleCamera,
      toggleMic,
      toggleScreenShare,
    ],
  );
}
