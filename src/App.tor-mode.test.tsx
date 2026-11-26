import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { TransportEvent } from './domain/types';
import { FakeMediaPort } from './media/FakeMediaPort';
import { InMemoryTransportHub } from './transport/InMemoryTransport';
import type { RoomTransport } from './transport/RoomTransport';

const ROOM_CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const V3_ONION_REGEX = /[a-z2-7]{56}\.onion/;
const REAL_ONION = `http://${'p'.repeat(56)}.onion`;

function spyOnAllMediaPortMethods(mediaPort: FakeMediaPort) {
  return [
    vi.spyOn(mediaPort, 'startPreview'),
    vi.spyOn(mediaPort, 'stopPreview'),
    vi.spyOn(mediaPort, 'startCall'),
    vi.spyOn(mediaPort, 'endCall'),
    vi.spyOn(mediaPort, 'setMicEnabled'),
    vi.spyOn(mediaPort, 'setCameraEnabled'),
    vi.spyOn(mediaPort, 'startScreenShare'),
    vi.spyOn(mediaPort, 'stopScreenShare'),
    vi.spyOn(mediaPort, 'selectCamera'),
    vi.spyOn(mediaPort, 'selectMicrophone'),
    vi.spyOn(mediaPort, 'handleSignal'),
    vi.spyOn(mediaPort, 'clearError'),
    vi.spyOn(mediaPort, 'setSignalSender'),
    vi.spyOn(mediaPort, 'setIceServers'),
  ];
}

describe('PULSO Tor Mode, Honest Normal Runtime Guidance & Strict MediaPort Blocking', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', '/');
    }
  });

  it('shows honest local-launcher guidance in normal runtime across all 4 locales without fabricating a .onion address', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const baseTransport = hub.createTransport();
    const createRoomSpy = vi.spyOn(baseTransport, 'createRoom');

    render(
      <App
        transport={baseTransport}
        mediaPort={new FakeMediaPort()}
        initialLocale="pt-br"
        runtimeInfo={{ runtimeMode: 'normal' }}
      />,
    );

    const modeGroup = screen.getByRole('radiogroup', { name: /modo da sala/i });
    expect(within(modeGroup).getByRole('radio', { name: /modo normal/i })).toBeChecked();
    const torRadio = within(modeGroup).getByRole('radio', { name: /modo tor/i });
    expect(torRadio).not.toBeChecked();

    // Selecting Modo Tor in normal runtime shows honest guidance and disables room creation
    await user.click(torRadio);
    expect(torRadio).toBeChecked();
    expect(screen.getByText(/modo tor requer o launcher local/i)).toBeInTheDocument();
    expect(screen.getByText('npm run start:tor')).toBeInTheDocument();
    expect(screen.queryByText(V3_ONION_REGEX)).not.toBeInTheDocument();

    const createBtnPt = screen.getByRole('button', { name: /criar nova sala/i });
    expect(createBtnPt).toBeDisabled();
    await user.click(createBtnPt);
    expect(createRoomSpy).not.toHaveBeenCalled();

    // Verify localized honest guidance across en, es, zh-CN
    const localeSelect = screen.getByLabelText(/idioma/i);
    await user.selectOptions(localeSelect, 'en');
    expect(screen.getByRole('radiogroup', { name: /room mode/i })).toBeInTheDocument();
    expect(screen.getByText(/tor mode requires the local launcher/i)).toBeInTheDocument();
    expect(screen.getByText('npm run start:tor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create new room/i })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/language/i), 'es');
    expect(screen.getByRole('radiogroup', { name: /modo de sala/i })).toBeInTheDocument();
    expect(screen.getByText(/el modo tor requiere el lanzador local/i)).toBeInTheDocument();
    expect(screen.getByText('npm run start:tor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /crear nueva sala/i })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/idioma/i), 'zh-CN');
    expect(screen.getByRole('radiogroup', { name: /房间模式/i })).toBeInTheDocument();
    expect(screen.getByText(/tor 模式需要本地启动器/i)).toBeInTheDocument();
    expect(screen.getByText('npm run start:tor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /创建新房间/i })).toBeDisabled();

    // Switching back to Normal Mode keeps room creation working normally
    await user.selectOptions(screen.getByLabelText(/语言/i), 'pt-br');
    await user.click(screen.getByRole('radio', { name: /modo normal/i }));
    const enabledCreateBtn = screen.getByRole('button', { name: /criar nova sala/i });
    expect(enabledCreateBtn).toBeEnabled();
    await user.click(enabledCreateBtn);

    await waitFor(() => {
      expect(screen.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });
    expect(createRoomSpy).toHaveBeenCalledWith(expect.objectContaining({ mode: 'normal' }));
  });

  it('locks mode to Tor in tor runtime, waits for bootstrapping -> ready, and creates room with real .onion invite link and E2EE', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const baseHostTransport = hub.createTransport();
    const capturedCreates: Array<{ mode: string; onionAddress?: string }> = [];

    const hostTransport: RoomTransport = {
      ...baseHostTransport,
      createRoom: async (params) => {
        capturedCreates.push({ mode: params.mode, onionAddress: params.onionAddress });
        await baseHostTransport.createRoom(params);
      },
      subscribe: (listener) => baseHostTransport.subscribe(listener),
      joinRoom: (p) => baseHostTransport.joinRoom(p),
      leaveRoom: () => baseHostTransport.leaveRoom(),
      expireRoom: () =>
        baseHostTransport.expireRoom
          ? baseHostTransport.expireRoom()
          : baseHostTransport.leaveRoom(),
      sendEncryptedMessage: (e) => baseHostTransport.sendEncryptedMessage(e),
      sendKeyExchange: (k, opts) => baseHostTransport.sendKeyExchange(k, opts),
      setTyping: (t) => baseHostTransport.setTyping(t),
      sendCallSignal: (s) => baseHostTransport.sendCallSignal(s),
      notifyActivity: () => baseHostTransport.notifyActivity(),
      dispose: () => baseHostTransport.dispose(),
    };

    let copiedInviteUrl = '';
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
      copiedInviteUrl = text;
    });

    const hostView = render(
      <App
        transport={hostTransport}
        mediaPort={new FakeMediaPort()}
        initialLocale="pt-br"
        runtimeInfo={{ runtimeMode: 'tor', torStatus: 'bootstrapping' }}
      />,
    );
    const host = within(hostView.container);

    // Normal mode is disabled/locked, Tor mode is checked, and creation is disabled during bootstrap
    const normalRadio = host.getByRole('radio', { name: /modo normal/i });
    const torRadio = host.getByRole('radio', { name: /modo tor/i });
    expect(normalRadio).toBeDisabled();
    expect(torRadio).toBeChecked();
    expect(host.getByText(/inicializando rede tor/i)).toBeInTheDocument();
    expect(host.getByRole('button', { name: /criar nova sala/i })).toBeDisabled();

    // Error state shows actionable alert and keeps creation disabled
    hostView.rerender(
      <App
        transport={hostTransport}
        mediaPort={new FakeMediaPort()}
        initialLocale="pt-br"
        runtimeInfo={{ runtimeMode: 'tor', torStatus: 'error' }}
      />,
    );
    expect(host.getByRole('alert')).toHaveTextContent(/falha ao iniciar o daemon tor/i);
    expect(host.getByRole('button', { name: /criar nova sala/i })).toBeDisabled();

    // Ready state enables creation and displays real .onion address
    hostView.rerender(
      <App
        transport={hostTransport}
        mediaPort={new FakeMediaPort()}
        initialLocale="pt-br"
        runtimeInfo={{ runtimeMode: 'tor', torStatus: 'ready', onionAddress: REAL_ONION }}
      />,
    );
    expect(host.getByText(/serviço \.onion pronto/i)).toBeInTheDocument();
    expect(host.getByText(REAL_ONION)).toBeInTheDocument();

    const createBtn = host.getByRole('button', { name: /criar nova sala/i });
    expect(createBtn).toBeEnabled();

    await user.type(host.getByLabelText(/seu nome/i), 'Ana');
    await user.click(createBtn);

    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    expect(capturedCreates).toHaveLength(1);
    expect(capturedCreates[0]).toEqual({
      mode: 'tor',
      onionAddress: REAL_ONION,
    });

    // Modo Tor badge visible in header and sidebar, plus copy .onion and Safer/Safest notice
    const header = host.getByRole('banner');
    const sidebar = host.getByLabelText(/barra lateral da sala/i);
    expect(within(header).getByText(/modo tor/i)).toBeInTheDocument();
    expect(within(sidebar).getByText(/modo tor/i)).toBeInTheDocument();
    expect(host.getAllByText(V3_ONION_REGEX).length).toBeGreaterThan(0);
    expect(host.getByText(/safer.*safest|safest/i)).toBeInTheDocument();

    await user.click(host.getByRole('button', { name: /copiar \.onion/i }));
    expect(host.getByRole('button', { name: /\.onion copiado!/i })).toBeInTheDocument();

    await user.click(host.getByRole('button', { name: /compartilhar/i }));
    await waitFor(() => {
      expect(copiedInviteUrl).toContain('&mode=tor#k=');
    });
    expect(copiedInviteUrl).toMatch(new RegExp(`^${REAL_ONION.replace('.', '\\.')}/\\?room=[A-Z0-9-]+&mode=tor#k=`));

    // Guest joins via invite link in Tor Browser (.onion runtime) and exchanges encrypted messages
    const guestView = render(
      <App
        transport={hub.createTransport()}
        mediaPort={new FakeMediaPort()}
        initialUrl={copiedInviteUrl}
        initialLocale="pt-br"
        runtimeInfo={{ runtimeMode: 'tor', torStatus: 'ready', onionAddress: REAL_ONION }}
      />,
    );
    const guest = within(guestView.container);

    await waitFor(() => {
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    expect(within(guest.getByRole('banner')).getByText(/modo tor/i)).toBeInTheDocument();
    expect(guest.getByText(/conectado via modo tor/i)).toBeInTheDocument();
    expect(guest.getByText(/safer.*safest/i)).toBeInTheDocument();

    const hostComposer = host.getByLabelText(/^mensagem efêmera$/i);
    await user.type(hostComposer, 'Mensagem cifrada sobre Tor.{enter}');

    await waitFor(() => {
      expect(guest.getByText('Mensagem cifrada sobre Tor.')).toBeInTheDocument();
    });
  });

  it('disables Video Call button with privacy notice and guarantees zero MediaPort invocations even on interaction or incoming call_signal', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const baseHostTransport = hub.createTransport();

    const hostListeners = new Set<(event: TransportEvent) => void>();
    const hostTransport: RoomTransport = {
      createRoom: (p) => baseHostTransport.createRoom(p),
      joinRoom: (p) => baseHostTransport.joinRoom(p),
      leaveRoom: () => baseHostTransport.leaveRoom(),
      expireRoom: () =>
        baseHostTransport.expireRoom
          ? baseHostTransport.expireRoom()
          : baseHostTransport.leaveRoom(),
      sendEncryptedMessage: (e) => baseHostTransport.sendEncryptedMessage(e),
      sendKeyExchange: (k, opts) => baseHostTransport.sendKeyExchange(k, opts),
      setTyping: (t) => baseHostTransport.setTyping(t),
      sendCallSignal: (s) => baseHostTransport.sendCallSignal(s),
      notifyActivity: () => baseHostTransport.notifyActivity(),
      dispose: () => baseHostTransport.dispose(),
      subscribe: (listener) => {
        hostListeners.add(listener);
        const unsubscribe = baseHostTransport.subscribe(listener);
        return () => {
          hostListeners.delete(listener);
          unsubscribe();
        };
      },
    };

    const hostMedia = new FakeMediaPort();
    const guestMedia = new FakeMediaPort();
    const hostSpies = spyOnAllMediaPortMethods(hostMedia);
    const guestSpies = spyOnAllMediaPortMethods(guestMedia);

    const hostView = render(
      <App
        transport={hostTransport}
        mediaPort={hostMedia}
        initialLocale="en"
        runtimeInfo={{ runtimeMode: 'tor', torStatus: 'ready', onionAddress: REAL_ONION }}
      />,
    );
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /create new room/i }));

    await waitFor(() => {
      expect(host.getByText(/your room has been created!/i)).toBeInTheDocument();
    });

    const roomCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();

    const guestView = render(
      <App
        transport={hub.createTransport()}
        mediaPort={guestMedia}
        initialUrl={`${REAL_ONION}/?room=${roomCode}&mode=tor`}
        initialLocale="en"
        runtimeInfo={{ runtimeMode: 'tor', torStatus: 'ready', onionAddress: REAL_ONION }}
      />,
    );
    const guest = within(guestView.container);

    await waitFor(() => {
      expect(guest.getAllByText(/2 people online/i).length).toBeGreaterThan(0);
    });

    const hostHeader = host.getByRole('banner');
    const hostVideoBtn = within(hostHeader).getByRole('button', { name: /start video call/i });
    expect(hostVideoBtn).toBeDisabled();
    expect(hostVideoBtn).toHaveAttribute('aria-disabled', 'true');
    expect(
      host.getByText(/video calls are blocked in tor mode to protect your anonymity/i),
    ).toBeInTheDocument();

    const guestHeader = guest.getByRole('banner');
    const guestVideoBtn = within(guestHeader).getByRole('button', { name: /start video call/i });
    expect(guestVideoBtn).toBeDisabled();
    expect(guestVideoBtn).toHaveAttribute('aria-disabled', 'true');

    await user.click(hostVideoBtn);
    fireEvent.click(hostVideoBtn);
    expect(host.queryByRole('dialog')).not.toBeInTheDocument();

    hostListeners.forEach((listener) =>
      listener({
        type: 'call_signal',
        signal: {
          type: 'media_state',
          fromId: 'rogue-peer',
          payload: { inCall: true, micEnabled: true, cameraEnabled: true, screenSharing: false },
        },
      }),
    );

    for (const spy of [...hostSpies, ...guestSpies]) {
      expect(spy).not.toHaveBeenCalled();
    }

    expect(hostMedia.getSnapshot().phase).toBe('idle');
    expect(guestMedia.getSnapshot().phase).toBe('idle');
    expect(host.queryByRole('button', { name: /end call/i })).not.toBeInTheDocument();
  });
});
