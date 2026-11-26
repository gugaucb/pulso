import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, MessageSquare, X } from 'lucide-react';
import type { EphemeralMessage, Participant } from '../domain/types';
import { useI18n } from '../i18n';
import type { MediaErrorCode } from '../media/MediaPort';
import type { RemoteCallNoticeKind, VideoCallController } from '../session/useVideoCall';
import { copyToClipboard } from '../utils/clipboard';
import { MessageComposer } from './MessageComposer';
import { MessageList } from './MessageList';
import { VideoPreviewModal } from './modals/VideoPreviewModal';
import { RoomHeader } from './RoomHeader';
import { RoomSidebar } from './RoomSidebar';
import { VideoCallStage } from './video/VideoCallStage';

interface RoomScreenProps {
  roomCode: string;
  inviteUrl: string;
  isHost: boolean;
  localParticipant: Participant;
  participants: Participant[];
  messages: EphemeralMessage[];
  videoCall?: VideoCallController;
  onSendMessage: (text: string) => Promise<void>;
  onLeaveRoom: () => Promise<void>;
}

export function RoomScreen({
  roomCode,
  inviteUrl,
  isHost,
  localParticipant,
  participants,
  messages,
  videoCall,
  onSendMessage,
  onLeaveRoom,
}: RoomScreenProps) {
  const { t } = useI18n();
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const codeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
      if (linkTimerRef.current) clearTimeout(linkTimerRef.current);
    };
  }, []);

  const handleCopyCode = () => {
    void copyToClipboard(roomCode);
    setCopiedCode(true);
    if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
    codeTimerRef.current = setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    void copyToClipboard(inviteUrl);
    setCopiedLink(true);
    if (linkTimerRef.current) clearTimeout(linkTimerRef.current);
    linkTimerRef.current = setTimeout(() => setCopiedLink(false), 2000);
  };

  const remoteParticipant = participants.find((p) => p.id !== localParticipant.id);
  const remoteName = remoteParticipant?.displayName ?? t.defaultGuestName;

  const mediaErrorMessages: Record<MediaErrorCode, string> = {
    permission_denied: t.errors.mediaPermissionDenied,
    media_unavailable: t.errors.mediaUnavailable,
    connection_failed: t.errors.mediaConnectionFailed,
    screen_share_denied: t.errors.screenShareDenied,
  };

  const noticeTextMap: Record<RemoteCallNoticeKind, string> = {
    muted: t.videoCall.peerMuted(remoteName),
    cameraOff: t.videoCall.peerCameraOff(remoteName),
    leftCall: t.videoCall.peerLeftCall(remoteName),
  };

  const isCallActive = videoCall?.isCallActive ?? false;
  const activeLayout = videoCall?.layout ?? 'hybrid';
  const isFocusLayout = isCallActive && activeLayout === 'focus';
  const isHybridLayout = isCallActive && activeLayout === 'hybrid';
  const isPipLayout = isCallActive && activeLayout === 'pip';

  const messageSection = (
    <>
      <MessageList
        roomCode={roomCode}
        isHost={isHost}
        localParticipantId={localParticipant.id}
        messages={messages}
        copiedCode={copiedCode}
        copiedLink={copiedLink}
        onCopyCode={handleCopyCode}
        onShareLink={handleCopyLink}
      />
      <MessageComposer onSendMessage={onSendMessage} />
    </>
  );

  return (
    <div className="h-screen w-full flex overflow-hidden bg-[#F8F9FC] dark:bg-[#1A1C2A] transition-colors">
      <RoomSidebar
        roomCode={roomCode}
        localParticipant={localParticipant}
        participants={participants}
        copiedCode={copiedCode}
        copiedLink={copiedLink}
        onCopyCode={handleCopyCode}
        onCopyLink={handleCopyLink}
        onLeaveRoom={() => void onLeaveRoom()}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <RoomHeader
          roomCode={roomCode}
          participants={participants}
          copiedCode={copiedCode}
          copiedLink={copiedLink}
          isCallActive={isCallActive}
          onStartVideoCall={videoCall ? () => void videoCall.openPreview() : undefined}
          onCopyCode={handleCopyCode}
          onCopyLink={handleCopyLink}
          onLeaveRoom={() => void onLeaveRoom()}
        />

        {videoCall?.error && (
          <div
            role="alert"
            className="mx-4 sm:mx-5 mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15 px-4 py-2.5 text-xs font-medium text-amber-900 dark:text-amber-200"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span>{mediaErrorMessages[videoCall.error]}</span>
            </div>
            <button
              type="button"
              onClick={videoCall.dismissError}
              aria-label={t.videoCall.dismissNotice}
              className="shrink-0 rounded-lg p-1 hover:bg-amber-200/60 dark:hover:bg-amber-500/20 transition cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {videoCall && videoCall.activeNotices.length > 0 && (
          <div className="mx-4 sm:mx-5 mt-2 space-y-1.5">
            {videoCall.activeNotices.map((kind) => (
              <div
                key={kind}
                role="status"
                aria-live="polite"
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#232638] px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-xs"
              >
                <span>{noticeTextMap[kind]}</span>
                <button
                  type="button"
                  onClick={() => videoCall.dismissNotice(kind)}
                  aria-label={t.videoCall.dismissNotice}
                  className="shrink-0 rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 transition cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        {isFocusLayout && videoCall ? (
          <div className="flex-1 flex min-h-0 min-w-0">
            <VideoCallStage
              layout="focus"
              localName={localParticipant.displayName}
              remoteName={remoteName}
              localStream={videoCall.snapshot.localStream}
              remoteStream={videoCall.snapshot.remoteStream}
              micEnabled={videoCall.snapshot.micEnabled}
              cameraEnabled={videoCall.snapshot.cameraEnabled}
              screenSharing={videoCall.snapshot.screenSharing}
              remoteInCall={videoCall.snapshot.remoteInCall}
              remoteMicMuted={videoCall.snapshot.remoteMicMuted}
              remoteCameraOff={videoCall.snapshot.remoteCameraOff}
              onToggleMic={() => void videoCall.toggleMic()}
              onToggleCamera={() => void videoCall.toggleCamera()}
              onToggleScreenShare={() => void videoCall.toggleScreenShare()}
              onEndCall={() => void videoCall.endCall()}
              onChangeLayout={videoCall.setLayout}
            />

            {videoCall.focusChatOpen ? (
              <aside
                aria-label={t.messages.listAriaLabel}
                className="w-80 lg:w-96 shrink-0 flex flex-col border-l border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#1A1C2A] min-h-0"
              >
                <div className="shrink-0 flex items-center justify-between px-3.5 py-2.5 border-b border-slate-200 dark:border-[#2E3248]">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t.messages.listAriaLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => videoCall.setFocusChatOpen(false)}
                    aria-label={t.videoCall.hideMessages}
                    aria-expanded="true"
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#232638] transition cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{t.videoCall.hideMessages}</span>
                  </button>
                </div>
                {messageSection}
              </aside>
            ) : (
              <div className="shrink-0 flex items-start border-l border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#1A1C2A] p-2">
                <button
                  type="button"
                  onClick={() => videoCall.setFocusChatOpen(true)}
                  aria-label={t.videoCall.showMessages}
                  aria-expanded="false"
                  className="inline-flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 dark:border-[#2E3248] bg-slate-50 dark:bg-[#232638] hover:bg-slate-100 dark:hover:bg-[#2B2F45] px-2.5 py-3 text-xs font-medium text-slate-700 dark:text-slate-200 transition cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4 text-[#5B3DF5] dark:text-[#818CF8]" aria-hidden="true" />
                  <MessageSquare className="h-4 w-4 text-[#5B3DF5] dark:text-[#818CF8]" aria-hidden="true" />
                  <span className="sr-only">{t.videoCall.showMessages}</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {isHybridLayout && videoCall && (
              <VideoCallStage
                layout="hybrid"
                localName={localParticipant.displayName}
                remoteName={remoteName}
                localStream={videoCall.snapshot.localStream}
                remoteStream={videoCall.snapshot.remoteStream}
                micEnabled={videoCall.snapshot.micEnabled}
                cameraEnabled={videoCall.snapshot.cameraEnabled}
                screenSharing={videoCall.snapshot.screenSharing}
                remoteInCall={videoCall.snapshot.remoteInCall}
                remoteMicMuted={videoCall.snapshot.remoteMicMuted}
                remoteCameraOff={videoCall.snapshot.remoteCameraOff}
                onToggleMic={() => void videoCall.toggleMic()}
                onToggleCamera={() => void videoCall.toggleCamera()}
                onToggleScreenShare={() => void videoCall.toggleScreenShare()}
                onEndCall={() => void videoCall.endCall()}
                onChangeLayout={videoCall.setLayout}
              />
            )}

            {messageSection}

            {isPipLayout && videoCall && (
              <VideoCallStage
                layout="pip"
                localName={localParticipant.displayName}
                remoteName={remoteName}
                localStream={videoCall.snapshot.localStream}
                remoteStream={videoCall.snapshot.remoteStream}
                micEnabled={videoCall.snapshot.micEnabled}
                cameraEnabled={videoCall.snapshot.cameraEnabled}
                screenSharing={videoCall.snapshot.screenSharing}
                remoteInCall={videoCall.snapshot.remoteInCall}
                remoteMicMuted={videoCall.snapshot.remoteMicMuted}
                remoteCameraOff={videoCall.snapshot.remoteCameraOff}
                onToggleMic={() => void videoCall.toggleMic()}
                onToggleCamera={() => void videoCall.toggleCamera()}
                onToggleScreenShare={() => void videoCall.toggleScreenShare()}
                onEndCall={() => void videoCall.endCall()}
                onChangeLayout={videoCall.setLayout}
              />
            )}
          </>
        )}
      </div>

      {videoCall && (
        <VideoPreviewModal
          open={videoCall.previewOpen}
          localName={localParticipant.displayName}
          localStream={videoCall.snapshot.localStream}
          cameras={videoCall.snapshot.cameras}
          microphones={videoCall.snapshot.microphones}
          selectedCameraId={videoCall.snapshot.selectedCameraId}
          selectedMicrophoneId={videoCall.snapshot.selectedMicrophoneId}
          micEnabled={videoCall.snapshot.micEnabled}
          cameraEnabled={videoCall.snapshot.cameraEnabled}
          audioLevel={videoCall.snapshot.audioLevel}
          onSelectCamera={(id) => void videoCall.selectCamera(id)}
          onSelectMicrophone={(id) => void videoCall.selectMicrophone(id)}
          onToggleMic={() => void videoCall.toggleMic()}
          onToggleCamera={() => void videoCall.toggleCamera()}
          onConfirm={() => void videoCall.confirmStartCall()}
          onCancel={videoCall.closePreview}
        />
      )}
    </div>
  );
}
