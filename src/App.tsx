import { EntryScreen } from './components/EntryScreen';
import { RoomScreen } from './components/RoomScreen';
import type { Locale, Theme } from './domain/types';
import { I18nProvider, useI18n } from './i18n';
import { useRoomSession } from './session/useRoomSession';
import { ThemeProvider, useTheme } from './theme/ThemeContext';
import type { RoomTransport } from './transport/RoomTransport';

export interface AppProps {
  transport?: RoomTransport;
  initialUrl?: string;
  inactivityDurationMs?: number;
  initialLocale?: Locale;
  initialTheme?: Theme;
}

function AppContent({
  transport,
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

  const rootClasses = [
    theme === 'dark' ? 'dark' : '',
    locale === 'zh-CN' ? 'font-cjk' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const isInRoom =
    (session.status === 'waiting' || session.status === 'connected') &&
    session.roomCode &&
    session.localParticipant;

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
          participants={session.participants}
          messages={session.messages}
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
          initialUrl={initialUrl}
          inactivityDurationMs={inactivityDurationMs}
        />
      </I18nProvider>
    </ThemeProvider>
  );
}

export default App;
