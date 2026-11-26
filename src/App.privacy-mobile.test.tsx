import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { FakeMediaPort } from './media/FakeMediaPort';
import { InMemoryTransportHub } from './transport/InMemoryTransport';

const ROOM_CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

async function setupConnectedRoom(options?: { locale?: 'pt-br' | 'en' | 'es' | 'zh-CN' }) {
  const user = userEvent.setup();
  const hub = new InMemoryTransportHub();
  const hostMedia = new FakeMediaPort();

  const hostView = render(
    <App
      transport={hub.createTransport()}
      mediaPort={hostMedia}
      initialLocale={options?.locale ?? 'pt-br'}
    />,
  );
  const guestView = render(
    <App
      transport={hub.createTransport()}
      initialLocale={options?.locale ?? 'pt-br'}
    />,
  );

  const host = within(hostView.container);
  const guest = within(guestView.container);

  await user.type(host.getByLabelText(/seu nome|your name/i), 'Ana');
  await user.click(host.getByRole('button', { name: /criar nova sala|create new room/i }));

  await waitFor(() => {
    expect(host.getByText(/sua sala foi criada!|your room has been created!/i)).toBeInTheDocument();
  });

  const roomCode = host.getAllByText(ROOM_CODE_REGEX)[0].textContent!.trim();

  await user.type(guest.getByLabelText(/código da sala|room code/i), roomCode);
  await user.type(guest.getByLabelText(/seu nome|your name/i), 'João');
  await user.click(guest.getByRole('button', { name: /entrar na sala|join room/i }));

  await waitFor(() => {
    expect(host.getAllByText(/2 pessoas online|2 people online/i).length).toBeGreaterThan(0);
  });

  return { user, hub, hostView, guestView, host, guest, roomCode, hostMedia };
}

describe('Ticket 08: Anti-printscreen, Privacy Settings & Mobile Responsive UX', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('activates protective blur curtain on window blur and document visibilitychange, blocks contextmenu and casual selection on messages', async () => {
    const { user, host, guest, hostView } = await setupConnectedRoom();

    await user.type(host.getByLabelText(/mensagem efêmera/i), 'Segredo confidencial{enter}');
    await waitFor(() => {
      expect(host.getByText('Segredo confidencial')).toBeInTheDocument();
      expect(guest.getByText('Segredo confidencial')).toBeInTheDocument();
    });

    // Message bubble blocks casual text selection and native contextmenu
    const bubble = host.getByText('Segredo confidencial');
    expect(bubble.className).toContain('select-none');

    const contextEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const notCanceled = bubble.dispatchEvent(contextEvent);
    expect(notCanceled).toBe(false);
    expect(contextEvent.defaultPrevented).toBe(true);

    // Initially no blur curtain
    expect(host.queryByText(/conversa ocultada por privacidade/i)).not.toBeInTheDocument();

    // Window loses focus -> protective blur curtain immediately appears
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(host.getByText(/conversa ocultada por privacidade/i)).toBeInTheDocument();
    expect(host.getByText(/volte o foco para esta janela/i)).toBeInTheDocument();

    // Window regains focus -> curtain restores cleanly
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(host.queryByText(/conversa ocultada por privacidade/i)).not.toBeInTheDocument();

    // Tab becomes hidden via visibilitychange -> protective blur curtain appears
    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(host.getByText(/conversa ocultada por privacidade/i)).toBeInTheDocument();

    // Tab becomes visible again -> curtain restores cleanly
    act(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(host.queryByText(/conversa ocultada por privacidade/i)).not.toBeInTheDocument();

    // Print-blocked notice is rendered with print-only class while sensitive sections carry print-hide markers
    expect(
      hostView.container.querySelector('.pulso-print-notice'),
    ).toBeInTheDocument();
    expect(
      hostView.container.querySelectorAll('.pulso-print-hide').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('opens SettingsModal with honest disclaimer, toggles focus blur curtain and dynamic SVG watermark in RAM without storage writes', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { user, host, hostView, roomCode } = await setupConnectedRoom();

    // Open SettingsModal via RoomSidebar "Configurações"
    const sidebar = host.getByLabelText(/barra lateral da sala/i);
    await user.click(within(sidebar).getByRole('button', { name: /^configurações$/i }));

    const dialog = await host.findByRole('dialog', { name: /privacidade/i });
    const modal = within(dialog);

    // Prominent honest disclaimer & sections
    expect(
      modal.getByText(/as proteções no navegador são dissuasivas e não impedem capturas nativas/i),
    ).toBeInTheDocument();
    expect(modal.getByText(/dispositivos de mídia/i)).toBeInTheDocument();
    expect(modal.getByText(/idioma e aparência/i)).toBeInTheDocument();

    // Focus blur shield switch is enabled by default; watermark is disabled by default
    const shieldSwitch = modal.getByRole('switch', {
      name: /ocultar mensagens ao perder foco da janela/i,
    });
    const watermarkSwitch = modal.getByRole('switch', {
      name: /exibir marca d’água discreta na sessão/i,
    });
    expect(shieldSwitch).toHaveAttribute('aria-checked', 'true');
    expect(watermarkSwitch).toHaveAttribute('aria-checked', 'false');
    expect(hostView.container.querySelector('svg[data-session-watermark="true"]')).toBeNull();

    // Turn OFF focus blur shield and turn ON watermark
    await user.click(shieldSwitch);
    expect(shieldSwitch).toHaveAttribute('aria-checked', 'false');

    await user.click(watermarkSwitch);
    expect(watermarkSwitch).toHaveAttribute('aria-checked', 'true');

    // Close modal via Escape
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(host.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Blur no longer obscures messages when disabled
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(host.queryByText(/conversa ocultada por privacidade/i)).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    // Dynamic SVG watermark is rendered, non-interactive (pointer-events-none), and displays Room Code + HH:MM
    const watermarkSvg = hostView.container.querySelector('svg[data-session-watermark="true"]');
    expect(watermarkSvg).not.toBeNull();
    expect(watermarkSvg?.getAttribute('class')).toContain('pointer-events-none');
    expect(watermarkSvg?.textContent).toContain(roomCode);
    expect(watermarkSvg?.textContent).toMatch(/\d{2}:\d{2}/);

    // Polite aria-live announcement reflects privacy state change
    expect(host.getByText(/marca d’água de sessão ativada/i)).toBeInTheDocument();

    // Re-open SettingsModal via header ⋯ menu and re-enable shield + disable watermark
    await user.click(host.getByRole('button', { name: /mais opções da sala/i }));
    await user.click(
      within(host.getByRole('menu')).getByRole('menuitem', {
        name: /configurações de mídia e privacidade/i,
      }),
    );
    const modal2 = within(await host.findByRole('dialog', { name: /privacidade/i }));
    await user.click(
      modal2.getByRole('switch', { name: /ocultar mensagens ao perder foco da janela/i }),
    );
    await user.click(
      modal2.getByRole('switch', { name: /exibir marca d’água discreta na sessão/i }),
    );
    await user.click(modal2.getByRole('button', { name: /fechar/i }));

    expect(hostView.container.querySelector('svg[data-session-watermark="true"]')).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(host.getByText(/conversa ocultada por privacidade/i)).toBeInTheDocument();

    // Zero storage writes
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage?.length ?? 0).toBe(0);
    expect(window.sessionStorage?.length ?? 0).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('supports mobile responsive layout, accessible slide-over drawer with focus management & Escape/backdrop close, safe-area composer, and video chat toggle', async () => {
    const { user, host, hostView } = await setupConnectedRoom();

    // EntryScreen mobile touch targets check on a fresh render
    const entryView = render(
      <App transport={new InMemoryTransportHub().createTransport()} initialLocale="pt-br" />,
    );
    const entryCreateBtn = within(entryView.container).getByRole('button', {
      name: /criar nova sala/i,
    });
    expect(entryCreateBtn.className).toContain('min-h-[44px]');
    entryView.unmount();

    // MessageComposer uses safe-area bottom padding
    const composerForm = host.getByLabelText(/mensagem efêmera/i).closest('form');
    expect(composerForm?.className).toContain('pb-[max(0.75rem,env(safe-area-inset-bottom))]');

    // Mobile drawer toggle button in RoomHeader has proper ARIA state
    const header = host.getByRole('banner');
    const drawerBtn = within(header).getByRole('button', {
      name: /abrir painel da sala/i,
    });
    expect(drawerBtn).toHaveAttribute('aria-expanded', 'false');
    expect(drawerBtn).toHaveAttribute('aria-controls', 'mobile-room-sidebar');

    // Open mobile drawer -> dialog appears and receives focus
    await user.click(drawerBtn);
    expect(drawerBtn).toHaveAttribute('aria-expanded', 'true');

    const drawerDialog = await host.findByRole('dialog', {
      name: /barra lateral da sala/i,
    });
    expect(drawerDialog).toHaveAttribute('id', 'mobile-room-sidebar');
    expect(drawerDialog).toHaveAttribute('aria-modal', 'true');

    await waitFor(() => {
      expect(drawerDialog.contains(document.activeElement)).toBe(true);
    });

    // Pressing Escape closes the drawer and restores focus to trigger button
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(
        host.queryByRole('dialog', { name: /barra lateral da sala/i }),
      ).not.toBeInTheDocument();
    });
    expect(drawerBtn).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(drawerBtn);

    // Re-open mobile drawer and close by clicking backdrop
    await user.click(drawerBtn);
    const reopenedDrawer = await host.findByRole('dialog', {
      name: /barra lateral da sala/i,
    });
    const backdrop = reopenedDrawer.parentElement!;
    fireEvent.click(backdrop);
    await waitFor(() => {
      expect(
        host.queryByRole('dialog', { name: /barra lateral da sala/i }),
      ).not.toBeInTheDocument();
    });

    // Start Video Call -> VideoCallStage uses full-height mobile classes and offers quick toggle to messages
    await user.click(host.getByRole('button', { name: /iniciar chamada de vídeo/i }));
    const previewDialog = await host.findByRole('dialog', {
      name: /pré-visualização antes da chamada/i,
    });
    await user.click(within(previewDialog).getByRole('button', { name: /entrar com vídeo/i }));

    const stage = await host.findByRole('region', { name: /iniciar chamada de vídeo/i });
    expect(stage.className).toContain('flex-1');
    expect(stage.className).toContain('md:h-[44%]');

    const mobileMsgToggle = within(stage).getByRole('button', {
      name: /mensagens efêmeras/i,
    });
    expect(mobileMsgToggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(mobileMsgToggle);

    const backToVideoBtn = within(
      hostView.container.querySelector('[data-call-layout="hybrid"]')!,
    ).getByRole('button', { name: /voltar ao vídeo/i });
    expect(backToVideoBtn).toHaveAttribute('aria-expanded', 'true');
  });
});
