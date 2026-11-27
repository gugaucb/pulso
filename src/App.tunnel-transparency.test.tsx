import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { parseInviteUrl } from './domain/inviteLink';
import type { RuntimeInfo } from './domain/types';
import { FakeMediaPort } from './media/FakeMediaPort';
import { InMemoryTransportHub } from './transport/InMemoryTransport';

describe('Tunnel publicOrigin invite link generation & reactive updates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', '/');
    }
  });

  it('builds Host invite URL using runtimeInfo.publicOrigin when tunnelActive is true in Normal Mode', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    let copiedUrl = '';
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
      copiedUrl = text;
    });

    render(
      <App
        transport={hub.createTransport()}
        initialLocale="pt-br"
        runtimeInfo={{
          runtimeMode: 'normal',
          tunnelActive: true,
          tunnelProvider: 'cloudflare',
          publicOrigin: 'https://clever-fox.trycloudflare.com',
          turnConfigured: false,
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(screen.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /compartilhar/i }));
    expect(copiedUrl.startsWith('https://clever-fox.trycloudflare.com/?room=')).toBe(true);
    const parsed = parseInviteUrl(copiedUrl);
    expect(parsed?.mode).toBe('normal');
    expect(parsed?.roomCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(parsed?.secretKey).toBeTruthy();
  });

  it('recomputes inviteUrl reactively when runtimeInfo.publicOrigin arrives or updates after room creation and falls back to window.location.origin when absent', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    let copiedUrl = '';
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
      copiedUrl = text;
    });

    const hostView = render(
      <App
        transport={hub.createTransport()}
        initialLocale="pt-br"
        runtimeInfo={{ runtimeMode: 'normal' }}
      />,
    );
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    await user.click(host.getByRole('button', { name: /compartilhar/i }));
    expect(copiedUrl.startsWith(`${window.location.origin}/?room=`)).toBe(true);
    const initialParsed = parseInviteUrl(copiedUrl);
    expect(initialParsed?.secretKey).toBeTruthy();

    // Tunnel becomes active and publicOrigin arrives after room creation
    const updatedRuntime: RuntimeInfo = {
      runtimeMode: 'normal',
      tunnelActive: true,
      tunnelProvider: 'cloudflare',
      publicOrigin: 'https://late-owl.trycloudflare.com',
      turnConfigured: false,
    };
    hostView.rerender(
      <App
        transport={hub.createTransport()}
        initialLocale="pt-br"
        runtimeInfo={updatedRuntime}
      />,
    );

    await user.click(host.getAllByRole('button', { name: /compartilhar|copiar link|link copiado/i })[0]);
    await waitFor(() => {
      expect(copiedUrl.startsWith('https://late-owl.trycloudflare.com/?room=')).toBe(true);
    });
    const updatedParsed = parseInviteUrl(copiedUrl);
    expect(updatedParsed?.roomCode).toBe(initialParsed?.roomCode);
    expect(updatedParsed?.secretKey).toBe(initialParsed?.secretKey);

    // Public origin updates to a new tunnel URL -> inviteUrl updates preserving room & secret
    hostView.rerender(
      <App
        transport={hub.createTransport()}
        initialLocale="pt-br"
        runtimeInfo={{
          ...updatedRuntime,
          publicOrigin: 'https://second-river.trycloudflare.com',
        }}
      />,
    );

    await user.click(host.getAllByRole('button', { name: /compartilhar|copiar link|link copiado/i })[0]);
    await waitFor(() => {
      expect(copiedUrl.startsWith('https://second-river.trycloudflare.com/?room=')).toBe(true);
    });

    // Tunnel turns off / publicOrigin absent -> falls back to window.location.origin
    hostView.rerender(
      <App
        transport={hub.createTransport()}
        initialLocale="pt-br"
        runtimeInfo={{ runtimeMode: 'normal', tunnelActive: false }}
      />,
    );

    await user.click(host.getAllByRole('button', { name: /compartilhar|copiar link|link copiado/i })[0]);
    await waitFor(() => {
      expect(copiedUrl.startsWith(`${window.location.origin}/?room=`)).toBe(true);
    });
  });

  it('updates inviteUrl reactively when /api/runtime resolves asynchronously after room creation', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    let resolveRuntimeFetch!: (res: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRuntimeFetch = resolve;
        }),
    );

    let copiedUrl = '';
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
      copiedUrl = text;
    });

    render(<App transport={hub.createTransport()} initialLocale="pt-br" />);

    await user.click(screen.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(screen.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    // Before /api/runtime resolves, invite URL falls back to window.location.origin
    await user.click(screen.getByRole('button', { name: /compartilhar/i }));
    expect(copiedUrl.startsWith(`${window.location.origin}/?room=`)).toBe(true);

    // /api/runtime resolves with tunnelActive + publicOrigin
    resolveRuntimeFetch(
      new Response(
        JSON.stringify({
          runtimeMode: 'normal',
          tunnelActive: true,
          tunnelProvider: 'cloudflare',
          publicOrigin: 'https://async-pine.trycloudflare.com',
          turnConfigured: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await waitFor(async () => {
      await user.click(screen.getAllByRole('button', { name: /compartilhar|copiar link|link copiado/i })[0]);
      expect(copiedUrl.startsWith('https://async-pine.trycloudflare.com/?room=')).toBe(true);
    });
  });
});

describe('Tunnel transparency badge & notice for Host and Guest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', '/');
    }
  });

  it('displays the Cloudflare tunnel transparency badge and E2EE notice to BOTH Host and Guest when tunnelActive is true in Normal Mode', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const tunnelRuntime: RuntimeInfo = {
      runtimeMode: 'normal',
      tunnelActive: true,
      tunnelProvider: 'cloudflare',
      publicOrigin: 'https://clear-breeze.trycloudflare.com',
      turnConfigured: false,
    };

    const hostView = render(
      <App
        transport={hub.createTransport()}
        mediaPort={new FakeMediaPort()}
        initialLocale="pt-br"
        runtimeInfo={tunnelRuntime}
      />,
    );
    const guestView = render(
      <App
        transport={hub.createTransport()}
        mediaPort={new FakeMediaPort()}
        initialLocale="pt-br"
        runtimeInfo={tunnelRuntime}
      />,
    );

    const host = within(hostView.container);
    const guest = within(guestView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    const codeMatch = host.getAllByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)[0].textContent!.trim();
    await user.type(guest.getByLabelText(/código da sala/i), codeMatch);
    await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

    await waitFor(() => {
      expect(guest.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    for (const participant of [host, guest]) {
      expect(participant.getByText(/túnel cloudflare/i)).toBeInTheDocument();
      const notice = participant.getByRole('note');
      expect(notice).toHaveTextContent(/cloudflare/i);
      expect(notice).toHaveTextContent(/metadados/i);
      expect(notice).toHaveTextContent(/mensagens efêmeras/i);
      expect(notice).toHaveTextContent(/cifradas ponta a ponta/i);
    }
  });

  it('hides the tunnel transparency badge and notice when tunnelActive is false or in Tor Mode', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    const normalView = render(
      <App
        transport={hub.createTransport()}
        mediaPort={new FakeMediaPort()}
        initialLocale="pt-br"
        runtimeInfo={{ runtimeMode: 'normal', tunnelActive: false }}
      />,
    );
    const normalHost = within(normalView.container);

    await user.click(normalHost.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(normalHost.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });
    expect(normalHost.queryByText(/túnel cloudflare/i)).not.toBeInTheDocument();
    expect(normalHost.queryByRole('note')).not.toBeInTheDocument();

    const torHub = new InMemoryTransportHub();
    const torView = render(
      <App
        transport={torHub.createTransport()}
        mediaPort={new FakeMediaPort()}
        initialLocale="pt-br"
        runtimeInfo={{
          runtimeMode: 'tor',
          torStatus: 'ready',
          onionAddress: `http://${'p'.repeat(56)}.onion`,
          tunnelActive: true,
          tunnelProvider: 'cloudflare',
        }}
      />,
    );
    const torHost = within(torView.container);
    await user.click(torHost.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(torHost.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });
    expect(torHost.queryByText(/túnel cloudflare/i)).not.toBeInTheDocument();
    expect(torHost.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('NAT/firewall friendly notice when TURN is not configured', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', '/');
    }
  });

  it('shows friendly NAT/firewall notice when connection_failed occurs and turnConfigured is false, while text chat keeps working', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const hostMedia = new FakeMediaPort({ connectionFailed: true });
    const guestMedia = new FakeMediaPort();
    const runtime: RuntimeInfo = {
      runtimeMode: 'normal',
      tunnelActive: true,
      tunnelProvider: 'cloudflare',
      publicOrigin: 'https://nat-check.trycloudflare.com',
      turnConfigured: false,
    };

    const hostView = render(
      <App
        transport={hub.createTransport()}
        mediaPort={hostMedia}
        initialLocale="pt-br"
        runtimeInfo={runtime}
      />,
    );
    const guestView = render(
      <App
        transport={hub.createTransport()}
        mediaPort={guestMedia}
        initialLocale="pt-br"
        runtimeInfo={runtime}
      />,
    );

    const host = within(hostView.container);
    const guest = within(guestView.container);

    await user.click(host.getByRole('button', { name: /criar nova sala/i }));
    await waitFor(() => {
      expect(host.getByText(/sua sala foi criada!/i)).toBeInTheDocument();
    });

    const codeMatch = host.getAllByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)[0].textContent!.trim();
    await user.type(guest.getByLabelText(/código da sala/i), codeMatch);
    await user.click(guest.getByRole('button', { name: /entrar na sala/i }));

    await waitFor(() => {
      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
    });

    await user.click(host.getByRole('button', { name: /iniciar chamada de vídeo/i }));
    const dialog = await host.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /entrar com vídeo/i }));

    await waitFor(() => {
      const alert = host.getByRole('alert');
      expect(alert).toHaveTextContent(/chamada de vídeo/i);
      expect(alert).toHaveTextContent(/NAT|firewall/i);
      expect(alert).toHaveTextContent(/TURN/i);
      expect(alert).toHaveTextContent(/mensagens efêmeras/i);
    });

    // Ephemeral text chat continues working normally
    await user.type(
      host.getByLabelText(/^mensagem efêmera$/i),
      'Vídeo bloqueado pelo firewall, seguimos por texto!{enter}',
    );
    await waitFor(() => {
      expect(
        guest.getByText('Vídeo bloqueado pelo firewall, seguimos por texto!'),
      ).toBeInTheDocument();
    });

    // Notice is dismissible
    await user.click(host.getByRole('button', { name: /dispensar aviso/i }));
    expect(host.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows standard mediaConnectionFailed message when turnConfigured is true', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const hostMedia = new FakeMediaPort({ connectionFailed: true });

    const hostView = render(
      <App
        transport={hub.createTransport()}
        mediaPort={hostMedia}
        initialLocale="en"
        runtimeInfo={{ runtimeMode: 'normal', turnConfigured: true }}
      />,
    );
    const host = within(hostView.container);

    await user.click(host.getByRole('button', { name: /create new room/i }));
    await waitFor(() => {
      expect(host.getByText(/your room has been created!/i)).toBeInTheDocument();
    });

    await user.click(host.getByRole('button', { name: /start video call/i }));
    const dialog = await host.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /join with video/i }));

    await waitFor(() => {
      const alert = host.getByRole('alert');
      expect(alert).toHaveTextContent(/could not establish the video call/i);
      expect(alert).not.toHaveTextContent(/no TURN server configured/i);
    });
  });

  it('renders localized tunnel transparency and NAT no-TURN notices across en, es, and zh-CN for Guest via invite link', async () => {
    const cases = [
      {
        locale: 'en' as const,
        createBtn: /create new room/i,
        startCall: /start video call/i,
        joinVideo: /join with video/i,
        badge: /cloudflare tunnel/i,
        notice: /network intermediary.*ephemeral messages/i,
        natAlert: /video call was blocked by nat or firewall.*ephemeral messages/i,
      },
      {
        locale: 'es' as const,
        createBtn: /crear nueva sala/i,
        startCall: /iniciar videollamada/i,
        joinVideo: /entrar con vídeo/i,
        badge: /túnel cloudflare/i,
        notice: /intermediario de red.*mensajes efímeros/i,
        natAlert: /videollamada p2p fue bloqueada por nat o firewall.*mensajes efímeros/i,
      },
      {
        locale: 'zh-CN' as const,
        createBtn: /创建新房间/i,
        startCall: /发起视频通话/i,
        joinVideo: /开启视频加入/i,
        badge: /cloudflare 隧道/i,
        notice: /网络中介.*阅后即焚消息/,
        natAlert: /nat 或防火墙阻止.*阅后即焚消息/i,
      },
    ];

    for (const c of cases) {
      const user = userEvent.setup();
      const hub = new InMemoryTransportHub();
      const guestMedia = new FakeMediaPort({ connectionFailed: true });
      const runtime: RuntimeInfo = {
        runtimeMode: 'normal',
        tunnelActive: true,
        tunnelProvider: 'cloudflare',
        publicOrigin: 'https://i18n-tunnel.trycloudflare.com',
        turnConfigured: false,
      };

      const hostView = render(
        <App
          transport={hub.createTransport()}
          mediaPort={new FakeMediaPort()}
          initialLocale={c.locale}
          runtimeInfo={runtime}
        />,
      );
      const host = within(hostView.container);
      await user.click(host.getByRole('button', { name: c.createBtn }));
      const code = await waitFor(() =>
        host.getAllByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)[0].textContent!.trim(),
      );

      const guestView = render(
        <App
          transport={hub.createTransport()}
          mediaPort={guestMedia}
          initialUrl={`https://i18n-tunnel.trycloudflare.com/?room=${code}#k=linkSecret123`}
          initialLocale={c.locale}
          runtimeInfo={runtime}
        />,
      );
      const guest = within(guestView.container);

      await waitFor(() => {
        expect(guest.getByText(c.badge)).toBeInTheDocument();
      });
      expect(guest.getByRole('note')).toHaveTextContent(c.notice);

      await user.click(guest.getByRole('button', { name: c.startCall }));
      const dialog = await guest.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: c.joinVideo }));

      await waitFor(() => {
        expect(guest.getByRole('alert')).toHaveTextContent(c.natAlert);
      });

      hostView.unmount();
      guestView.unmount();
    }
  });
});
