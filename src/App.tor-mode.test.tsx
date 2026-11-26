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
  ];
}

describe('PULSO Ticket 07: Tor Mode & Strict MediaPort Blocking', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', '/');
    }
  });

  it('translates mode selector in all 4 locales and creates a Tor room with v3 .onion address, room code, and host readiness instructions', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const hostMedia = new FakeMediaPort();

    render(
      <App
        transport={hub.createTransport()}
        mediaPort={hostMedia}
        initialLocale="pt-br"
      />,
    );

    const modeGroup = screen.getByRole('radiogroup', { name: /modo da sala/i });
    expect(within(modeGroup).getByRole('radio', { name: /modo normal/i })).toBeChecked();
    const torRadio = within(modeGroup).getByRole('radio', { name: /modo tor/i });
    expect(torRadio).not.toBeChecked();

    // Verify translations across en, es, zh-CN, and back to pt-br
    const localeSelect = screen.getByLabelText(/idioma/i);
    await user.selectOptions(localeSelect, 'en');
    expect(screen.getByRole('radiogroup', { name: /room mode/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /tor mode/i })).toBeInTheDocument();

    await user.selectOptions(localeSelect, 'es');
    expect(screen.getByRole('radiogroup', { name: /modo de sala/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /modo tor/i })).toBeInTheDocument();

    await user.selectOptions(localeSelect, 'zh-CN');
    expect(screen.getByRole('radiogroup', { name: /房间模式/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /tor 模式/i })).toBeInTheDocument();

    await user.selectOptions(localeSelect, 'pt-br');

    // Select Tor Mode and create room as Host
    await user.click(screen.getByRole('radio', { name: /modo tor/i }));
    expect(screen.getByRole('radio', { name: /modo tor/i })).toBeChecked();

    await user.type(screen.getByLabelText(/seu nome/i), 'Ana');
    await user.click(screen.getByRole('button', { name: /criar nova sala/i }));

    await waitFor(() => {
      expect(screen.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    // Modo Tor badge visible in header and sidebar
    const header = screen.getByRole('banner');
    const sidebar = screen.getByLabelText(/barra lateral da sala/i);
    expect(within(header).getByText(/modo tor/i)).toBeInTheDocument();
    expect(within(sidebar).getByText(/modo tor/i)).toBeInTheDocument();

    // Created card highlights .onion address + Room Code + Host readiness instructions
    expect(screen.getAllByText(V3_ONION_REGEX).length).toBeGreaterThan(0);
    expect(screen.getAllByText(ROOM_CODE_REGEX).length).toBeGreaterThan(0);
    expect(screen.getByText(/compartilhe pelo tor browser/i)).toBeInTheDocument();
    expect(screen.getByText(/sala \.onion pronta/i)).toBeInTheDocument();

    // Copy .onion action works
    const copyOnionBtn = screen.getByRole('button', { name: /copiar \.onion/i });
    await user.click(copyOnionBtn);
    expect(screen.getByRole('button', { name: /\.onion copiado!/i })).toBeInTheDocument();

    // Discreet Tor Browser Safer / Safest security level notice is visible
    expect(screen.getByText(/safer.*safest|safest/i)).toBeInTheDocument();
  });

  it('opens a room in Tor Mode when joining via ?mode=tor or &onion= invite link and exchanges encrypted messages', async () => {
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
      />,
    );
    const host = within(hostView.container);

    await user.click(host.getByRole('radio', { name: /modo tor/i }));
    await user.click(host.getByRole('button', { name: /criar nova sala/i }));

    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    expect(capturedCreates).toHaveLength(1);
    const createdParams = capturedCreates[0];
    expect(createdParams.mode).toBe('tor');
    expect(createdParams.onionAddress).toMatch(/^http:\/\/[a-z2-7]{56}\.onion$/);

    await user.click(host.getByRole('button', { name: /compartilhar/i }));
    await waitFor(() => {
      expect(copiedInviteUrl).toContain('&mode=tor#k=');
    });
    expect(copiedInviteUrl).toMatch(/^http:\/\/[a-z2-7]{56}\.onion\/\?room=/);

    const roomCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();
    const onionHost = createdParams.onionAddress!.replace(/^http:\/\//, '');
    const inviteHash = new URL(copiedInviteUrl).hash;

    // Guest joins via invite link containing &onion= and #k=
    const guestView = render(
      <App
        transport={hub.createTransport()}
        mediaPort={new FakeMediaPort()}
        initialUrl={`https://pulso.local/?room=${roomCode}&onion=${onionHost}${inviteHash}`}
        initialLocale="pt-br"
      />,
    );
    const guest = within(guestView.container);

    await waitFor(() => {
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    // Guest sees Modo Tor badge, guest readiness status, .onion address, and security-level notice
    expect(within(guest.getByRole('banner')).getByText(/modo tor/i)).toBeInTheDocument();
    expect(guest.getByText(/conectado via modo tor/i)).toBeInTheDocument();
    expect(guest.getAllByText(V3_ONION_REGEX).length).toBeGreaterThan(0);
    expect(guest.getByText(/safer.*safest/i)).toBeInTheDocument();

    // Encrypted ephemeral messaging works normally in Tor Mode
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
      <App transport={hostTransport} mediaPort={hostMedia} initialLocale="en" />,
    );
    const host = within(hostView.container);

    await user.click(host.getByRole('radio', { name: /tor mode/i }));
    await user.click(host.getByRole('button', { name: /create new room/i }));

    await waitFor(() => {
      expect(host.getByText(/your room has been created!/i)).toBeInTheDocument();
    });

    const roomCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();

    const guestView = render(
      <App
        transport={hub.createTransport()}
        mediaPort={guestMedia}
        initialUrl={`https://pulso.local/?room=${roomCode}&mode=tor`}
        initialLocale="en"
      />,
    );
    const guest = within(guestView.container);

    await waitFor(() => {
      expect(guest.getAllByText(/2 people online/i).length).toBeGreaterThan(0);
    });

    // Video call button in RoomHeader is explicitly disabled with privacy explanation
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

    // Attempt to click/fireEvent on the disabled Video Call button
    await user.click(hostVideoBtn);
    fireEvent.click(hostVideoBtn);
    expect(host.queryByRole('dialog')).not.toBeInTheDocument();

    // Emit a rogue incoming call_signal to Host transport: must be completely ignored
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

    // Confirm zero MediaPort methods were ever called on Host or Guest
    for (const spy of [...hostSpies, ...guestSpies]) {
      expect(spy).not.toHaveBeenCalled();
    }

    expect(hostMedia.getSnapshot().phase).toBe('idle');
    expect(guestMedia.getSnapshot().phase).toBe('idle');
    expect(host.queryByRole('button', { name: /end call/i })).not.toBeInTheDocument();
  });
});
