import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { TransportEvent } from './domain/types';
import { App } from './App';
import { InMemoryTransportHub } from './transport/InMemoryTransport';
import type { RoomTransport } from './transport/RoomTransport';

function createObservableTransport(base: RoomTransport) {
  const extraListeners = new Set<(event: TransportEvent) => void>();
  const transport: RoomTransport = {
    createRoom: (p) => base.createRoom(p),
    joinRoom: (p) => base.joinRoom(p),
    leaveRoom: () => base.leaveRoom(),
    sendEncryptedMessage: (e) => base.sendEncryptedMessage(e),
    sendKeyExchange: (k, o) => base.sendKeyExchange(k, o),
    setTyping: (t) => base.setTyping(t),
    sendCallSignal: (s) => base.sendCallSignal(s),
    notifyActivity: () => base.notifyActivity(),
    expireRoom: base.expireRoom ? () => base.expireRoom!() : undefined,
    dispose: () => {
      extraListeners.clear();
      base.dispose();
    },
    subscribe(listener) {
      const unsubBase = base.subscribe(listener);
      extraListeners.add(listener);
      return () => {
        unsubBase();
        extraListeners.delete(listener);
      };
    },
  };

  return {
    transport,
    emitServerEvent(event: TransportEvent) {
      for (const listener of extraListeners) {
        listener(event);
      }
    },
  };
}

describe('PULSO Security UI error handling (rate_limited, server_at_capacity, payload_too_large)', () => {
  it('displays localized rate_limited and server_at_capacity alerts on EntryScreen across locales', async () => {
    const hub = new InMemoryTransportHub();
    const { transport, emitServerEvent } = createObservableTransport(hub.createTransport());

    render(<App transport={transport} initialLocale="en" />);

    act(() => {
      emitServerEvent({ type: 'room_error', code: 'server_at_capacity' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/capacity limit/i);

    act(() => {
      emitServerEvent({ type: 'room_error', code: 'rate_limited' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('shows a dismissible localized alert in RoomScreen for payload_too_large and rate_limited without wiping the active room', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const hostObservable = createObservableTransport(hub.createTransport());

    render(<App transport={hostObservable.transport} initialLocale="pt-br" />);

    await user.click(screen.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(screen.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    // Server emits payload_too_large while participant is active inside room
    act(() => {
      hostObservable.emitServerEvent({ type: 'room_error', code: 'payload_too_large' });
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/64 KB/i);
    // Room stays intact (did not wipe back to EntryScreen)
    expect(screen.getByText(/sua sala foi criada!/i)).toBeInTheDocument();

    // User can dismiss the alert cleanly
    const dismissButton = screen.getByRole('button', { name: /fechar aviso|dispensar/i });
    await user.click(dismissButton);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Non-fatal rate_limited inside room also renders without wiping the room
    act(() => {
      hostObservable.emitServerEvent({ type: 'room_error', code: 'rate_limited' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/muitas tentativas/i);
    expect(screen.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
  });
});
