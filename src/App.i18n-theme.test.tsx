import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { InMemoryTransportHub } from './transport/InMemoryTransport';

const ROOM_CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

describe('PULSO i18n and Dark Theme integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove('dark', 'font-cjk');
    document.documentElement.removeAttribute('data-locale');
    document.documentElement.lang = 'pt-BR';
  });

  it('auto-detects initial locale from navigator.languages when initialLocale is omitted', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es-ES', 'en-US']);
    const hub = new InMemoryTransportHub();

    render(<App transport={hub.createTransport()} />);

    expect(screen.getByRole('heading', { name: /entra o crea una sala/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/tu nombre/i)).toHaveAttribute('placeholder', 'Invitado');
    expect(document.documentElement.lang).toBe('es');
  });

  it('switches dynamically across pt-br, en, es, and zh-CN on EntryScreen without writing to storage', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { container } = render(
      <App transport={hub.createTransport()} initialLocale="pt-br" />,
    );

    const localeSelect = screen.getByRole('combobox', { name: /idioma/i });
    expect(document.documentElement.lang).toBe('pt-br');
    expect(screen.getByRole('heading', { name: /entre ou crie uma sala/i })).toBeInTheDocument();

    // Switch to English
    await user.selectOptions(localeSelect, 'en');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('heading', { name: /join or create a room/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toHaveAttribute('placeholder', 'Guest');

    // Switch to Spanish
    await user.selectOptions(screen.getByRole('combobox', { name: /language/i }), 'es');
    expect(document.documentElement.lang).toBe('es');
    expect(screen.getByRole('heading', { name: /entra o crea una sala/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/tu nombre/i)).toHaveAttribute('placeholder', 'Invitado');

    // Switch to Simplified Chinese (zh-CN) -> verifies CJK font stack hook
    await user.selectOptions(screen.getByRole('combobox', { name: /idioma/i }), 'zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.documentElement.classList.contains('font-cjk')).toBe(true);
    expect(container.firstElementChild?.classList.contains('font-cjk')).toBe(true);
    expect(screen.getByRole('heading', { name: /加入或创建房间/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/您的名称/i)).toHaveAttribute('placeholder', '访客');

    // Switch back to pt-br removes font-cjk
    await user.selectOptions(screen.getByRole('combobox', { name: /语言/i }), 'pt-br');
    expect(document.documentElement.lang).toBe('pt-br');
    expect(document.documentElement.classList.contains('font-cjk')).toBe(false);

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
  });

  it('toggles between light and dark theme on EntryScreen without writing to storage', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { container } = render(
      <App transport={hub.createTransport()} initialLocale="pt-br" />,
    );

    const themeButton = screen.getByRole('button', { name: /alternar para tema escuro/i });
    expect(themeButton).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(container.firstElementChild?.classList.contains('dark')).toBe(false);

    await user.click(themeButton);

    const lightButton = screen.getByRole('button', { name: /alternar para tema claro/i });
    expect(lightButton).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(container.firstElementChild?.classList.contains('dark')).toBe(true);

    await user.click(lightButton);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(container.firstElementChild?.classList.contains('dark')).toBe(false);

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
  });

  it('uses localized default anonymous names, translates RoomScreen via sidebar and header menu, and localizes relative timestamps', async () => {
    const baseTime = 1_700_000_000_000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(baseTime);

    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    try {
      const hostView = render(
        <App transport={hub.createTransport()} initialLocale="en" />,
      );
      const guestView = render(
        <App transport={hub.createTransport()} initialLocale="zh-CN" />,
      );

      const host = within(hostView.container);
      const guest = within(guestView.container);

      // Host creates a room anonymously in English -> default name "Guest"
      await user.click(host.getByRole('button', { name: /create new room/i }));
      await waitFor(() => {
        expect(host.getByText(/your room has been created!/i)).toBeInTheDocument();
      });

      const createdCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();

      // Guest joins anonymously in zh-CN -> default name "访客"
      await user.type(guest.getByLabelText(/房间代码/i), createdCode);
      await user.click(guest.getByRole('button', { name: /加入房间/i }));

      await waitFor(() => {
        expect(host.getAllByText(/2 people online/i).length).toBeGreaterThan(0);
        expect(guest.getAllByText(/2 人在线/i).length).toBeGreaterThan(0);
      });

      // Host sees Guest's localized anonymous name "访客", Guest sees Host's "Guest"
      expect(host.getByText('访客')).toBeInTheDocument();
      expect(guest.getByText('Guest')).toBeInTheDocument();

      // Host sends a message at baseTime
      await user.type(host.getByLabelText(/ephemeral message/i), 'Hello from host{enter}');
      await waitFor(() => {
        expect(host.getByText('Hello from host')).toBeInTheDocument();
        expect(guest.getByText('Hello from host')).toBeInTheDocument();
      });

      // Advance clock by 2 minutes so relative timestamps show "2 min"
      vi.setSystemTime(baseTime + 2 * 60 * 1000);

      // Switch Host locale dynamically inside the room via RoomSidebar selector to Spanish
      const sidebar = host.getByLabelText(/room sidebar/i);
      const sidebarSelect = within(sidebar).getByRole('combobox', { name: /language/i });
      await user.selectOptions(sidebarSelect, 'es');

      expect(host.getAllByText(/2 personas en línea/i).length).toBeGreaterThan(0);
      expect(host.getByLabelText(/mensaje efímero/i)).toBeInTheDocument();
      expect(host.getByText(/hace 2 min/i)).toBeInTheDocument();

      // Switch Host locale via RoomHeader ⋯ menu to pt-br
      await user.click(host.getByRole('button', { name: /más opciones de la sala/i }));
      const menu = host.getByRole('menu');
      await user.click(within(menu).getByRole('menuitemradio', { name: /português/i }));

      expect(host.getAllByText(/2 pessoas online/i).length).toBeGreaterThan(0);
      expect(host.getByLabelText(/mensagem efêmera/i)).toBeInTheDocument();
      expect(host.getByText(/há 2 min/i)).toBeInTheDocument();

      // Switch Host locale via ⋯ menu to zh-CN
      await user.click(host.getByRole('button', { name: /mais opções da sala/i }));
      await user.click(
        within(host.getByRole('menu')).getByRole('menuitemradio', { name: /简体中文/i }),
      );
      expect(host.getAllByText(/2 人在线/i).length).toBeGreaterThan(0);
      expect(host.getByText(/2分钟前/)).toBeInTheDocument();

      expect(setItemSpy).not.toHaveBeenCalled();
      expect(document.cookie).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('toggles dark theme inside RoomScreen via header controls and ⋯ menu with expected Panel 4 surface classes', async () => {
    const user = userEvent.setup();
    const hub = new InMemoryTransportHub();

    const hostView = render(
      <App transport={hub.createTransport()} initialLocale="pt-br" />,
    );
    const guestView = render(
      <App transport={hub.createTransport()} initialLocale="pt-br" />,
    );
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

    // Exchange one own message and one received message to verify bubble styles
    await user.type(host.getByLabelText(/mensagem efêmera/i), 'Minha mensagem{enter}');
    await user.type(guest.getByLabelText(/mensagem efêmera/i), 'Mensagem recebida{enter}');

    await waitFor(() => {
      expect(host.getByText('Minha mensagem')).toBeInTheDocument();
      expect(host.getByText('Mensagem recebida')).toBeInTheDocument();
    });

    // Verify light bubble classes
    expect(host.getByText('Minha mensagem').className).toContain('bg-[#EEF0FF]');
    expect(host.getByText('Mensagem recebida').className).toContain('bg-[#F1F3F8]');

    // Toggle dark theme from RoomHeader top control
    await user.click(host.getByRole('button', { name: /alternar para tema escuro/i }));

    expect(hostView.container.firstElementChild?.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // Verify dark surface & Panel 4 bubble classes are present
    expect(host.getByText('Minha mensagem').className).toContain('dark:bg-[#2D2856]');
    expect(host.getByText('Mensagem recebida').className).toContain('dark:bg-[#232638]');
    expect(host.getByRole('log').className).toContain('dark:bg-[#1A1C2A]');

    // Toggle back to light theme from ⋯ menu
    await user.click(host.getByRole('button', { name: /mais opções da sala/i }));
    await user.click(
      within(host.getByRole('menu')).getByRole('menuitem', { name: /alternar para tema claro/i }),
    );
    expect(hostView.container.firstElementChild?.classList.contains('dark')).toBe(false);
  });
});
