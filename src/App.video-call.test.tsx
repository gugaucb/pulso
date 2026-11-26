import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { TransportEvent } from './domain/types';
import { FakeMediaPort } from './media/FakeMediaPort';
import { InMemoryTransportHub } from './transport/InMemoryTransport';
import type { RoomTransport } from './transport/RoomTransport';

async function setupConnectedPair(options?: {
  hostMedia?: FakeMediaPort;
  guestMedia?: FakeMediaPort;
}) {
  const user = userEvent.setup();
  const hub = new InMemoryTransportHub();
  const hostMedia = options?.hostMedia ?? new FakeMediaPort();
  const guestMedia = options?.guestMedia ?? new FakeMediaPort();

  const hostView = render(
    <App
      transport={hub.createTransport()}
      mediaPort={hostMedia}
      initialLocale="pt-br"
    />,
  );
  const guestView = render(
    <App
      transport={hub.createTransport()}
      mediaPort={guestMedia}
      initialLocale="pt-br"
    />,
  );

  const host = within(hostView.container);
  const guest = within(guestView.container);

  await user.type(host.getByLabelText(/seu nome/i), 'Ana');
  await user.click(host.getByRole('button', { name: /criar nova sala/i }));

  await waitFor(() => {
    expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
  });

  const codeMatch = host.getAllByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)[0].textContent!.trim();

  await user.type(guest.getByLabelText(/código da sala/i), codeMatch);
  await user.type(guest.getByLabelText(/seu nome/i), 'João Silva');
  await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

  await waitFor(() => {
    expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
  });

  return { user, host, guest, hostMedia, guestMedia, hostView, guestView };
}

describe('Video Call flow (Normal Mode)', () => {
  it('opens camera preview modal from header button, allows device selection, and starts call in hybrid layout', async () => {
    const { user, host } = await setupConnectedPair();

    const startCallButton = host.getByRole('button', { name: /iniciar chamada de vídeo/i });
    expect(startCallButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(startCallButton);

    const dialog = await host.findByRole('dialog', {
      name: /pré-visualização antes da chamada/i,
    });
    expect(dialog).toBeInTheDocument();

    const modal = within(dialog);
    const cameraSelect = modal.getByRole('combobox', { name: /câmera/i }) as HTMLSelectElement;
    const micSelect = modal.getByRole('combobox', { name: /microfone/i }) as HTMLSelectElement;
    expect(cameraSelect.options.length).toBeGreaterThanOrEqual(2);
    expect(micSelect.options.length).toBeGreaterThanOrEqual(2);
    expect(modal.getByRole('progressbar', { name: /nível de áudio/i })).toBeInTheDocument();

    await user.selectOptions(cameraSelect, 'fake-cam-2');
    expect(cameraSelect.value).toBe('fake-cam-2');

    await user.click(modal.getByRole('button', { name: /entrar com vídeo/i }));

    await waitFor(() => {
      expect(host.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(host.getByText(/você com câmera ligada/i)).toBeInTheDocument();
    expect(host.getByRole('button', { name: /silenciar microfone/i })).toBeInTheDocument();
    expect(host.getByRole('button', { name: /desligar câmera/i })).toBeInTheDocument();
    expect(host.getByRole('button', { name: /compartilhar tela/i })).toBeInTheDocument();
    expect(host.getByRole('button', { name: /encerrar chamada/i })).toBeInTheDocument();
    expect(host.getByRole('button', { name: /alternar layout/i })).toBeInTheDocument();

    // Ephemeral messages composer remains visible and usable below the video stage
    const composer = host.getByLabelText(/^mensagem efêmera$/i);
    await user.type(composer, 'Vendo você bem!{enter}');
    await waitFor(() => {
      expect(host.getByText('Vendo você bem!')).toBeInTheDocument();
    });
  });

  it('supports canceling preview, switching hybrid/pip/focus layouts, toggling media controls, and ending call', async () => {
    const { user, host, hostMedia } = await setupConnectedPair();

    // Open preview and cancel
    await user.click(host.getByRole('button', { name: /iniciar chamada de vídeo/i }));
    const cancelDialog = await host.findByRole('dialog');
    await user.click(within(cancelDialog).getByRole('button', { name: /cancelar/i }));
    await waitFor(() => {
      expect(host.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(hostMedia.getSnapshot().phase).toBe('idle');

    // Re-open and start call
    await user.click(host.getByRole('button', { name: /iniciar chamada de vídeo/i }));
    const dialog = await host.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /entrar com vídeo/i }));
    await waitFor(() => {
      expect(host.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Starts in hybrid layout
    const stage = host.getByRole('region', { name: /iniciar chamada de vídeo/i });
    expect(stage).toHaveAttribute('data-call-layout', 'hybrid');

    // Switch to Picture-in-Picture (pip)
    await user.click(host.getByRole('button', { name: /alternar layout/i }));
    await user.click(host.getByRole('menuitemradio', { name: /picture-in-picture/i }));
    expect(host.getByRole('region', { name: /iniciar chamada de vídeo/i })).toHaveAttribute(
      'data-call-layout',
      'pip',
    );
    // Message composer still visible in pip mode
    expect(host.getByLabelText(/^mensagem efêmera$/i)).toBeInTheDocument();

    // Switch to Video Focus (focus) - text panel collapsed by default
    await user.click(host.getByRole('button', { name: /alternar layout/i }));
    await user.click(host.getByRole('menuitemradio', { name: /foco em vídeo/i }));
    expect(host.getByRole('region', { name: /iniciar chamada de vídeo/i })).toHaveAttribute(
      'data-call-layout',
      'focus',
    );
    expect(host.queryByLabelText(/^mensagem efêmera$/i)).not.toBeInTheDocument();

    // Expand collapsible side text panel
    const showMessagesButton = host.getByRole('button', { name: /mostrar mensagens efêmeras/i });
    expect(showMessagesButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(showMessagesButton);
    expect(host.getByLabelText(/^mensagem efêmera$/i)).toBeInTheDocument();

    // Collapse side text panel
    await user.click(host.getByRole('button', { name: /recolher mensagens efêmeras/i }));
    expect(host.queryByLabelText(/^mensagem efêmera$/i)).not.toBeInTheDocument();

    // Switch back to Hybrid
    await user.click(host.getByRole('button', { name: /alternar layout/i }));
    await user.click(host.getByRole('menuitemradio', { name: /modo híbrido/i }));
    expect(host.getByRole('region', { name: /iniciar chamada de vídeo/i })).toHaveAttribute(
      'data-call-layout',
      'hybrid',
    );

    // Toggle mic mute/unmute
    const muteButton = host.getByRole('button', { name: /silenciar microfone/i });
    await user.click(muteButton);
    const unmuteButton = host.getByRole('button', { name: /ativar microfone/i });
    expect(unmuteButton).toHaveAttribute('aria-pressed', 'true');
    await user.click(unmuteButton);
    expect(host.getByRole('button', { name: /silenciar microfone/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Toggle camera off/on
    await user.click(host.getByRole('button', { name: /desligar câmera/i }));
    expect(host.getByText(/você com câmera desligada/i)).toBeInTheDocument();
    await user.click(host.getByRole('button', { name: /ligar câmera/i }));
    expect(host.getByText(/você com câmera ligada/i)).toBeInTheDocument();

    // Toggle screen share on/off
    await user.click(host.getByRole('button', { name: /compartilhar tela/i }));
    expect(host.getByText(/compartilhando tela/i)).toBeInTheDocument();
    await user.click(host.getByRole('button', { name: /parar compartilhamento/i }));
    expect(host.queryByText(/compartilhando tela/i)).not.toBeInTheDocument();

    // End call
    await user.click(host.getByRole('button', { name: /encerrar chamada/i }));
    await waitFor(() => {
      expect(host.queryByRole('region', { name: /iniciar chamada de vídeo/i })).not.toBeInTheDocument();
    });
    expect(host.getByRole('button', { name: /iniciar chamada de vídeo/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('updates sidebar active video icon and shows localized notices when peer mutes, turns off camera, or leaves call', async () => {
    const { user, host, guest } = await setupConnectedPair();

    // Host starts call
    await user.click(host.getByRole('button', { name: /iniciar chamada de vídeo/i }));
    const hostDialog = await host.findByRole('dialog');
    await user.click(within(hostDialog).getByRole('button', { name: /entrar com vídeo/i }));

    // Guest joins call as well
    await user.click(guest.getByRole('button', { name: /iniciar chamada de vídeo/i }));
    const guestDialog = await guest.findByRole('dialog');
    await user.click(within(guestDialog).getByRole('button', { name: /entrar com vídeo/i }));

    // Sidebar on Host shows active video indicators for both participants
    const hostSidebar = host.getByRole('complementary', { name: /barra lateral da sala/i });
    await waitFor(() => {
      expect(within(hostSidebar).getAllByRole('img', { name: /vídeo ativo/i })).toHaveLength(2);
    });

    // Guest mutes microphone -> Host sees localized notice
    await user.click(guest.getByRole('button', { name: /silenciar microfone/i }));
    await waitFor(() => {
      expect(host.getByText(/joão silva silenciou o microfone/i)).toBeInTheDocument();
    });

    // Guest unmutes -> mute notice clears
    await user.click(guest.getByRole('button', { name: /ativar microfone/i }));
    await waitFor(() => {
      expect(host.queryByText(/joão silva silenciou o microfone/i)).not.toBeInTheDocument();
    });

    // Guest disables camera -> Host sees camera-off notice and sidebar drops peer's video icon
    await user.click(guest.getByRole('button', { name: /desligar câmera/i }));
    await waitFor(() => {
      expect(host.getByText(/joão silva desligou a câmera/i)).toBeInTheDocument();
      expect(within(hostSidebar).getAllByRole('img', { name: /vídeo ativo/i })).toHaveLength(1);
    });

    // Guest ends call -> Host sees left-call notice
    await user.click(guest.getByRole('button', { name: /encerrar chamada/i }));
    await waitFor(() => {
      expect(host.getByText(/joão silva saiu da chamada de vídeo/i)).toBeInTheDocument();
    });
  });

  it('shows dismissible fallback banner on permission denial or connection failure while keeping ephemeral chat working', async () => {
    const hostMedia = new FakeMediaPort({ permissionDenied: true });
    const { user, host, guest } = await setupConnectedPair({ hostMedia });

    // Host clicks camera button -> permission denied -> error banner appears, no call active
    await user.click(host.getByRole('button', { name: /iniciar chamada de vídeo/i }));
    await waitFor(() => {
      expect(host.getByRole('alert')).toHaveTextContent(
        /permissão de câmera ou microfone negada/i,
      );
    });
    expect(host.queryByRole('dialog')).not.toBeInTheDocument();
    expect(host.queryByRole('region', { name: /iniciar chamada de vídeo/i })).not.toBeInTheDocument();

    // Ephemeral messages work uninterrupted between Host and Guest
    await user.type(host.getByLabelText(/^mensagem efêmera$/i), 'Sem câmera, vamos por texto!{enter}');
    await waitFor(() => {
      expect(guest.getByText('Sem câmera, vamos por texto!')).toBeInTheDocument();
    });

    // User can dismiss the error banner
    await user.click(host.getByRole('button', { name: /dispensar aviso/i }));
    expect(host.queryByRole('alert')).not.toBeInTheDocument();

    // Simulate permission granted, but connection failure on call start
    hostMedia.setPermissionDenied(false);
    hostMedia.setConnectionFailed(true);

    await user.click(host.getByRole('button', { name: /iniciar chamada de vídeo/i }));
    const dialog = await host.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /entrar com vídeo/i }));

    await waitFor(() => {
      expect(host.getByRole('alert')).toHaveTextContent(
        /não foi possível estabelecer a chamada de vídeo/i,
      );
    });

    // Text chat still works after connection failure
    await user.type(guest.getByLabelText(/^mensagem efêmera$/i), 'Recebido por texto!{enter}');
    await waitFor(() => {
      expect(host.getByText('Recebido por texto!')).toBeInTheDocument();
    });
  });

  it('supports FakeMediaPort remote simulation helpers and English locale labels', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const fakeMedia = new FakeMediaPort();

    const hostView = render(
      <App
        transport={hub.createTransport()}
        mediaPort={fakeMedia}
        initialLocale="en"
      />,
    );
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /create new room/i }));
    await waitFor(() => {
      expect(host.getByText(/your room has been created!/i)).toBeInTheDocument();
    });

    await user.click(host.getByRole('button', { name: /start video call/i }));
    const dialog = await host.findByRole('dialog', { name: /camera & mic preview/i });
    await user.click(within(dialog).getByRole('button', { name: /join with video/i }));

    await waitFor(() => {
      expect(host.getByText(/you have camera on/i)).toBeInTheDocument();
    });

    fakeMedia.simulatePeerJoinedCall();
    fakeMedia.simulatePeerMuted(true);
    await waitFor(() => {
      expect(host.getByText(/guest muted their microphone/i)).toBeInTheDocument();
    });

    fakeMedia.simulatePeerCameraOff(true);
    await waitFor(() => {
      expect(host.getByText(/guest turned off their camera/i)).toBeInTheDocument();
    });

    fakeMedia.simulatePeerLeftCall();
    await waitFor(() => {
      expect(host.getByText(/guest left the video call/i)).toBeInTheDocument();
    });
  });

  it('propagates iceServers from room_joined to MediaPort in Normal mode and skips in Tor mode', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const baseTransport = hub.createTransport();
    const iceFromServer = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ];

    const transportWithIce: RoomTransport = {
      ...baseTransport,
      createRoom: (p) => baseTransport.createRoom(p),
      joinRoom: (p) => baseTransport.joinRoom(p),
      leaveRoom: () => baseTransport.leaveRoom(),
      sendEncryptedMessage: (e) => baseTransport.sendEncryptedMessage(e),
      sendKeyExchange: (k, o) => baseTransport.sendKeyExchange(k, o),
      setTyping: (t) => baseTransport.setTyping(t),
      sendCallSignal: (s) => baseTransport.sendCallSignal(s),
      notifyActivity: () => baseTransport.notifyActivity(),
      dispose: () => baseTransport.dispose(),
      subscribe: (listener) =>
        baseTransport.subscribe((event: TransportEvent) => {
          if (event.type === 'room_joined') {
            listener({ ...event, iceServers: iceFromServer });
            return;
          }
          listener(event);
        }),
    };

    const normalMedia = new FakeMediaPort();
    const setIceSpy = vi.spyOn(normalMedia, 'setIceServers');

    const normalView = render(
      <App transport={transportWithIce} mediaPort={normalMedia} initialLocale="en" />,
    );
    const normal = within(normalView.container);
    await user.click(normal.getByRole('button', { name: /create new room/i }));
    await waitFor(() => {
      expect(normal.getByText(/your room has been created!/i)).toBeInTheDocument();
    });
    expect(setIceSpy).toHaveBeenCalledWith(iceFromServer);
    expect(normalMedia.getIceServers()).toEqual(iceFromServer);

    // Even if a rogue transport delivered iceServers on a Tor room, MediaPort.setIceServers must never be called
    const torMedia = new FakeMediaPort();
    const torIceSpy = vi.spyOn(torMedia, 'setIceServers');
    const torView = render(
      <App
        transport={transportWithIce}
        mediaPort={torMedia}
        initialLocale="en"
        runtimeInfo={{
          runtimeMode: 'tor',
          torStatus: 'ready',
          onionAddress: `http://${'q'.repeat(56)}.onion`,
        }}
      />,
    );
    const tor = within(torView.container);
    await user.click(tor.getByRole('button', { name: /create new room/i }));
    await waitFor(() => {
      expect(tor.getByText(/your room has been created!/i)).toBeInTheDocument();
    });
    expect(torIceSpy).not.toHaveBeenCalled();
    expect(torMedia.getIceServers()).toEqual([]);
  });
});
