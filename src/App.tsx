import { useEffect } from 'react';
import { EntryScreen } from './components/EntryScreen';
import { ExpiredRoomScreen } from './components/modals/ExpiredRoomScreen';
import { RoomScreen } from './components/RoomScreen';
import type { Locale, RuntimeInfo, Theme } from './domain/types';
import { I18nProvider, useI18n } from './i18n';
import type { MediaPort } from './media/MediaPort';
import { useRuntimeInfo } from './runtime/useRuntimeInfo';
import { getVideoCallHeartbeatMs } from './session/inactivityTimer';
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
  runtimeInfo?: RuntimeInfo;
}

function AppContent({
  transport,
  mediaPort,
  initialUrl,
  inactivityDurationMs,
  runtimeInfo: runtimeInfoProp,
}: Omit<AppProps, 'initialLocale' | 'initialTheme'>) {
  const { locale, t } = useI18n();
  const { theme } = useTheme();
  const runtimeInfo = useRuntimeInfo(runtimeInfoProp);
  const session = useRoomSession({
    transport,
    initialUrl,
    inactivityDurationMs,
    initialLocale: locale,
    defaultDisplayName: t.defaultGuestName,
    runtimeInfo,
  });

  const isInRoom = Boolean(
    (session.status === 'waiting' ||
      session.status === 'connected' ||
      session.status === 'reconnecting') &&
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
    roomMode: session.roomMode,
    iceServers: session.roomMode === 'tor' ? undefined : session.iceServers,
  });

  const isTorMode = session.roomMode === 'tor';

  useEffect(() => {
    if (!isInRoom || isTorMode || !videoCall.isCallActive) return;
    void session.renewActivity();
    const heartbeatMs = getVideoCallHeartbeatMs(session.inactivityDurationMs);
    const intervalId = setInterval(() => {
      void session.renewActivity();
    }, heartbeatMs);
    return () => {
      clearInterval(intervalId);
    };
  }, [isInRoom, isTorMode, session.inactivityDurationMs, session.renewActivity, videoCall.isCallActive]);

  const participantsWithVideo = session.participants.map((participant) => {
    if (isTorMode) {
      return {
        ...participant,
        videoEnabled: false,
      };
    }
    if (participant.id === session.localParticipant?.id) {
      return {
        ...participant,
        videoEnabled:
          Boolean(participant.videoEnabled) ||
          (videoCall.isCallActive && videoCall.snapshot.cameraEnabled),
      };
    }
    return {
      ...participant,
      videoEnabled:
        Boolean(participant.videoEnabled) ||
        (videoCall.snapshot.remoteInCall && !videoCall.snapshot.remoteCameraOff),
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
          roomMode={session.roomMode}
          onionAddress={session.onionAddress}
          inviteUrl={session.inviteUrl ?? session.roomCode}
          connectionStatus={session.status}
          isHost={session.isHost}
          localParticipant={session.localParticipant}
          participants={participantsWithVideo}
          messages={session.messages}
          videoCall={videoCall}
          typingParticipantName={session.typingParticipantName}
          sasCode={session.sasCode}
          e2eeReady={session.e2eeReady}
          hasLinkSecret={session.hasLinkSecret}
          inactivityRemainingMs={session.inactivityRemainingMs}
          inactivityAlertLevel={session.inactivityAlertLevel}
          onRenewActivity={session.renewActivity}
          onSendMessage={session.sendMessage}
          onTypingChange={session.setTyping}
          onLeaveRoom={session.leaveRoom}
        />
      ) : session.status === 'expired' ? (
        <ExpiredRoomScreen
          reason={session.expiryReason}
          onReturnToEntry={session.returnToEntry}
        />
      ) : (
        <EntryScreen
          status={session.status}
          errorCode={session.errorCode}
          runtimeInfo={runtimeInfo}
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
  runtimeInfo,
}: AppProps) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <I18nProvider initialLocale={initialLocale}>
        <AppContent
          transport={transport}
          mediaPort={mediaPort}
          initialUrl={initialUrl}
          inactivityDurationMs={inactivityDurationMs}
          runtimeInfo={runtimeInfo}
        />
      </I18nProvider>
    </ThemeProvider>
  );
}

export default App;
