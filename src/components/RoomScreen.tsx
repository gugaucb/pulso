import { useEffect, useRef, useState } from 'react';
import type { ConnectionStatus, EphemeralMessage, Participant } from '../domain/types';
import { useI18n } from '../i18n';
import { copyToClipboard } from '../utils/clipboard';
import { MessageComposer } from './MessageComposer';
import { MessageList } from './MessageList';
import { RoomHeader } from './RoomHeader';
import { RoomSidebar } from './RoomSidebar';
import { LeaveRoomDialog } from './modals/LeaveRoomDialog';
import { SasVerificationModal } from './modals/SasVerificationModal';

interface RoomScreenProps {
  roomCode: string;
  inviteUrl: string;
  connectionStatus?: ConnectionStatus;
  isHost: boolean;
  localParticipant: Participant;
  participants: Participant[];
  messages: EphemeralMessage[];
  typingParticipantName?: string | null;
  sasCode: string | null;
  e2eeReady: boolean;
  hasLinkSecret: boolean;
  onSendMessage: (text: string) => Promise<void>;
  onTypingChange?: (isTyping: boolean) => void;
  onOpenSettings?: () => void;
  onLeaveRoom: () => Promise<void>;
}

export function RoomScreen({
  roomCode,
  inviteUrl,
  connectionStatus,
  isHost,
  localParticipant,
  participants,
  messages,
  typingParticipantName,
  sasCode,
  e2eeReady,
  hasLinkSecret,
  onSendMessage,
  onTypingChange,
  onOpenSettings,
  onLeaveRoom,
}: RoomScreenProps) {
  const { t } = useI18n();
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [sasModalOpen, setSasModalOpen] = useState(false);
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

  const handleOpenSettings = () => {
    if (onOpenSettings) {
      onOpenSettings();
      return;
    }
    setSettingsOpen(true);
  };

  return (
    <div className="h-screen w-full flex overflow-hidden bg-[#F8F9FC] dark:bg-[#1A1C2A] transition-colors">
      <RoomSidebar
        roomCode={roomCode}
        localParticipant={localParticipant}
        participants={participants}
        copiedCode={copiedCode}
        copiedLink={copiedLink}
        e2eeReady={e2eeReady}
        onCopyCode={handleCopyCode}
        onCopyLink={handleCopyLink}
        onOpenSas={() => setSasModalOpen(true)}
        onOpenSettings={handleOpenSettings}
        onLeaveRoom={() => setLeaveConfirmOpen(true)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <RoomHeader
          roomCode={roomCode}
          connectionStatus={connectionStatus}
          participants={participants}
          copiedCode={copiedCode}
          copiedLink={copiedLink}
          e2eeReady={e2eeReady}
          onCopyCode={handleCopyCode}
          onCopyLink={handleCopyLink}
          onOpenSas={() => setSasModalOpen(true)}
          onOpenSettings={handleOpenSettings}
          onLeaveRoom={() => setLeaveConfirmOpen(true)}
        />

        <MessageList
          roomCode={roomCode}
          isHost={isHost}
          localParticipantId={localParticipant.id}
          messages={messages}
          typingParticipantName={typingParticipantName}
          copiedCode={copiedCode}
          copiedLink={copiedLink}
          onCopyCode={handleCopyCode}
          onShareLink={handleCopyLink}
        />

        <MessageComposer
          onSendMessage={onSendMessage}
          onTypingChange={onTypingChange}
        />
      </div>

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

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-fallback-title"
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#232638] border border-slate-200 dark:border-[#2E3248] shadow-xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="settings-fallback-title"
              className="text-base font-bold text-[#111827] dark:text-slate-100"
            >
              {t.privacy.settingsTitle}
            </h2>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {t.privacy.honestDisclaimer}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-xl bg-[#5B3DF5] hover:bg-[#4E32D9] px-4 py-2 text-xs font-semibold text-white transition cursor-pointer"
              >
                {t.e2ee.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
