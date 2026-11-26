import { EntryScreen } from './components/EntryScreen';
import { RoomScreen } from './components/RoomScreen';
import type { Locale } from './domain/types';
import { useRoomSession } from './session/useRoomSession';
import type { RoomTransport } from './transport/RoomTransport';

export interface AppProps {
  transport?: RoomTransport;
  initialUrl?: string;
  inactivityDurationMs?: number;
  initialLocale?: Locale;
}

export function App({
  transport,
  initialUrl,
  inactivityDurationMs,
  initialLocale,
}: AppProps) {
  const session = useRoomSession({
    transport,
    initialUrl,
    inactivityDurationMs,
    initialLocale,
  });

  if (
    (session.status === 'waiting' || session.status === 'connected') &&
    session.roomCode &&
    session.localParticipant
  ) {
    return (
      <RoomScreen
        roomCode={session.roomCode}
        inviteUrl={session.inviteUrl ?? session.roomCode}
        isHost={session.isHost}
        localParticipant={session.localParticipant}
        participants={session.participants}
        messages={session.messages}
        onSendMessage={session.sendMessage}
        onLeaveRoom={session.leaveRoom}
      />
    );
  }

  return (
    <EntryScreen
      status={session.status}
      errorCode={session.errorCode}
      onCreateRoom={session.createRoom}
      onJoinRoom={session.joinRoom}
      onClearError={session.clearError}
    />
  );
}

export default App;
