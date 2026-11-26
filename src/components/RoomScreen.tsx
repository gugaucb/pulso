import { useEffect, useRef, useState } from 'react';
import type { EphemeralMessage, Participant } from '../domain/types';
import { copyToClipboard } from '../utils/clipboard';
import { MessageComposer } from './MessageComposer';
import { MessageList } from './MessageList';
import { RoomHeader } from './RoomHeader';
import { RoomSidebar } from './RoomSidebar';
import { SasVerificationModal } from './modals/SasVerificationModal';

interface RoomScreenProps {
  roomCode: string;
  inviteUrl: string;
  isHost: boolean;
  localParticipant: Participant;
  participants: Participant[];
  messages: EphemeralMessage[];
  sasCode: string | null;
  e2eeReady: boolean;
  hasLinkSecret: boolean;
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
  sasCode,
  e2eeReady,
  hasLinkSecret,
  onSendMessage,
  onLeaveRoom,
}: RoomScreenProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
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
        onLeaveRoom={() => void onLeaveRoom()}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <RoomHeader
          roomCode={roomCode}
          participants={participants}
          copiedCode={copiedCode}
          copiedLink={copiedLink}
          e2eeReady={e2eeReady}
          onCopyCode={handleCopyCode}
          onCopyLink={handleCopyLink}
          onOpenSas={() => setSasModalOpen(true)}
          onLeaveRoom={() => void onLeaveRoom()}
        />

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
      </div>

      <SasVerificationModal
        open={sasModalOpen}
        sasCode={sasCode}
        hasLinkSecret={hasLinkSecret}
        onClose={() => setSasModalOpen(false)}
      />
    </div>
  );
}
