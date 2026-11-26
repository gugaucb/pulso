import { useEffect, useRef, useState } from 'react';
import type { EphemeralMessage, Participant } from '../domain/types';
import { copyToClipboard } from '../utils/clipboard';
import { MessageComposer } from './MessageComposer';
import { MessageList } from './MessageList';
import { RoomHeader } from './RoomHeader';
import { RoomSidebar } from './RoomSidebar';

interface RoomScreenProps {
  roomCode: string;
  inviteUrl: string;
  isHost: boolean;
  localParticipant: Participant;
  participants: Participant[];
  messages: EphemeralMessage[];
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
  onSendMessage,
  onLeaveRoom,
}: RoomScreenProps) {
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

  return (
    <div className="h-screen w-full flex overflow-hidden bg-[#F8F9FC]">
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

      <div className="flex-1 flex flex-col min-w-0">
        <RoomHeader
          roomCode={roomCode}
          participants={participants}
          copiedCode={copiedCode}
          copiedLink={copiedLink}
          onCopyCode={handleCopyCode}
          onCopyLink={handleCopyLink}
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
    </div>
  );
}
