import { EntryScreen } from './components/EntryScreen';
import { RoomScreen } from './components/RoomScreen';
import type { Locale, Theme } from './domain/types';
import { I18nProvider, useI18n } from './i18n';
import type { MediaPort } from './media/MediaPort';
import { useRoomSession } from './session/useRoomSession';
import { useVideoCall } from './session/useVideoCall';
import { ThemeProvider, useTheme } from './theme/ThemeContext';
import type { RoomTransport } from './transport/RoomTransport';

export interface AppProps {
  transport?: RoomTransport;
  mediaPort?: MediaPort;
  initialUrl?: string;
  inactivityDurationMs?: number;
  initialLocale?: Locale;
  initialTheme?: Theme;
}

function AppContent({
  transport,
  mediaPort,
  initialUrl,
  inactivityDurationMs,
}: Omit<AppProps, 'initialLocale' | 'initialTheme'>) {
  const { locale, t } = useI18n();
  const { theme } = useTheme();
  const session = useRoomSession({
    transport,
    initialUrl,
    inactivityDurationMs,
    initialLocale: locale,
    defaultDisplayName: t.defaultGuestName,
  });

  const isInRoom = Boolean(
    (session.status === 'waiting' || session.status === 'connected') &&
      session.roomCode &&
      session.localParticipant,
  );

  const remoteParticipant =
    session.localParticipant
      ? (session.participants.find((p) => p.id !== session.localParticipant?.id) ?? null)
      : null;

  const videoCall = useVideoCall({
    transport: session.transport,
    mediaPort,
    localParticipant: session.localParticipant,
    remoteParticipant,
    isInRoom,
  });

  const participantsWithVideo = session.participants.map((participant) => {
    if (participant.id === session.localParticipant?.id) {
      return {
        ...participant,
        videoEnabled: videoCall.isCallActive && videoCall.snapshot.cameraEnabled,
      };
    }
    return {
      ...participant,
      videoEnabled:
        videoCall.snapshot.remoteInCall && !videoCall.snapshot.remoteCameraOff,
    };
  });

  const rootClasses = [
    theme === 'dark' ? 'dark' : '',
    locale === 'zh-CN' ? 'font-cjk' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rootClasses || undefined}
      data-locale={locale}
      data-theme={theme}
    >
      {isInRoom && session.roomCode && session.localParticipant ? (
        <RoomScreen
          roomCode={session.roomCode}
          inviteUrl={session.inviteUrl ?? session.roomCode}
          isHost={session.isHost}
          localParticipant={session.localParticipant}
          participants={participantsWithVideo}
          messages={session.messages}
          videoCall={videoCall}
          sasCode={session.sasCode}
          e2eeReady={session.e2eeReady}
          hasLinkSecret={session.hasLinkSecret}
          onSendMessage={session.sendMessage}
          onLeaveRoom={session.leaveRoom}
        />
      ) : (
        <EntryScreen
          status={session.status}
          errorCode={session.errorCode}
          onCreateRoom={session.createRoom}
          onJoinRoom={session.joinRoom}
          onClearError={session.clearError}
        />
      )}
    </div>
  );
}

export function App({
  transport,
  mediaPort,
  initialUrl,
  inactivityDurationMs,
  initialLocale,
  initialTheme = 'light',
}: AppProps) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <I18nProvider initialLocale={initialLocale}>
        <AppContent
          transport={transport}
          mediaPort={mediaPort}
          initialUrl={initialUrl}
          inactivityDurationMs={inactivityDurationMs}
        />
      </I18nProvider>
    </ThemeProvider>
  );
}

export default App;
