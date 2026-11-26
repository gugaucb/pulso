import { useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, Info, MessageSquare, VideoOff, X } from 'lucide-react';
import type { ConnectionStatus, EphemeralMessage, Participant, RoomMode } from '../domain/types';
import { useCopyFeedback } from '../hooks/useCopyFeedback';
import { useModalA11y } from '../hooks/useModalA11y';
import { useI18n } from '../i18n';
import type { MediaErrorCode } from '../media/MediaPort';
import {
  DEFAULT_INACTIVITY_DURATION_MS,
  type InactivityAlertLevel,
} from '../session/inactivityTimer';
import type { RemoteCallNoticeKind, VideoCallController } from '../session/useVideoCall';
import { MessageComposer } from './MessageComposer';
import { MessageList } from './MessageList';
import { VideoPreviewModal } from './modals/VideoPreviewModal';
import { RoomHeader } from './RoomHeader';
import { RoomSidebar, RoomSidebarContent } from './RoomSidebar';
import { LeaveRoomDialog } from './modals/LeaveRoomDialog';
import { SasVerificationModal } from './modals/SasVerificationModal';
import { SettingsModal } from './modals/SettingsModal';
import { ScreenShield } from './privacy/ScreenShield';
import { SessionWatermark } from './privacy/SessionWatermark';
import { VideoCallStage } from './video/VideoCallStage';

interface RoomScreenProps {
  roomCode: string;
  roomMode?: RoomMode;
  onionAddress?: string | null;
  inviteUrl: string;
  connectionStatus?: ConnectionStatus;
  isHost: boolean;
  localParticipant: Participant;
  participants: Participant[];
  messages: EphemeralMessage[];
  videoCall?: VideoCallController;
  typingParticipantName?: string | null;
  sasCode: string | null;
  e2eeReady: boolean;
  hasLinkSecret: boolean;
  inactivityRemainingMs?: number;
  inactivityAlertLevel?: InactivityAlertLevel;
  onRenewActivity?: () => Promise<void>;
  onSendMessage: (text: string) => Promise<void>;
  onTypingChange?: (isTyping: boolean) => void;
  onOpenSettings?: () => void;
  onLeaveRoom: () => Promise<void>;
}

export function RoomScreen({
  roomCode,
  roomMode = 'normal',
  onionAddress,
  inviteUrl,
  connectionStatus,
  isHost,
  localParticipant,
  participants,
  messages,
  videoCall,
  typingParticipantName,
  sasCode,
  e2eeReady,
  hasLinkSecret,
  inactivityRemainingMs = DEFAULT_INACTIVITY_DURATION_MS,
  inactivityAlertLevel = 'normal',
  onRenewActivity,
  onSendMessage,
  onTypingChange,
  onOpenSettings,
  onLeaveRoom,
}: RoomScreenProps) {
  const { t } = useI18n();
  const isTorMode = roomMode === 'tor';
  const codeCopy = useCopyFeedback();
  const linkCopy = useCopyFeedback();
  const onionCopy = useCopyFeedback();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileVideoChatOpen, setMobileVideoChatOpen] = useState(false);
  const [antiPrintscreenEnabled, setAntiPrintscreenEnabled] = useState(true);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [sasModalOpen, setSasModalOpen] = useState(false);
  const mobileSidebarButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileSidebarCloseRef = useRef<HTMLButtonElement | null>(null);
  const restoreDrawerFocusRef = useRef(true);

  if (mobileSidebarOpen) {
    restoreDrawerFocusRef.current = true;
  }

  useModalA11y(
    mobileSidebarOpen,
    mobileSidebarCloseRef,
    () => setMobileSidebarOpen(false),
    {
      preventEscapeDefault: true,
      shouldRestoreFocus: () => restoreDrawerFocusRef.current,
    },
  );

  const handleCopyCode = () => codeCopy.triggerCopy(roomCode);
  const handleCopyLink = () => linkCopy.triggerCopy(inviteUrl);
  const handleCopyOnion = () => {
    if (!onionAddress) return;
    onionCopy.triggerCopy(onionAddress);
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

  const isCallActive = !isTorMode && (videoCall?.isCallActive ?? false);
  const activeLayout = videoCall?.layout ?? 'hybrid';
  const isFocusLayout = isCallActive && activeLayout === 'focus';
  const isHybridLayout = isCallActive && activeLayout === 'hybrid';
  const isPipLayout = isCallActive && activeLayout === 'pip';

  const handleOpenSettings = () => {
    if (onOpenSettings) {
      onOpenSettings();
      return;
    }
    if (!isTorMode && videoCall) {
      void videoCall.refreshDevices();
    }
    setSettingsOpen(true);
  };

  const messageSection = (
    <>
      <ScreenShield
        enabled={antiPrintscreenEnabled}
        overlay={<SessionWatermark enabled={watermarkEnabled} roomCode={roomCode} />}
      >
        <MessageList
          roomCode={roomCode}
          roomMode={roomMode}
          onionAddress={onionAddress}
          isHost={isHost}
          localParticipantId={localParticipant.id}
          messages={messages}
          typingParticipantName={typingParticipantName}
          copiedCode={codeCopy.copied}
          copiedLink={linkCopy.copied}
          copiedOnion={onionCopy.copied}
          onCopyCode={handleCopyCode}
          onShareLink={handleCopyLink}
          onCopyOnion={handleCopyOnion}
        />
      </ScreenShield>
      <MessageComposer
        onSendMessage={onSendMessage}
        onTypingChange={onTypingChange}
      />
    </>
  );
  return (
    <div className="h-screen w-full flex overflow-hidden bg-[#F8F9FC] dark:bg-[#1A1C2A] transition-colors">
      <div className="pulso-print-notice" aria-hidden="true">
        {t.privacy.printBlockedNotice}
      </div>
      <RoomSidebar
        roomCode={roomCode}
        roomMode={roomMode}
        onionAddress={onionAddress}
        localParticipant={localParticipant}
        participants={participants}
        copiedCode={codeCopy.copied}
        copiedLink={linkCopy.copied}
        e2eeReady={e2eeReady}
        inactivityRemainingMs={inactivityRemainingMs}
        inactivityAlertLevel={inactivityAlertLevel}
        onRenewActivity={onRenewActivity ? () => void onRenewActivity() : undefined}
        onCopyCode={handleCopyCode}
        onCopyLink={handleCopyLink}
        onOpenSas={() => setSasModalOpen(true)}
        onOpenSettings={handleOpenSettings}
        onLeaveRoom={() => setLeaveConfirmOpen(true)}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <RoomHeader
          roomCode={roomCode}
          roomMode={roomMode}
          connectionStatus={connectionStatus}
          participants={participants}
          copiedCode={codeCopy.copied}
          copiedLink={linkCopy.copied}
          isCallActive={isCallActive}
          onStartVideoCall={!isTorMode && videoCall ? () => void videoCall.openPreview() : undefined}
          e2eeReady={e2eeReady}
          inactivityRemainingMs={inactivityRemainingMs}
          inactivityAlertLevel={inactivityAlertLevel}
          onCopyCode={handleCopyCode}
          onCopyLink={handleCopyLink}
          onOpenSas={() => setSasModalOpen(true)}
          onOpenSettings={handleOpenSettings}
          onLeaveRoom={() => setLeaveConfirmOpen(true)}
          mobileSidebarOpen={mobileSidebarOpen}
          onToggleMobileSidebar={() => setMobileSidebarOpen((prev) => !prev)}
          mobileSidebarButtonRef={mobileSidebarButtonRef}
        />

        {inactivityAlertLevel !== 'normal' && (
          <div
            role={inactivityAlertLevel === 'critical' ? 'alert' : 'status'}
            aria-live={inactivityAlertLevel === 'critical' ? 'assertive' : 'polite'}
            data-inactivity-banner={inactivityAlertLevel}
            className={`pulso-print-hide mx-4 sm:mx-5 mt-2.5 flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs font-medium transition-colors ${
              inactivityAlertLevel === 'critical'
                ? 'border-[#EF4444] bg-red-50 dark:bg-red-500/15 text-red-800 dark:text-red-200'
                : 'border-[#F59E0B] bg-amber-50 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle
                className={`h-4 w-4 shrink-0 ${
                  inactivityAlertLevel === 'critical' ? 'text-[#EF4444]' : 'text-[#F59E0B]'
                }`}
                aria-hidden="true"
              />
              <span>
                {inactivityAlertLevel === 'critical'
                  ? t.inactivity.criticalBanner
                  : t.inactivity.warningBanner}
              </span>
            </div>
            {onRenewActivity && (
              <button
                type="button"
                onClick={() => void onRenewActivity()}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition cursor-pointer ${
                  inactivityAlertLevel === 'critical'
                    ? 'bg-[#EF4444] hover:bg-red-600'
                    : 'bg-[#F59E0B] hover:bg-amber-600'
                }`}
              >
                {t.inactivity.renewActivity}
              </button>
            )}
          </div>
        )}

        {isTorMode && (
          <div className="mx-4 sm:mx-5 mt-3 rounded-xl border border-purple-200 dark:border-purple-500/30 bg-purple-50/80 dark:bg-purple-500/10 px-4 py-2.5 text-xs text-purple-950 dark:text-purple-100 space-y-1">
            <p id="tor-video-blocked-notice" className="flex items-center gap-2 font-medium">
              <VideoOff className="h-3.5 w-3.5 shrink-0 text-purple-700 dark:text-purple-300" aria-hidden="true" />
              <span>{t.videoCall.torBlockedNotice}</span>
            </p>
            <p className="flex items-start gap-2 text-[11px] text-purple-800/90 dark:text-purple-200/90 leading-relaxed">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-purple-600 dark:text-purple-300" aria-hidden="true" />
              <span>{t.torMode.securityLevelNotice}</span>
            </p>
          </div>
        )}

        {!isTorMode && videoCall?.error && (
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

        {!isTorMode && videoCall && videoCall.activeNotices.length > 0 && (
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
                className="fixed inset-0 z-30 md:static md:w-80 lg:w-96 shrink-0 flex flex-col border-l border-slate-200 dark:border-[#2E3248] bg-white dark:bg-[#1A1C2A] min-h-0"
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
                mobileMessagesOpen={mobileVideoChatOpen}
                onToggleMobileMessages={() => setMobileVideoChatOpen((prev) => !prev)}
              />
            )}

            <div
              className={
                isHybridLayout && !mobileVideoChatOpen
                  ? 'hidden md:flex md:flex-1 md:flex-col md:min-h-0'
                  : 'flex-1 flex flex-col min-h-0'
              }
            >
              {messageSection}
            </div>

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

      {mobileSidebarOpen && (
        <div
          className="pulso-print-hide fixed inset-0 z-40 flex md:hidden bg-slate-950/60 backdrop-blur-xs"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setMobileSidebarOpen(false);
            }
          }}
        >
          <div
            id="mobile-room-sidebar"
            role="dialog"
            aria-modal="true"
            aria-label={t.room.sidebarAriaLabel}
            className="w-72 max-w-[85vw] h-full flex flex-col justify-between bg-[#141522] text-slate-200 border-r border-slate-800/80 p-5 overflow-y-auto select-none shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <RoomSidebarContent
              roomCode={roomCode}
              roomMode={roomMode}
              onionAddress={onionAddress}
              localParticipant={localParticipant}
              participants={participants}
              copiedCode={codeCopy.copied}
              copiedLink={linkCopy.copied}
              e2eeReady={e2eeReady}
              inactivityRemainingMs={inactivityRemainingMs}
              inactivityAlertLevel={inactivityAlertLevel}
              onRenewActivity={onRenewActivity ? () => void onRenewActivity() : undefined}
              onCopyCode={handleCopyCode}
              onCopyLink={() => {
                handleCopyLink();
                setMobileSidebarOpen(false);
              }}
              onOpenSas={() => {
                restoreDrawerFocusRef.current = false;
                setMobileSidebarOpen(false);
                setSasModalOpen(true);
              }}
              onOpenSettings={() => {
                restoreDrawerFocusRef.current = false;
                setMobileSidebarOpen(false);
                handleOpenSettings();
              }}
              onLeaveRoom={() => {
                restoreDrawerFocusRef.current = false;
                setMobileSidebarOpen(false);
                setLeaveConfirmOpen(true);
              }}
              onCloseDrawer={() => setMobileSidebarOpen(false)}
              closeButtonRef={mobileSidebarCloseRef}
            />
          </div>
        </div>
      )}

      {!isTorMode && videoCall && (
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

      <LeaveRoomDialog
        open={leaveConfirmOpen}
        onCancel={() => setLeaveConfirmOpen(false)}
        onConfirm={() => {
          setLeaveConfirmOpen(false);
          void onLeaveRoom();
        }}
      />

      <SasVerificationModal
        open={sasModalOpen}
        sasCode={sasCode}
        hasLinkSecret={hasLinkSecret}
        onClose={() => setSasModalOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        antiPrintscreenEnabled={antiPrintscreenEnabled}
        watermarkEnabled={watermarkEnabled}
        isTorMode={isTorMode}
        cameras={videoCall?.snapshot.cameras}
        microphones={videoCall?.snapshot.microphones}
        selectedCameraId={videoCall?.snapshot.selectedCameraId}
        selectedMicrophoneId={videoCall?.snapshot.selectedMicrophoneId}
        onSelectCamera={
          !isTorMode && videoCall ? (id) => void videoCall.selectCamera(id) : undefined
        }
        onSelectMicrophone={
          !isTorMode && videoCall ? (id) => void videoCall.selectMicrophone(id) : undefined
        }
        onToggleAntiPrintscreen={() => {
          setAntiPrintscreenEnabled((prev) => {
            const next = !prev;
            setLiveAnnouncement(
              next ? t.privacy.shieldEnabledAnnouncement : t.privacy.shieldDisabledAnnouncement,
            );
            return next;
          });
        }}
        onToggleWatermark={() => {
          setWatermarkEnabled((prev) => {
            const next = !prev;
            setLiveAnnouncement(
              next
                ? t.privacy.watermarkEnabledAnnouncement
                : t.privacy.watermarkDisabledAnnouncement,
            );
            return next;
          });
        }}
        onClose={() => setSettingsOpen(false)}
      />

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>
    </div>
  );
}
