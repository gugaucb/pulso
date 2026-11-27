import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { TransportEvent } from './domain/types';
import { InMemoryTransportHub } from './transport/InMemoryTransport';
import type { RoomTransport } from './transport/RoomTransport';

const ROOM_CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

describe('PULSO Ticket 04: Slack-style Room UX', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', '/');
    }
  });

  it('renders RoomHeader connection status, settings trigger in ⋯ menu, and RoomSidebar participant status + video slot + shortcuts', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const baseHostTransport = hub.createTransport();

    // Wrap host transport only to simulate a peer participant with videoEnabled=true via public TransportEvent seam
    const hostListeners = new Set<(event: TransportEvent) => void>();
    const emitToHost = (event: TransportEvent) => {
      hostListeners.forEach((listener) => listener(event));
    };
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

    const hostView = render(<App transport={hostTransport} initialLocale="pt-br" />);
    const guestView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);

    const host = within(hostView.container);
    const guest = within(guestView.container);

    await user.type(host.getByLabelText(/seu nome/i), 'Ana');
    await user.click(host.getByRole('button', { name: /criar nova sala/i }));

    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    // While waiting for guest, header shows waiting status indicator and "Aguardando alguém…"
    const hostHeader = host.getByRole('banner');
    expect(within(hostHeader).getByText(/aguardando alguém/i)).toBeInTheDocument();
    expect(within(hostHeader).getByText(/aguardando$/i)).toBeInTheDocument();

    const createdCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();

    await user.type(guest.getByLabelText(/código da sala/i), createdCode);
    await user.type(guest.getByLabelText(/seu nome/i), 'João Silva');
    await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

    // Once guest joins, header switches to online indicator + "2 pessoas online"
    await waitFor(() => {
      expect(within(hostHeader).getByText(/2 pessoas online/i)).toBeInTheDocument();
      expect(within(hostHeader).getByText(/^online$/i)).toBeInTheDocument();
    });

    // Sidebar displays "Sala atual", both participants with initials, online status, and shortcuts including "Configurações"
    const sidebar = host.getByLabelText(/barra lateral da sala/i);
    expect(within(sidebar).getByText(/sala atual/i)).toBeInTheDocument();
    expect(within(sidebar).getByText(/sobre a sala/i)).toBeInTheDocument();
    expect(within(sidebar).getByText(/atalhos/i)).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: /copiar link/i })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: /^configurações$/i })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: /sair da sala/i })).toBeInTheDocument();

    // Online status dot indicator for participants
    expect(within(sidebar).getAllByLabelText(/^online$/i).length).toBeGreaterThanOrEqual(2);

    // Emit participant_joined with videoEnabled=true on guest to verify video-active icon slot
    emitToHost({
      type: 'participant_joined',
      participant: {
        id: 'guest-id',
        displayName: 'João Silva',
        role: 'guest',
        online: true,
        videoEnabled: true,
      },
      participants: [
        { id: 'host-id', displayName: 'Ana', role: 'host', online: true, videoEnabled: false },
        { id: 'guest-id', displayName: 'João Silva', role: 'guest', online: true, videoEnabled: true },
      ],
    });

    await waitFor(() => {
      expect(within(sidebar).getByLabelText(/vídeo ativo/i)).toBeInTheDocument();
    });

    // Header ⋯ menu includes Privacy & Media Settings trigger
    await user.click(within(hostHeader).getByRole('button', { name: /mais opções da sala/i }));
    const menu = host.getByRole('menu');
    const settingsMenuItem = within(menu).getByRole('menuitem', {
      name: /configurações de mídia e privacidade/i,
    });
    expect(settingsMenuItem).toBeInTheDocument();

    await user.click(settingsMenuItem);
    expect(host.getByRole('dialog', { name: /privacidade/i })).toBeInTheDocument();
    await user.click(host.getByRole('button', { name: /fechar/i }));
    expect(host.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows friendly Host empty state and animated typing indicator that clears on send and idle timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const hub = new InMemoryTransportHub();

    const hostView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);
    const guestView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);

    const host = within(hostView.container);
    const guest = within(guestView.container);

    await user.type(host.getByLabelText(/seu nome/i), 'Ana');
    await user.click(host.getByRole('button', { name: /criar nova sala/i }));

    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    // Friendly Host empty state invites sharing the Room Code or invite link
    expect(
      host.getByText(/compartilhe o código da sala ou o link de convite/i),
    ).toBeInTheDocument();

    const createdCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();
    await user.type(guest.getByLabelText(/código da sala/i), createdCode);
    await user.type(guest.getByLabelText(/seu nome/i), 'João Silva');
    await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

    await waitFor(() => {
      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    // Guest starts typing -> Host sees "João Silva está digitando…"
    const guestComposer = guest.getByLabelText(/^mensagem efêmera$/i);
    await user.type(guestComposer, 'Oi');

    await waitFor(() => {
      expect(host.getByText(/joão silva está digitando…/i)).toBeInTheDocument();
    });

    // Guest sends the message -> typing indicator disappears immediately on Host
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(host.getByText('Oi')).toBeInTheDocument();
      expect(host.queryByText(/joão silva está digitando…/i)).not.toBeInTheDocument();
    });

    // Guest types again and stops -> idle timeout clears typing indicator
    await user.type(guestComposer, 'Digitando e parando');
    await waitFor(() => {
      expect(host.getByText(/joão silva está digitando…/i)).toBeInTheDocument();
    });

    await act(async () => {
      vi.advanceTimersByTime(3500);
    });

    await waitFor(() => {
      expect(host.queryByText(/joão silva está digitando…/i)).not.toBeInTheDocument();
    });
  });

  it('handles smart auto-scroll, floating #5B3DF5 scroll-to-latest pill, and message entrance animation', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    const hostView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);
    const guestView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);

    const host = within(hostView.container);
    const guest = within(guestView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    const createdCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();
    await user.type(guest.getByLabelText(/código da sala/i), createdCode);
    await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

    await waitFor(() => {
      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    // Exchange initial messages while at bottom
    await user.type(host.getByLabelText(/^mensagem efêmera$/i), 'Primeira mensagem{enter}');
    await user.type(guest.getByLabelText(/^mensagem efêmera$/i), 'Segunda mensagem{enter}');

    await waitFor(() => {
      expect(host.getByText('Segunda mensagem')).toBeInTheDocument();
    });

    const hostLog = host.getByRole('log', { name: /mensagens efêmeras/i });
    const countHostScrollCalls = () =>
      scrollSpy.mock.contexts.filter((ctx) => ctx instanceof Node && hostLog.contains(ctx)).length;

    expect(countHostScrollCalls()).toBeGreaterThan(0);
    expect(host.queryByRole('button', { name: /ir para a última mensagem efêmera/i })).not.toBeInTheDocument();

    // Verify entrance animation and visual distinction between own and peer messages
    const articles = within(hostLog).getAllByRole('article');
    expect(articles[0].className).toContain('animate-message-in');
    expect(host.getByText('Primeira mensagem').className).toContain('bg-[#EEF0FF]');
    expect(host.getByText('Segunda mensagem').className).toContain('bg-[#F1F3F8]');

    // Simulate Host scrolling up to read older messages
    Object.defineProperty(hostLog, 'scrollHeight', { value: 1200, configurable: true });
    Object.defineProperty(hostLog, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(hostLog, 'scrollTop', { value: 100, writable: true, configurable: true });
    fireEvent.scroll(hostLog);

    const jumpBtn = await host.findByRole('button', { name: /ir para a última mensagem efêmera/i });
    expect(jumpBtn.className).toContain('bg-[#5B3DF5]');

    const scrollCallsBeforeIncoming = countHostScrollCalls();

    // Guest sends a new message while Host is scrolled up -> Host must NOT auto-scroll
    await user.type(guest.getByLabelText(/^mensagem efêmera$/i), 'Nova mensagem enquanto leio{enter}');
    await waitFor(() => {
      expect(host.getByText('Nova mensagem enquanto leio')).toBeInTheDocument();
    });

    expect(countHostScrollCalls()).toBe(scrollCallsBeforeIncoming);
    expect(host.getByRole('button', { name: /ir para a última mensagem efêmera/i })).toBeInTheDocument();

    // Clicking the floating pill scrolls smoothly to bottom and hides the pill
    await user.click(jumpBtn);
    expect(countHostScrollCalls()).toBeGreaterThan(scrollCallsBeforeIncoming);
    expect(host.queryByRole('button', { name: /ir para a última mensagem efêmera/i })).not.toBeInTheDocument();
  });

  it('supports Shift+Enter newlines, accessible emoji picker insertion, and ephemeral attachment notice in MessageComposer', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    const hostView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);
    const guestView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);

    const host = within(hostView.container);
    const guest = within(guestView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    const createdCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();
    await user.type(guest.getByLabelText(/código da sala/i), createdCode);
    await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

    await waitFor(() => {
      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    const hostComposer = host.getByLabelText(/^mensagem efêmera$/i) as HTMLTextAreaElement;

    // Shift+Enter inserts a newline without sending
    await user.type(hostComposer, 'Linha 1{Shift>}{Enter}{/Shift}Linha 2');
    expect(hostComposer.value).toBe('Linha 1\nLinha 2');
    expect(guest.queryByText(/Linha 1/)).not.toBeInTheDocument();

    // Accessible emoji picker inserts emoji into draft
    const emojiButton = host.getByRole('button', { name: /inserir emoji/i });
    await user.click(emojiButton);
    const emojiDialog = host.getByRole('dialog', { name: /inserir emoji/i });
    await user.click(within(emojiDialog).getByRole('button', { name: '😀' }));
    expect(hostComposer.value).toBe('Linha 1\nLinha 2😀');

    // Enter sends the multiline message with emoji
    await user.type(hostComposer, '{enter}');
    await waitFor(() => {
      expect(guest.getByText(/Linha 1/)).toBeInTheDocument();
      expect(guest.getByText(/Linha 2😀/)).toBeInTheDocument();
    });

    // Attachment button shows ephemeral zero-trace notice popover
    const attachButton = host.getByRole('button', {
      name: /anexos indisponíveis no modo efêmero/i,
    });
    await user.click(attachButton);
    expect(
      host.getByText(/arquivos não são armazenados para manter o zero-rastro/i),
    ).toBeInTheDocument();

    // Escape closes the attachment notice
    await user.keyboard('{Escape}');
    expect(
      host.queryByText(/arquivos não são armazenados para manter o zero-rastro/i),
    ).not.toBeInTheDocument();
  });

  it('requires confirmation before leaving, cancels safely, and purges state + URL params on confirm', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    let copiedInviteUrl = '';
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
      copiedInviteUrl = text;
    });

    const hostView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    // Host copies full invite link (with matching #k= secret)
    await user.click(host.getByRole('button', { name: /compartilhar/i }));
    await waitFor(() => {
      expect(copiedInviteUrl).toContain('#k=');
    });
    const parsedUrl = new URL(copiedInviteUrl);

    // Guest joins via browser URL containing ?room= and #k=
    window.history.replaceState(
      null,
      '',
      `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
    );
    const guestView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);
    const guest = within(guestView.container);

    await waitFor(() => {
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    // Exchange a message so volatile state has messages
    await user.type(guest.getByLabelText(/^mensagem efêmera$/i), 'Segredo efêmero{enter}');
    await waitFor(() => {
      expect(guest.getByText('Segredo efêmero')).toBeInTheDocument();
      expect(host.getByText('Segredo efêmero')).toBeInTheDocument();
    });

    // Clicking "Sair da sala" in header opens confirmation dialog instead of leaving immediately
    const guestHeader = guest.getByRole('banner');
    await user.click(within(guestHeader).getByRole('button', { name: /sair da sala/i }));

    const dialog = guest.getByRole('dialog', { name: /sair da sala\?/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/todas as mensagens efêmeras e chaves/i)).toBeInTheDocument();

    // Canceling keeps the guest in the room with messages intact
    await user.click(within(dialog).getByRole('button', { name: /continuar na sala/i }));
    expect(guest.queryByRole('dialog')).not.toBeInTheDocument();
    expect(guest.getByText('Segredo efêmero')).toBeInTheDocument();

    // Trigger leave from sidebar shortcut and confirm
    const guestSidebar = guest.getByLabelText(/barra lateral da sala/i);
    await user.click(within(guestSidebar).getByRole('button', { name: /sair da sala/i }));
    const confirmDialog = guest.getByRole('dialog', { name: /sair da sala\?/i });
    await user.click(within(confirmDialog).getByRole('button', { name: /sair e limpar/i }));

    // Guest returns cleanly to EntryScreen, URL params are wiped, and volatile state is purged
    await waitFor(() => {
      expect(guest.getByRole('heading', { name: /entre ou crie uma sala/i })).toBeInTheDocument();
    });
    expect(guest.queryByText('Segredo efêmero')).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');

    // Host observes Guest departure in real time
    await waitFor(() => {
      expect(host.getByText(/aguardando alguém/i)).toBeInTheDocument();
    });

    // Zero-trace check
    expect(window.localStorage?.length ?? 0).toBe(0);
    expect(window.sessionStorage?.length ?? 0).toBe(0);
    expect(document.cookie).toBe('');
  });
});
