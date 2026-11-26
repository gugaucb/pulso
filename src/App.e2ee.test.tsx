import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { EncryptedEnvelope } from './domain/types';
import { InMemoryTransportHub } from './transport/InMemoryTransport';
import type { RoomTransport } from './transport/RoomTransport';

const ROOM_CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const SAS_FORMAT_REGEX = /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

function spyTransport(inner: RoomTransport) {
  const sentEnvelopes: EncryptedEnvelope[] = [];
  const keyExchanges: Array<{ publicKeyJwk: JsonWebKey; options?: unknown }> = [];

  const wrapped: RoomTransport = {
    createRoom: (params) => inner.createRoom(params),
    joinRoom: (params) => inner.joinRoom(params),
    leaveRoom: () => inner.leaveRoom(),
    expireRoom: () => (inner.expireRoom ? inner.expireRoom() : inner.leaveRoom()),
    sendEncryptedMessage: (envelope) => {
      sentEnvelopes.push(envelope);
      return inner.sendEncryptedMessage(envelope);
    },
    sendKeyExchange: (publicKeyJwk, options?: { hasSecret?: boolean }) => {
      keyExchanges.push({ publicKeyJwk, options });
      return inner.sendKeyExchange(publicKeyJwk, options);
    },
    setTyping: (isTyping) => inner.setTyping(isTyping),
    sendCallSignal: (signal) => inner.sendCallSignal(signal),
    notifyActivity: () => inner.notifyActivity(),
    subscribe: (listener) => inner.subscribe(listener),
    dispose: () => inner.dispose(),
  };

  return { wrapped, sentEnvelopes, keyExchanges };
}

describe('PULSO App E2EE and SAS integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encrypts messages before RoomTransport (no plaintext on wire), displays matching SAS in modal, and leaves zero storage traces', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const hostSpy = spyTransport(hub.createTransport());
    const guestSpy = spyTransport(hub.createTransport());
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    let copiedInviteUrl = '';
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
      copiedInviteUrl = text;
    });

    const hostView = render(<App transport={hostSpy.wrapped} initialLocale="pt-br" />);
    const host = within(hostView.container);

    // Host creates a room
    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    // Host opens SAS modal while solo -> shows waiting state
    await user.click(host.getByRole('button', { name: /cifrado ponta a ponta/i }));
    const waitingDialog = host.getByRole('dialog');
    expect(waitingDialog).toHaveTextContent(/verificação mútua/i);
    expect(waitingDialog).toHaveTextContent(/aguardando/i);
    await user.click(within(waitingDialog).getByRole('button', { name: /fechar/i }));

    // Host copies full invite link (which contains #k=...)
    await user.click(host.getByRole('button', { name: /compartilhar/i }));
    await waitFor(() => {
      expect(copiedInviteUrl).toContain('#k=');
    });
    const secretFragment = new URL(copiedInviteUrl).hash.replace(/^#k=/, '');

    // Guest joins using the invite URL containing #k
    const guestView = render(
      <App
        transport={guestSpy.wrapped}
        initialUrl={copiedInviteUrl}
        initialLocale="pt-br"
      />,
    );
    const guest = within(guestView.container);

    await waitFor(() => {
      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    // Neither key_exchange nor encrypted_message ever leaks #k
    await waitFor(() => {
      expect(hostSpy.keyExchanges.length).toBeGreaterThan(0);
      expect(guestSpy.keyExchanges.length).toBeGreaterThan(0);
    });
    expect(JSON.stringify(hostSpy.keyExchanges)).not.toContain(secretFragment);
    expect(JSON.stringify(guestSpy.keyExchanges)).not.toContain(secretFragment);

    // Host sends a sensitive plaintext message
    const secretMessage = 'Encontro secreto às 22h no ponto B';
    await user.type(host.getByLabelText(/^mensagem efêmera$/i), `${secretMessage}{enter}`);

    await waitFor(() => {
      expect(guest.getByText(secretMessage)).toBeInTheDocument();
    });

    // RoomTransport saw ONLY opaque ciphertext, never the plaintext
    expect(hostSpy.sentEnvelopes).toHaveLength(1);
    const wireEnvelope = hostSpy.sentEnvelopes[0];
    expect(JSON.stringify(wireEnvelope)).not.toContain(secretMessage);
    expect(atob(wireEnvelope.ciphertext)).not.toContain('Encontro');

    // Guest replies and Host decrypts
    const replyMessage = 'Confirmado, sem rastros!';
    await user.type(guest.getByLabelText(/^mensagem efêmera$/i), `${replyMessage}{enter}`);

    await waitFor(() => {
      expect(host.getByText(replyMessage)).toBeInTheDocument();
    });
    expect(guestSpy.sentEnvelopes).toHaveLength(1);
    expect(JSON.stringify(guestSpy.sentEnvelopes[0])).not.toContain(replyMessage);

    // Both Host and Guest open SasVerificationModal and see IDENTICAL deterministic SAS
    await user.click(host.getByRole('button', { name: /cifrado ponta a ponta/i }));
    const hostDialog = host.getByRole('dialog');
    const hostSasEl = await within(hostDialog).findByText(SAS_FORMAT_REGEX);
    const hostSas = hostSasEl.textContent!.trim();
    expect(hostDialog).toHaveTextContent(/#k/i);

    await user.click(guest.getByRole('button', { name: /cifrado ponta a ponta/i }));
    const guestDialog = guest.getByRole('dialog');
    const guestSasEl = await within(guestDialog).findByText(SAS_FORMAT_REGEX);
    const guestSas = guestSasEl.textContent!.trim();

    expect(hostSas).toBe(guestSas);

    // Zero-trace check
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage?.length ?? 0).toBe(0);
    expect(window.sessionStorage?.length ?? 0).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('rejects decryption and shows divergent SAS when Guest joins with a mismatched #k secret', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    const hostView = render(<App transport={hub.createTransport()} initialLocale="en" />);
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /create new room/i }));
    await waitFor(() => {
      expect(host.getByText(/your room has been created!/i)).toBeInTheDocument();
    });

    const createdCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();
    const wrongUrl = `https://pulso.example/?room=${createdCode}#k=WRONG_SECRET_DOES_NOT_MATCH_HOST`;

    const guestView = render(
      <App
        transport={hub.createTransport()}
        initialUrl={wrongUrl}
        initialLocale="en"
      />,
    );
    const guest = within(guestView.container);

    await waitFor(() => {
      expect(host.getAllByText(/2 people online/i).length).toBeGreaterThan(0);
      expect(guest.getAllByText(/2 people online/i).length).toBeGreaterThan(0);
    });

    // Both open SAS modal -> codes MUST NOT match
    await user.click(host.getByRole('button', { name: /end-to-end encrypted/i }));
    const hostSas = (await within(host.getByRole('dialog')).findByText(SAS_FORMAT_REGEX)).textContent!.trim();
    await user.click(within(host.getByRole('dialog')).getByRole('button', { name: /close/i }));

    await user.click(guest.getByRole('button', { name: /end-to-end encrypted/i }));
    const guestSas = (await within(guest.getByRole('dialog')).findByText(SAS_FORMAT_REGEX)).textContent!.trim();
    await user.click(within(guest.getByRole('dialog')).getByRole('button', { name: /close/i }));

    expect(hostSas).not.toBe(guestSas);

    // Message sent by Host cannot be decrypted by Guest with mismatched #k
    await user.type(host.getByLabelText(/ephemeral message/i), 'Cannot be read by wrong #k{enter}');
    await waitFor(() => {
      expect(host.getByText('Cannot be read by wrong #k')).toBeInTheDocument();
    });

    // Give async decryption a tick and assert Guest still never sees the plaintext
    await new Promise((r) => setTimeout(r, 30));
    expect(guest.queryByText('Cannot be read by wrong #k')).not.toBeInTheDocument();
  });

  it('supports manual room code entry (without #k) with matching SAS verification via sidebar button and drops replayed envelopes', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const hostSpy = spyTransport(hub.createTransport());
    const guestTransport = hub.createTransport();

    const hostView = render(<App transport={hostSpy.wrapped} initialLocale="pt-br" />);
    const guestView = render(<App transport={guestTransport} initialLocale="pt-br" />);
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
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    // Open SAS via sidebar button on both sides -> matching SAS + manual mode hint
    await user.click(host.getByRole('button', { name: /verificar código sas/i }));
    const hostDialog = host.getByRole('dialog');
    const hostSas = (await within(hostDialog).findByText(SAS_FORMAT_REGEX)).textContent!.trim();
    expect(hostDialog).toHaveTextContent(/apenas por código da sala/i);
    await user.click(within(hostDialog).getByRole('button', { name: /fechar/i }));

    await user.click(guest.getByRole('button', { name: /verificar código sas/i }));
    const guestDialog = guest.getByRole('dialog');
    const guestSas = (await within(guestDialog).findByText(SAS_FORMAT_REGEX)).textContent!.trim();
    expect(hostSas).toBe(guestSas);
    await user.click(within(guestDialog).getByRole('button', { name: /fechar/i }));

    // Exchange message and verify replay on transport is dropped by Guest
    await user.type(host.getByLabelText(/^mensagem efêmera$/i), 'Mensagem única{enter}');
    await waitFor(() => {
      expect(guest.getByText('Mensagem única')).toBeInTheDocument();
    });

    expect(hostSpy.sentEnvelopes).toHaveLength(1);
    await hostSpy.wrapped.sendEncryptedMessage(hostSpy.sentEnvelopes[0]);
    await new Promise((r) => setTimeout(r, 30));

    // Still rendered only once (replay dropped)
    expect(guest.getAllByText('Mensagem única')).toHaveLength(1);
  });

  it('queues messages sent by Host while waiting without locking composer and delivers them encrypted once Guest joins', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const hostSpy = spyTransport(hub.createTransport());
    const guestSpy = spyTransport(hub.createTransport());

    const hostView = render(<App transport={hostSpy.wrapped} initialLocale="pt-br" />);
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    const createdCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();
    const hostComposer = host.getByLabelText(/^mensagem efêmera$/i) as HTMLTextAreaElement;

    // Host sends two messages while still waiting (before Guest joins)
    await user.type(hostComposer, 'Mensagem 1 enquanto aguarda{enter}');
    expect(host.getByText('Mensagem 1 enquanto aguarda')).toBeInTheDocument();
    expect(hostComposer.value).toBe('');

    // Composer is NOT locked: Host can immediately type and send a second message
    await user.type(hostComposer, 'Mensagem 2 enquanto aguarda{enter}');
    expect(host.getByText('Mensagem 2 enquanto aguarda')).toBeInTheDocument();
    expect(hostComposer.value).toBe('');

    // Nothing leaked over transport before Guest joined
    expect(hostSpy.sentEnvelopes).toHaveLength(0);

    // Now Guest joins with the Room Code
    const guestView = render(<App transport={guestSpy.wrapped} initialLocale="pt-br" />);
    const guest = within(guestView.container);

    await user.type(guest.getByLabelText(/código da sala/i), createdCode);
    await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

    // Once E2EE handshake completes, Guest receives and decrypts both queued messages
    await waitFor(() => {
      expect(guest.getByText('Mensagem 1 enquanto aguarda')).toBeInTheDocument();
      expect(guest.getByText('Mensagem 2 enquanto aguarda')).toBeInTheDocument();
    });

    expect(hostSpy.sentEnvelopes).toHaveLength(2);
    expect(JSON.stringify(hostSpy.sentEnvelopes)).not.toContain('Mensagem 1 enquanto aguarda');
    expect(JSON.stringify(hostSpy.sentEnvelopes)).not.toContain('Mensagem 2 enquanto aguarda');
  });

  it('clears queued waiting messages when Host leaves room before Guest joins', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const hostSpy = spyTransport(hub.createTransport());

    const hostView = render(<App transport={hostSpy.wrapped} initialLocale="pt-br" />);
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    await user.type(host.getByLabelText(/^mensagem efêmera$/i), 'Rascunho descartado{enter}');
    expect(host.getByText('Rascunho descartado')).toBeInTheDocument();

    // Host leaves before Guest joins
    await user.click(within(host.getByRole('banner')).getByRole('button', { name: /sair da sala/i }));
    await user.click(
      within(host.getByRole('dialog', { name: /sair da sala\?/i })).getByRole('button', {
        name: /sair e limpar/i,
      }),
    );

    await waitFor(() => {
      expect(host.getByRole('heading', { name: /entre ou crie uma sala/i })).toBeInTheDocument();
    });

    // Host creates a new room and Guest joins -> discarded message from previous room is NOT sent
    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    const newCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();
    const guestView = render(<App transport={hub.createTransport()} initialLocale="pt-br" />);
    const guest = within(guestView.container);

    await user.type(guest.getByLabelText(/código da sala/i), newCode);
    await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

    await waitFor(() => {
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(hostSpy.sentEnvelopes).toHaveLength(0);
    expect(guest.queryByText('Rascunho descartado')).not.toBeInTheDocument();
  });
});
