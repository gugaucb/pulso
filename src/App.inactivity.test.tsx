import { act, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { FakeMediaPort } from './media/FakeMediaPort';
import { InMemoryTransportHub } from './transport/InMemoryTransport';

const ROOM_CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

describe('PULSO Ticket 05: Inactivity timer and irreversible purge', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', '/');
    }
  });

  it('displays "Expira em 1h" initially with font-mono-tabular in sidebar and header, then counts down in MM:SS', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const hub = new InMemoryTransportHub();

    const hostView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    const sidebar = host.getByLabelText(/barra lateral da sala/i);
    const header = host.getByRole('banner');

    // Initial full-hour display in both sidebar ("Sobre a sala") and mobile-visible header
    const sidebarTimer = within(sidebar).getByText(/expira em 1h/i);
    const headerTimer = within(header).getByText(/expira em 1h/i);
    expect(sidebarTimer).toBeInTheDocument();
    expect(headerTimer).toBeInTheDocument();
    expect(sidebarTimer.closest('.font-mono-tabular') ?? sidebarTimer).toHaveClass('font-mono-tabular');
    expect(headerTimer.closest('.font-mono-tabular') ?? headerTimer).toHaveClass('font-mono-tabular');

    // Advance 1 second -> transitions below 1h to tabular 59:59
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(within(sidebar).getByText(/expira em 59:59/i)).toBeInTheDocument();
    expect(within(header).getByText(/expira em 59:59/i)).toBeInTheDocument();

    // Advance 4 minutes -> 55:59
    await act(async () => {
      vi.advanceTimersByTime(4 * 60 * 1000);
    });

    expect(within(sidebar).getByText(/expira em 55:59/i)).toBeInTheDocument();
    expect(within(header).getByText(/expira em 55:59/i)).toBeInTheDocument();
  });

  it('resets countdown synchronously across Host and Guest on Ephemeral Message exchange and manual presence confirmation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    // Advance 10 minutes -> both Host and Guest show ~50:00
    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(within(host.getByLabelText(/barra lateral da sala/i)).getByText(/expira em 49:|expira em 50:/i)).toBeInTheDocument();
    expect(within(guest.getByLabelText(/barra lateral da sala/i)).getByText(/expira em 49:|expira em 50:/i)).toBeInTheDocument();

    // Host sends an Ephemeral Message -> resets timer on BOTH Host and Guest back to 1h
    await user.type(host.getByLabelText(/^mensagem efêmera$/i), 'Olá!{enter}');
    await waitFor(() => {
      expect(guest.getByText('Olá!')).toBeInTheDocument();
    });

    expect(within(host.getByLabelText(/barra lateral da sala/i)).getByText(/expira em 1h/i)).toBeInTheDocument();
    expect(within(guest.getByLabelText(/barra lateral da sala/i)).getByText(/expira em 1h/i)).toBeInTheDocument();

    // Advance 25 minutes -> both drop below 36m
    await act(async () => {
      vi.advanceTimersByTime(25 * 60 * 1000);
    });
    expect(within(host.getByRole('banner')).getByText(/expira em 34:|expira em 35:/i)).toBeInTheDocument();
    expect(within(guest.getByRole('banner')).getByText(/expira em 34:|expira em 35:/i)).toBeInTheDocument();

    // Guest sends an Ephemeral Message -> resets BOTH back to 1h
    await user.type(guest.getByLabelText(/^mensagem efêmera$/i), 'Recebido!{enter}');
    await waitFor(() => {
      expect(host.getByText('Recebido!')).toBeInTheDocument();
    });
    expect(within(host.getByRole('banner')).getByText(/expira em 1h/i)).toBeInTheDocument();
    expect(within(guest.getByRole('banner')).getByText(/expira em 1h/i)).toBeInTheDocument();

    // Advance 15 minutes, then Guest clicks manual presence confirmation in sidebar -> resets BOTH back to 1h
    await act(async () => {
      vi.advanceTimersByTime(15 * 60 * 1000);
    });
    expect(within(host.getByRole('banner')).getByText(/expira em 44:|expira em 45:/i)).toBeInTheDocument();

    const guestSidebar = guest.getByLabelText(/barra lateral da sala/i);
    await user.click(within(guestSidebar).getByRole('button', { name: /confirmar presença/i }));

    await waitFor(() => {
      expect(within(host.getByRole('banner')).getByText(/expira em 1h/i)).toBeInTheDocument();
      expect(within(guest.getByRole('banner')).getByText(/expira em 1h/i)).toBeInTheDocument();
    });
  });

  it('shows progressive amber (< 5 min) and red (< 1 min) alerts with quick renew button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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

    // At exactly 55m elapsed (< 5m threshold not crossed yet at 05:00): still normal, no banner
    await act(async () => {
      vi.advanceTimersByTime(55 * 60 * 1000);
    });
    expect(host.queryByText(/autodestruída em breve/i)).not.toBeInTheDocument();

    // Advance 2s -> 04:58 (< 5 min) -> amber warning state on both Host and Guest
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    const hostWarningBanner = host.getByRole('status');
    expect(hostWarningBanner).toHaveAttribute('data-inactivity-banner', 'warning');
    expect(hostWarningBanner).toHaveTextContent(/autodestruída em breve/i);
    expect(
      within(host.getByRole('banner')).getByText(/expira em 04:/i).closest('[data-inactivity-level]'),
    ).toHaveAttribute('data-inactivity-level', 'warning');
    expect(guest.getByRole('status')).toHaveAttribute('data-inactivity-banner', 'warning');

    // Advance 4m 1s -> 00:57 (< 1 min) -> red critical state
    await act(async () => {
      vi.advanceTimersByTime(4 * 60 * 1000 + 1000);
    });

    const hostCriticalBanner = host.getByRole('alert');
    expect(hostCriticalBanner).toHaveAttribute('data-inactivity-banner', 'critical');
    expect(hostCriticalBanner).toHaveTextContent(/menos de 1 minuto/i);
    expect(
      within(host.getByRole('banner')).getByText(/expira em 00:/i).closest('[data-inactivity-level]'),
    ).toHaveAttribute('data-inactivity-level', 'critical');
    expect(guest.getByRole('alert')).toHaveAttribute('data-inactivity-banner', 'critical');

    // Clicking quick renew button in critical banner resets both Host and Guest back to normal 1h
    await user.click(within(hostCriticalBanner).getByRole('button', { name: /renovar contador/i }));

    await waitFor(() => {
      expect(host.queryByRole('alert')).not.toBeInTheDocument();
      expect(guest.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(within(host.getByRole('banner')).getByText(/expira em 1h/i)).toBeInTheDocument();
    expect(within(guest.getByRole('banner')).getByText(/expira em 1h/i)).toBeInTheDocument();
  });

  it('keeps the inactivity timer alive while a Video Call is active and resumes countdown after call ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const hub = new InMemoryTransportHub();
    const hostMedia = new FakeMediaPort();

    const hostView = render(
      <App transport={hub.createTransport()} mediaPort={hostMedia} initialLocale="pt-br" />,
    );
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    // Advance 50 minutes before starting call
    await act(async () => {
      vi.advanceTimersByTime(50 * 60 * 1000);
    });
    expect(within(host.getByRole('banner')).getByText(/expira em 09:|expira em 10:/i)).toBeInTheDocument();

    // Start Video Call (preview -> confirm)
    await user.click(host.getByRole('button', { name: /iniciar chamada de vídeo/i }));
    const previewDialog = await host.findByRole('dialog', {
      name: /pré-visualização antes da chamada/i,
    });
    await user.click(within(previewDialog).getByRole('button', { name: /entrar com vídeo/i }));

    await waitFor(() => {
      expect(host.getByText(/você com câmera ligada/i)).toBeInTheDocument();
    });

    // Advance 65 minutes while call is active -> heartbeat keeps room alive!
    await act(async () => {
      vi.advanceTimersByTime(65 * 60 * 1000);
    });

    expect(host.queryByRole('heading', { name: /sala encerrada/i })).not.toBeInTheDocument();
    expect(host.getByText(/você com câmera ligada/i)).toBeInTheDocument();

    // End video call, then advance 60 minutes -> room expires now
    await user.click(host.getByRole('button', { name: /encerrar chamada/i }));
    await waitFor(() => {
      expect(host.queryByText(/você com câmera ligada/i)).not.toBeInTheDocument();
    });
    expect(hostMedia.getSnapshot().phase).toBe('idle');

    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    await waitFor(() => {
      expect(host.getByRole('heading', { name: /sala encerrada/i })).toBeInTheDocument();
    });
  });

  it('irreversibly purges messages, URL params, crypto state, and shows ExpiredRoomScreen on both tabs at 00:00', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const hub = new InMemoryTransportHub();

    let copiedInviteUrl = '';
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
      copiedInviteUrl = text;
    });

    const hostMedia = new FakeMediaPort();
    const guestMedia = new FakeMediaPort();

    const hostView = render(
      <App transport={hub.createTransport()} mediaPort={hostMedia} initialLocale="pt-br" />,
    );
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    await user.click(host.getByRole('button', { name: /compartilhar/i }));
    await waitFor(() => {
      expect(copiedInviteUrl).toContain('#k=');
    });
    const parsedUrl = new URL(copiedInviteUrl);
    const createdCode = parsedUrl.searchParams.get('room')!;

    window.history.replaceState(
      null,
      '',
      `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
    );

    const guestView = render(
      <App transport={hub.createTransport()} mediaPort={guestMedia} initialLocale="pt-br" />,
    );
    const guest = within(guestView.container);

    await waitFor(() => {
      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    // Exchange sensitive Ephemeral Messages
    await user.type(host.getByLabelText(/^mensagem efêmera$/i), 'Segredo confidencial 1{enter}');
    await user.type(guest.getByLabelText(/^mensagem efêmera$/i), 'Resposta confidencial 2{enter}');

    await waitFor(() => {
      expect(host.getByText('Resposta confidencial 2')).toBeInTheDocument();
      expect(guest.getByText('Segredo confidencial 1')).toBeInTheDocument();
    });

    // Advance full 60 minutes without activity -> 00:00 triggers immediate destruction & purge
    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    await waitFor(() => {
      expect(host.getByRole('heading', { name: /sala encerrada/i })).toBeInTheDocument();
      expect(guest.getByRole('heading', { name: /sala encerrada/i })).toBeInTheDocument();
    });

    // Both tabs show purge notice and ZERO ephemeral messages remain in DOM
    expect(host.getByText(/contador de inatividade zerou/i)).toBeInTheDocument();
    expect(guest.getByText(/contador de inatividade zerou/i)).toBeInTheDocument();
    expect(host.queryByText('Segredo confidencial 1')).not.toBeInTheDocument();
    expect(host.queryByText('Resposta confidencial 2')).not.toBeInTheDocument();
    expect(guest.queryByText('Segredo confidencial 1')).not.toBeInTheDocument();
    expect(guest.queryByText('Resposta confidencial 2')).not.toBeInTheDocument();

    // URL params (?room= and #k=) are wiped
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');

    // Clicking "Voltar ao início" returns cleanly to EntryScreen
    await user.click(host.getByRole('button', { name: /voltar ao início/i }));
    expect(host.getByRole('heading', { name: /entre ou crie uma sala/i })).toBeInTheDocument();

    // Re-joining the destroyed room code is rejected
    await user.type(host.getByLabelText(/código da sala/i), createdCode);
    await user.click(host.getByRole('button', { name: /entrar na sala/i }));
    await waitFor(() => {
      expect(host.getByRole('alert')).toHaveTextContent(/não encontrada/i);
    });

    // Zero-trace check
    expect(window.localStorage?.length ?? 0).toBe(0);
    expect(window.sessionStorage?.length ?? 0).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('respects custom inactivityDurationMs prop and localizes ExpiredRoomScreen in English', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const hub = new InMemoryTransportHub();

    const hostView = render(
      <App
        transport={hub.createTransport()}
        inactivityDurationMs={6 * 60 * 1000}
        initialLocale="en"
      />,
    );
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /create new room/i }));
    await waitFor(() => {
      expect(host.getByText(/your room has been created!/i)).toBeInTheDocument();
    });

    const header = host.getByRole('banner');
    expect(within(header).getByText(/expires in 06:00/i)).toBeInTheDocument();

    // Advance 6 minutes -> expires and shows localized ExpiredRoomScreen
    await act(async () => {
      vi.advanceTimersByTime(6 * 60 * 1000);
    });

    await waitFor(() => {
      expect(host.getByRole('heading', { name: /room closed/i })).toBeInTheDocument();
    });
    expect(host.getByText(/inactivity timer reached zero/i)).toBeInTheDocument();
    expect(host.getByRole('button', { name: /back to start/i })).toBeInTheDocument();
  });

  it('transitions both Host and Guest symmetrically to ExpiredRoomScreen even if Guest timer fires first', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(1_700_000_000_000);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const hub = new InMemoryTransportHub();

    const hostView = render(
      <App
        transport={hub.createTransport()}
        inactivityDurationMs={60_000}
        initialLocale="pt-br"
      />,
    );
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    const createdCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();
    const realNow = Date.now.bind(Date);
    const hostStart = realNow();

    // Advance 300ms, then simulate Guest clock +2500ms ahead when Guest joins
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 2500);

    const guestView = render(
      <App
        transport={hub.createTransport()}
        inactivityDurationMs={60_000}
        initialLocale="pt-br"
      />,
    );
    const guest = within(guestView.container);

    await user.type(guest.getByLabelText(/código da sala/i), createdCode);
    await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

    await waitFor(() => {
      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    // Advance to hostStart + 57.4s (Host's last tick at +57.0s saw +59.5s < 60s; Guest's expireTimeout is at +57.5s)
    const to57400 = hostStart + 57_400 - realNow();
    await act(async () => {
      vi.advanceTimersByTime(to57400);
    });
    expect(guest.queryByRole('heading', { name: /sala encerrada/i })).not.toBeInTheDocument();
    expect(host.queryByRole('heading', { name: /sala encerrada/i })).not.toBeInTheDocument();

    // Advance 200ms to hostStart + 57.6s -> Guest's expireTimeout fires (Host's next tick isn't until +58.0s)
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(guest.getByRole('heading', { name: /sala encerrada/i })).toBeInTheDocument();
    expect(host.getByRole('heading', { name: /sala encerrada/i })).toBeInTheDocument();
  });
});
