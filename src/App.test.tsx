import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { isValidRoomCode } from './domain/roomCode';
import { InMemoryTransportHub } from './transport/InMemoryTransport';

const ROOM_CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

describe('PULSO App integration', () => {
  it('renders the entry screen and lets Host create a 1:1 room with celebratory code card', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const hostTransport = hub.createTransport();

    render(<App transport={hostTransport} initialLocale="pt-br" />);

    expect(screen.getByText('PULSO')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /entre ou crie uma sala/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/código da sala/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/seu nome/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /entrar na sala/i })).toBeInTheDocument();
    expect(screen.getByText('ou')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /criar nova sala/i }));

    await waitFor(() => {
      expect(screen.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    const codeBadges = screen.getAllByText(ROOM_CODE_REGEX);
    expect(codeBadges.length).toBeGreaterThan(0);
    const createdCode = codeBadges[0].textContent?.trim() ?? '';
    expect(isValidRoomCode(createdCode)).toBe(true);

    const copyCodeButton = screen.getByRole('button', { name: /^copiar código$/i });
    expect(copyCodeButton).toBeInTheDocument();
    const shareButton = screen.getByRole('button', { name: /compartilhar/i });
    expect(shareButton).toBeInTheDocument();
    expect(screen.getAllByText(/expira em 1h/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/aguardando alguém/i)).toBeInTheDocument();

    await user.click(copyCodeButton);
    expect(screen.getByRole('button', { name: /código copiado!/i })).toBeInTheDocument();

    await user.click(shareButton);
    expect(screen.getAllByRole('button', { name: /link copiado!/i }).length).toBeGreaterThan(0);
  });

  it('connects Host and Guest, exchanges ephemeral messages bidirectionally, and blocks a 3rd intruder', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    const hostView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);
    const guestView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);
    const intruderView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);

    const host = within(hostView.container);
    const guest = within(guestView.container);
    const intruder = within(intruderView.container);

    // Host enters custom name and creates a room
    await user.type(host.getByLabelText(/seu nome/i), 'Ana');
    await user.click(host.getByRole('button', { name: /criar nova sala/i }));

    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    const createdCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();

    // Guest types lowercase code without hyphen and joins with custom name
    const guestCodeInput = guest.getByLabelText(/código da sala/i) as HTMLInputElement;
    await user.type(guestCodeInput, createdCode.replace('-', '').toLowerCase());
    expect(guestCodeInput.value).toBe(createdCode);

    await user.type(guest.getByLabelText(/seu nome/i), 'João Silva');
    await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

    // Both Host and Guest see 2 people online
    await waitFor(() => {
      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    // Host sends a message via Enter
    const hostComposer = host.getByLabelText(/mensagem efêmera/i);
    await user.type(hostComposer, 'Oi! Tudo certo por aqui?{enter}');

    await waitFor(() => {
      expect(host.getByText('Oi! Tudo certo por aqui?')).toBeInTheDocument();
      expect(guest.getByText('Oi! Tudo certo por aqui?')).toBeInTheDocument();
    });

    // Guest replies via send button
    const guestComposer = guest.getByLabelText(/mensagem efêmera/i);
    await user.type(guestComposer, 'Perfeito! Vamos conversar.');
    await user.click(guest.getByRole('button', { name: /enviar mensagem/i }));

    await waitFor(() => {
      expect(host.getByText('Perfeito! Vamos conversar.')).toBeInTheDocument();
      expect(guest.getByText('Perfeito! Vamos conversar.')).toBeInTheDocument();
    });

    // Verify initials avatar & sender labels are visible
    expect(host.getAllByText('JS').length).toBeGreaterThan(0);
    expect(guest.getAllByText('Ana').length).toBeGreaterThan(0);

    // 3rd intruder tries to join the occupied 1:1 room
    await user.type(intruder.getByLabelText(/código da sala/i), createdCode);
    await user.click(intruder.getByRole('button', { name: /entrar na sala/i }));

    await waitFor(() => {
      expect(intruder.getByRole('alert')).toHaveTextContent(/já está ocupada por 2 participantes/i);
    });

    // Intruder must not see any messages or participant names
    expect(intruder.queryByText('Oi! Tudo certo por aqui?')).not.toBeInTheDocument();
    expect(intruder.queryByText('Perfeito! Vamos conversar.')).not.toBeInTheDocument();
    expect(intruder.queryByText('João Silva')).not.toBeInTheDocument();

    // Zero-trace check
    expect(window.localStorage?.length ?? 0).toBe(0);
    expect(window.sessionStorage?.length ?? 0).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('auto-joins a Guest directly from a shared invite link URL', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    const hostView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    const createdCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();
    const guestView = render(
      <App
        transport={hub.createTransport()}
        initialUrl={`https://pulso.example/?room=${createdCode}#k=secret256`}
        initialLocale="pt-br"
      />,
    );
    const guest = within(guestView.container);

    await waitFor(() => {
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });
  });

  it('shows clear errors for malformed codes and non-existent rooms', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    render(<App transport={hub.createTransport()} initialLocale="pt-br" />);

    const codeInput = screen.getByLabelText(/código da sala/i);
    await user.type(codeInput, 'ABC');
    await user.click(screen.getByRole('button', { name: /entrar na sala/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/código da sala inválido/i);

    await user.clear(codeInput);
    await user.type(codeInput, 'A7K9-M2P4');
    await user.click(screen.getByRole('button', { name: /entrar na sala/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não encontrada/i);
    });
  });
});
