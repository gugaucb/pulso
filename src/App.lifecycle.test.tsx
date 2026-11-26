import { act, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientWsMessage, ServerWsMessage } from '../shared/protocol';
import { ManualClock } from '../server/clock';
import { RoomStore, type ClientSession } from '../server/roomStore';
import { App } from './App';
import { WebSocketTransport, type WebSocketLike } from './transport/WebSocketTransport';

const ROOM_CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

function createRoomStoreWsBridge(store: RoomStore) {
  const sockets: BridgeSocket[] = [];

  class BridgeSocket implements WebSocketLike {
    readyState = 0; // CONNECTING
    private listeners = new Map<string, Set<(event?: unknown) => void>>();
    private readonly clientSession: ClientSession;

    constructor() {
      this.clientSession = {
        send: (msg: ServerWsMessage) => {
          if (this.readyState !== 1) return;
          this.dispatch('message', { data: JSON.stringify(msg) });
        },
        close: () => {
          if (this.readyState === 3) return;
          this.readyState = 3;
          this.dispatch('close');
        },
      };
      queueMicrotask(() => {
        if (this.readyState === 0) {
          this.readyState = 1;
          this.dispatch('open');
        }
      });
    }

    addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
    addEventListener(
      type: 'message',
      listener: (event: { data: unknown }) => void,
    ): void;
    addEventListener(type: string, listener: (event: never) => void): void {
      const set = this.listeners.get(type) ?? new Set();
      set.add(listener as (event?: unknown) => void);
      this.listeners.set(type, set);
    }

    removeEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
    removeEventListener(
      type: 'message',
      listener: (event: { data: unknown }) => void,
    ): void;
    removeEventListener(type: string, listener: (event: never) => void): void {
      this.listeners.get(type)?.delete(listener as (event?: unknown) => void);
    }

    send(data: string): void {
      if (this.readyState !== 1) return;
      const parsed = JSON.parse(data) as ClientWsMessage;
      store.handleMessage(this.clientSession, parsed);
    }

    close(): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      store.handleDisconnect(this.clientSession);
      this.dispatch('close');
    }

    dropAbruptly(): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      store.handleDisconnect(this.clientSession);
      this.dispatch('error');
      this.dispatch('close');
    }

    private dispatch(type: string, event?: unknown): void {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  return {
    sockets,
    createTransport: () =>
      new WebSocketTransport({
        url: 'ws://pulso.test/ws',
        reconnectWindowMs: 30_000,
        reconnectBackoffBaseMs: 200,
        webSocketFactory: () => {
          const ws = new BridgeSocket();
          sockets.push(ws);
          return ws;
        },
      }),
  };
}

describe('PULSO Ticket 02 UI & Session lifecycle with WebSocketTransport', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not self-expire before server authority and renders localized hard_ttl reason on ExpiredRoomScreen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(1_700_000_000_000);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const clock = new ManualClock(1_700_000_000_000);
    const store = new RoomStore(clock, {
      inactivityDurationMs: 60_000,
      hardTtlMs: 90_000,
    });
    const hostBridge = createRoomStoreWsBridge(store);

    const hostView = render(
      <App
        transport={hostBridge.createTransport()}
        inactivityDurationMs={60_000}
        initialLocale="en"
      />,
    );
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /create new room/i }));
    await waitFor(() => {
      expect(host.getByText(/your room has been created!/i)).toBeInTheDocument();
    });

    // Advance client clock past 60s without advancing server ManualClock -> client must NOT self-expire
    await act(async () => {
      vi.advanceTimersByTime(65_000);
    });
    expect(host.queryByRole('heading', { name: /room closed/i })).not.toBeInTheDocument();
    expect(within(host.getByRole('banner')).getByText(/expires in 00:00/i)).toBeInTheDocument();

    // Advance server clock to 45s -> renew -> advance to 90s hard TTL
    clock.advanceBy(45_000);
    await user.click(host.getByRole('button', { name: /confirm presence/i }));
    await act(async () => {
      clock.advanceBy(45_000);
    });

    await waitFor(() => {
      expect(host.getByRole('heading', { name: /room closed/i })).toBeInTheDocument();
    });
    expect(host.getByText(/24-hour maximum lifetime/i)).toBeInTheDocument();
  });

  it('preserves E2EE session, SAS code, and messages across a silent 30s reconnect', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const clock = new ManualClock(1_700_000_000_000);
    const store = new RoomStore(clock, { graceWindowMs: 30_000 });
    const hostBridge = createRoomStoreWsBridge(store);
    const guestBridge = createRoomStoreWsBridge(store);

    const hostView = render(<App transport={hostBridge.createTransport()} initialLocale="pt-br" />);
    const guestView = render(<App transport={guestBridge.createTransport()} initialLocale="pt-br" />);
    const host = within(hostView.container);
    const guest = within(guestView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });
    const code = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();

    await user.type(guest.getByLabelText(/código da sala/i), code);
    await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

    await waitFor(() => {
      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    // Exchange message before network drop
    await user.type(host.getByLabelText(/^mensagem efêmera$/i), 'Mensagem antes da queda{enter}');
    await waitFor(() => {
      expect(guest.getByText('Mensagem antes da queda')).toBeInTheDocument();
    });

    // Capture SAS before reconnect
    await user.click(within(guest.getByRole('banner')).getByRole('button', { name: /cifrado ponta a ponta/i }));
    const sasDialogBefore = await guest.findByRole('dialog');
    const sasBefore = sasDialogBefore.textContent;
    await user.click(within(sasDialogBefore).getByRole('button', { name: /fechar/i }));

    // Simulate abrupt network drop on Guest
    await act(async () => {
      guestBridge.sockets[0].dropAbruptly();
    });

    // Header shows reconnecting indicator while messages remain intact
    const guestHeader = guest.getByRole('banner');
    expect(guestHeader.querySelector('[data-connection-status="reconnecting"]')).toBeInTheDocument();
    expect(guest.getByRole('status')).toHaveTextContent(/reconectando/i);
    expect(guest.getByText('Mensagem antes da queda')).toBeInTheDocument();

    // Advance backoff -> Guest transport reconnects silently
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(guestHeader.querySelector('[data-connection-status="online"]')).toBeInTheDocument();
    });
    expect(guest.getByText('Mensagem antes da queda')).toBeInTheDocument();

    // SAS remains identical and subsequent messages decrypt with intact E2EE session
    await user.click(within(guestHeader).getByRole('button', { name: /cifrado ponta a ponta/i }));
    const sasDialogAfter = await guest.findByRole('dialog');
    expect(sasDialogAfter.textContent).toBe(sasBefore);
    await user.click(within(sasDialogAfter).getByRole('button', { name: /fechar/i }));

    await user.type(host.getByLabelText(/^mensagem efêmera$/i), 'Mensagem após reconexão{enter}');
    await waitFor(() => {
      expect(guest.getByText('Mensagem após reconexão')).toBeInTheDocument();
    });
  });

  it('displays localized host_left and grace_timeout expiry reasons across locales', async () => {
    const user = userEvent.setup();
    const clock = new ManualClock(1_700_000_000_000);
    const store = new RoomStore(clock, { graceWindowMs: 30_000 });
    const hostBridge = createRoomStoreWsBridge(store);
    const guestBridge = createRoomStoreWsBridge(store);

    const hostView = render(<App transport={hostBridge.createTransport()} initialLocale="pt-br" />);
    const guestView = render(<App transport={guestBridge.createTransport()} initialLocale="es" />);
    const host = within(hostView.container);
    const guest = within(guestView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });
    const code = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();

    await user.type(guest.getByLabelText(/código de la sala/i), code);
    await user.click(guest.getByRole('button', { name: /entrar a la sala/i }));

    await waitFor(() => {
      expect(guest.getAllByText(/2 personas en línea/i).length).toBeGreaterThan(0);
    });

    // Host leaves explicitly -> Guest sees localized Spanish host_left message
    await user.click(within(host.getByRole('banner')).getByRole('button', { name: /sair da sala/i }));
    await user.click(host.getByRole('button', { name: /sair e limpar/i }));

    await waitFor(() => {
      expect(guest.getByRole('heading', { name: /sala cerrada/i })).toBeInTheDocument();
    });
    expect(guest.getByText(/anfitrión cerró la sala/i)).toBeInTheDocument();

    hostView.unmount();
    guestView.unmount();

    // Now test grace_timeout in zh-CN
    const host2Bridge = createRoomStoreWsBridge(store);
    const guest2Bridge = createRoomStoreWsBridge(store);
    const host2View = render(<App transport={host2Bridge.createTransport()} initialLocale="pt-br" />);
    const guest2View = render(<App transport={guest2Bridge.createTransport()} initialLocale="zh-CN" />);
    const host2 = within(host2View.container);
    const guest2 = within(guest2View.container);

    await user.click(host2.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host2.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });
    const code2 = host2.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();

    await user.type(guest2.getByLabelText(/房间代码/i), code2);
    await user.click(guest2.getByRole('button', { name: /加入房间/i }));
    await waitFor(() => {
      expect(guest2.getAllByText(/2 人在线/i).length).toBeGreaterThan(0);
    });

    act(() => {
      host2Bridge.sockets[0].dropAbruptly();
      clock.advanceBy(30_000);
    });

    await waitFor(() => {
      expect(guest2.getByRole('heading', { name: /房间已关闭/i })).toBeInTheDocument();
    });
    expect(guest2.getByText(/30 秒重连窗口/i)).toBeInTheDocument();
  });
});
