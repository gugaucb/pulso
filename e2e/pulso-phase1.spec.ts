import { expect, test } from '@playwright/test';
import {
  assertServerLogsZeroTrace,
  assertZeroTrace,
  createIsolatedContext,
  createRoomAndGetInviteUrl,
  joinRoomViaInviteUrl,
  spawnProductionServer,
} from './helpers/pulsoHarness';

test.describe('PULSO Phase 1 Regression Suite (Production Fastify)', () => {
  test('two isolated contexts exchange E2EE messages, typing indicator, and matching SAS', async ({
    browser,
  }) => {
    const server = await spawnProductionServer();
    const hostContext = await createIsolatedContext(browser);
    const guestContext = await createIsolatedContext(browser);

    const hostMsg = 'Oi Visitante! Tudo protegido ponta a ponta.';
    const guestMsg = 'Olá Alice, mensagem cifrada!';
    let roomCode = '';

    try {
      const hostPage = await hostContext.newPage();
      const created = await createRoomAndGetInviteUrl(hostPage, server.baseUrl, {
        displayName: 'Alice',
      });
      roomCode = created.roomCode;

      const guestPage = await joinRoomViaInviteUrl(guestContext, created.inviteUrl);
      await expect(hostPage.locator('header').getByText('2 pessoas online')).toBeVisible();

      const guestComposer = guestPage.getByLabel('Mensagem efêmera', { exact: true });
      await guestComposer.fill(guestMsg);
      await expect(hostPage.getByText('Visitante está digitando…')).toBeVisible();

      await guestComposer.press('Enter');
      await expect(
        guestPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(guestMsg),
      ).toBeVisible();
      await expect(
        hostPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(guestMsg),
      ).toBeVisible();

      const hostComposer = hostPage.getByLabel('Mensagem efêmera', { exact: true });
      await hostComposer.fill(hostMsg);
      await hostComposer.press('Enter');

      await expect(
        guestPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(hostMsg),
      ).toBeVisible();

      await hostPage.getByRole('button', { name: 'Verificar código SAS' }).click();
      await guestPage.getByRole('button', { name: 'Verificar código SAS' }).click();

      const hostDialog = hostPage.getByRole('dialog', { name: 'Verificação mútua (SAS)' });
      const guestDialog = guestPage.getByRole('dialog', { name: 'Verificação mútua (SAS)' });

      const hostSasText = await hostDialog
        .getByText(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/)
        .textContent();
      const guestSasText = await guestDialog
        .getByText(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/)
        .textContent();

      expect(hostSasText?.trim()).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
      expect(hostSasText?.trim()).toBe(guestSasText?.trim());

      await hostDialog.getByRole('button', { name: 'Fechar' }).click();
      await guestDialog.getByRole('button', { name: 'Fechar' }).click();

      await assertZeroTrace(hostPage);
      await assertZeroTrace(guestPage);
    } finally {
      await hostContext.close();
      await guestContext.close();
      await server.stop();
    }

    assertServerLogsZeroTrace(server.getOutput(), {
      secrets: [roomCode, 'Alice', hostMsg, guestMsg],
    });
  });

  test('switches i18n locales (pt-br, en, es, zh-CN) and light/dark themes dynamically', async ({
    browser,
  }) => {
    const server = await spawnProductionServer();
    const context = await createIsolatedContext(browser);

    try {
      const page = await context.newPage();
      await page.goto(server.baseUrl);

      await expect(page.locator('html')).toHaveAttribute('lang', 'pt-br');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.getByRole('heading', { name: 'Entre ou crie uma sala' })).toBeVisible();

      await page.getByLabel('Idioma').selectOption('en');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { name: 'Join or create a room' })).toBeVisible();

      await page.getByLabel('Language').selectOption('es');
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.getByRole('heading', { name: 'Entra o crea una sala' })).toBeVisible();

      await page.getByLabel('Idioma').selectOption('zh-CN');
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
      await expect(page.locator('html')).toHaveClass(/font-cjk/);
      await expect(page.getByRole('heading', { name: '加入或创建房间' })).toBeVisible();

      await page.getByRole('button', { name: '切换到深色主题' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('html')).toHaveClass(/dark/);

      await page.getByRole('button', { name: '切换到浅色主题' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.locator('html')).not.toHaveClass(/dark/);

      await page.getByLabel('语言').selectOption('pt-br');
      await expect(page.locator('html')).toHaveAttribute('lang', 'pt-br');

      await page.getByRole('button', { name: 'Criar nova sala' }).click();
      await expect(page.getByText('Sua sala foi criada!')).toBeVisible();

      await page.locator('header').getByRole('button', { name: 'Alternar para tema escuro' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

      await assertZeroTrace(page);
    } finally {
      await context.close();
      await server.stop();
    }

    assertServerLogsZeroTrace(server.getOutput());
  });

  test('runs Video Call controls in Normal Mode and shows honest Tor guidance in Normal runtime', async ({
    browser,
  }) => {
    const server = await spawnProductionServer();
    const context = await createIsolatedContext(browser);

    try {
      const page = await context.newPage();
      await page.goto(server.baseUrl);

      await page.getByRole('button', { name: 'Criar nova sala' }).click();
      await expect(page.getByText('Sua sala foi criada!')).toBeVisible();

      const startCallButton = page.locator('header').getByRole('button', {
        name: 'Iniciar chamada de vídeo',
      });
      await expect(startCallButton).toBeEnabled();
      await startCallButton.click();

      const previewModal = page.getByRole('dialog', {
        name: 'Pré-visualização antes da chamada',
      });
      await expect(previewModal).toBeVisible();
      await previewModal.getByRole('button', { name: 'Entrar com vídeo' }).click();

      const stage = page.locator('section[data-call-layout]');
      await expect(stage).toHaveAttribute('data-call-layout', 'hybrid');
      await expect(stage.getByText('Você com câmera ligada')).toBeVisible();

      await stage.getByRole('button', { name: 'Silenciar microfone' }).click();
      await expect(stage.getByRole('button', { name: 'Ativar microfone' })).toBeVisible();

      await stage.getByRole('button', { name: 'Desligar câmera' }).click();
      await expect(stage.getByText('Você com câmera desligada')).toBeVisible();

      await stage.getByRole('button', { name: 'Alternar layout' }).click();
      await stage.getByRole('menuitemradio', { name: 'Picture-in-Picture' }).click();
      await expect(stage).toHaveAttribute('data-call-layout', 'pip');

      await stage.getByRole('button', { name: 'Alternar layout' }).click();
      await stage.getByRole('menuitemradio', { name: 'Foco em vídeo' }).click();
      await expect(stage).toHaveAttribute('data-call-layout', 'focus');

      await stage.getByRole('button', { name: 'Encerrar chamada' }).click();
      await expect(stage).toHaveCount(0);

      await page.locator('header').getByRole('button', { name: 'Sair da sala' }).click();
      await page
        .getByRole('dialog', { name: 'Sair da sala?' })
        .getByRole('button', { name: 'Sair e limpar' })
        .click();

      await expect(page.getByRole('heading', { name: 'Entre ou crie uma sala' })).toBeVisible();

      await page.getByRole('radio', { name: /Modo Tor/i }).check();
      await expect(page.getByText('Modo Tor requer o launcher local')).toBeVisible();
      await expect(page.getByText('npm run start:tor')).toBeVisible();
      await expect(page.getByText(/[a-z2-7]{56}\.onion/i)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Criar nova sala' })).toBeDisabled();

      await assertZeroTrace(page);
    } finally {
      await context.close();
      await server.stop();
    }

    assertServerLogsZeroTrace(server.getOutput());
  });

  test('activates ScreenShield blur curtain on blur and purges messages when server inactivity expires', async ({
    browser,
  }) => {
    const server = await spawnProductionServer({ PULSO_INACTIVITY_MS: '4500' });
    const hostContext = await createIsolatedContext(browser);
    const guestContext = await createIsolatedContext(browser);

    const secretMessage = 'Conteúdo ultrassecreto da sessão';
    let roomCode = '';

    try {
      const hostPage = await hostContext.newPage();
      const created = await createRoomAndGetInviteUrl(hostPage, server.baseUrl, {
        displayName: 'Anfitriã',
      });
      roomCode = created.roomCode;

      const guestPage = await joinRoomViaInviteUrl(guestContext, created.inviteUrl);

      const hostComposer = hostPage.getByLabel('Mensagem efêmera', { exact: true });
      await hostComposer.fill(secretMessage);
      await hostComposer.press('Enter');

      await expect(
        hostPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(secretMessage),
      ).toBeVisible();
      await expect(
        guestPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(secretMessage),
      ).toBeVisible();

      await hostPage.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect(hostPage.getByText('Conversa ocultada por privacidade')).toBeVisible();

      await hostPage.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(hostPage.getByText('Conversa ocultada por privacidade')).toHaveCount(0);

      await expect(hostPage.locator('[data-inactivity-banner="critical"]')).toBeVisible();

      await expect(hostPage.getByRole('heading', { name: 'Sala encerrada' })).toBeVisible({
        timeout: 12_000,
      });
      await expect(guestPage.getByRole('heading', { name: 'Sala encerrada' })).toBeVisible({
        timeout: 12_000,
      });
      await expect(hostPage.getByText(secretMessage)).toHaveCount(0);
      await expect(guestPage.getByText(secretMessage)).toHaveCount(0);

      await assertZeroTrace(hostPage);
      await assertZeroTrace(guestPage);
    } finally {
      await hostContext.close();
      await guestContext.close();
      await server.stop();
    }

    assertServerLogsZeroTrace(server.getOutput(), {
      secrets: [roomCode, 'Anfitriã', secretMessage],
    });
  });

  test('mobile viewport (390x844) renders compact header, slide-over drawer, and ephemeral messaging across isolated contexts', async ({
    browser,
  }) => {
    const server = await spawnProductionServer();
    const mobileHostContext = await createIsolatedContext(browser, {
      viewport: { width: 390, height: 844 },
    });
    const desktopGuestContext = await createIsolatedContext(browser, {
      viewport: { width: 1280, height: 800 },
    });

    const mobileMessage = 'Mensagem enviada do mobile!';
    let roomCode = '';

    try {
      const mobileHost = await mobileHostContext.newPage();
      const created = await createRoomAndGetInviteUrl(mobileHost, server.baseUrl, {
        displayName: 'MobileHost',
      });
      roomCode = created.roomCode;

      const desktopGuest = await joinRoomViaInviteUrl(desktopGuestContext, created.inviteUrl);
      await expect(mobileHost.locator('header').getByText('2 pessoas online')).toBeVisible();

      await expect(mobileHost.locator('aside[aria-label="Barra lateral da sala"]')).toBeHidden();
      const openDrawerBtn = mobileHost.getByRole('button', { name: 'Abrir painel da sala' });
      await expect(openDrawerBtn).toBeVisible();
      await openDrawerBtn.click();

      const drawer = mobileHost.locator('#mobile-room-sidebar');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText('2 pessoas online')).toBeVisible();

      await drawer.getByRole('button', { name: 'Fechar painel' }).click();
      await expect(drawer).toHaveCount(0);

      const mobileComposer = mobileHost.getByLabel('Mensagem efêmera', { exact: true });
      await mobileComposer.fill(mobileMessage);
      await mobileComposer.press('Enter');

      await expect(
        mobileHost.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(mobileMessage),
      ).toBeVisible();
      await expect(
        desktopGuest.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(mobileMessage),
      ).toBeVisible();

      await assertZeroTrace(mobileHost);
      await assertZeroTrace(desktopGuest);
    } finally {
      await mobileHostContext.close();
      await desktopGuestContext.close();
      await server.stop();
    }

    assertServerLogsZeroTrace(server.getOutput(), {
      secrets: [roomCode, 'MobileHost', mobileMessage],
    });
  });
});
