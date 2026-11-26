import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CallLayout, Participant, TransportEvent } from '../domain/types';
import { BrowserMediaPort } from '../media/BrowserMediaPort';
import type { MediaErrorCode, MediaPort, MediaPortEvent, MediaStateSnapshot } from '../media/MediaPort';
import type { RoomTransport } from '../transport/RoomTransport';

export type RemoteCallNoticeKind = 'muted' | 'cameraOff' | 'leftCall';

export interface UseVideoCallOptions {
  transport: RoomTransport;
  mediaPort?: MediaPort;
  localParticipant: Participant | null;
  remoteParticipant: Participant | null;
  isInRoom: boolean;
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
}: UseVideoCallOptions): VideoCallController {
  const ownsMediaPortRef = useRef(false);
  const mediaPortRef = useRef<MediaPort | null>(null);

  if (!mediaPortRef.current) {
    if (providedMediaPort) {
      mediaPortRef.current = providedMediaPort;
      ownsMediaPortRef.current = false;
    } else {
      mediaPortRef.current = new BrowserMediaPort();
      ownsMediaPortRef.current = true;
    }
  }
  const mediaPort = mediaPortRef.current;

  const [snapshot, setSnapshot] = useState<MediaStateSnapshot>(() => mediaPort.getSnapshot());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [layout, setLayout] = useState<CallLayout>('hybrid');
  const [focusChatOpen, setFocusChatOpen] = useState(false);
  const [activeNotices, setActiveNotices] = useState<RemoteCallNoticeKind[]>([]);

  useEffect(() => {
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
      if (ownsMediaPortRef.current) {
        mediaPort.dispose();
      }
    };
  }, [mediaPort, transport]);

  useEffect(() => {
    if (!isInRoom) {
      setPreviewOpen(false);
      setLayout('hybrid');
      setFocusChatOpen(false);
      setActiveNotices([]);
      if (mediaPort.getSnapshot().phase === 'previewing') {
        mediaPort.stopPreview();
      } else if (mediaPort.getSnapshot().phase === 'active') {
        void mediaPort.endCall();
      }
    }
  }, [isInRoom, mediaPort]);

  const openPreview = useCallback(async () => {
    mediaPort.clearError();
    const ok = await mediaPort.startPreview();
    if (ok) {
      setPreviewOpen(true);
    } else {
      setPreviewOpen(false);
    }
  }, [mediaPort]);

  const closePreview = useCallback(() => {
    mediaPort.stopPreview();
    setPreviewOpen(false);
  }, [mediaPort]);

  const confirmStartCall = useCallback(async () => {
    if (!localParticipant) return;
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
  }, [localParticipant, mediaPort]);

  const endCall = useCallback(async () => {
    setPreviewOpen(false);
    setLayout('hybrid');
    setFocusChatOpen(false);
    await mediaPort.endCall();
  }, [mediaPort]);

  const toggleMic = useCallback(async () => {
    await mediaPort.setMicEnabled(!mediaPort.getSnapshot().micEnabled);
  }, [mediaPort]);

  const toggleCamera = useCallback(async () => {
    await mediaPort.setCameraEnabled(!mediaPort.getSnapshot().cameraEnabled);
  }, [mediaPort]);

  const toggleScreenShare = useCallback(async () => {
    if (mediaPort.getSnapshot().screenSharing) {
      await mediaPort.stopScreenShare();
    } else {
      await mediaPort.startScreenShare();
    }
  }, [mediaPort]);

  const selectCamera = useCallback(
    async (deviceId: string) => {
      await mediaPort.selectCamera(deviceId);
    },
    [mediaPort],
  );

  const selectMicrophone = useCallback(
    async (deviceId: string) => {
      await mediaPort.selectMicrophone(deviceId);
    },
    [mediaPort],
  );

  const dismissNotice = useCallback((kind: RemoteCallNoticeKind) => {
    setActiveNotices((prev) => prev.filter((item) => item !== kind));
  }, []);

  const dismissError = useCallback(() => {
    mediaPort.clearError();
  }, [mediaPort]);

  const isCallActive = snapshot.phase === 'active';

  return useMemo(
    () => ({
      snapshot,
      isCallActive,
      previewOpen,
      layout,
      focusChatOpen,
      activeNotices,
      error: snapshot.error,
      openPreview,
      closePreview,
      confirmStartCall,
      endCall,
      toggleMic,
      toggleCamera,
      toggleScreenShare,
      selectCamera,
      selectMicrophone,
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
      layout,
      openPreview,
      previewOpen,
      selectCamera,
      selectMicrophone,
      snapshot,
      toggleCamera,
      toggleMic,
      toggleScreenShare,
    ],
  );
}
