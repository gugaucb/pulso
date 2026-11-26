import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const CONTEXT_OPTIONS = {
  locale: 'pt-BR',
  permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] as string[],
};

async function assertZeroTrace(page: Page): Promise<void> {
  const storage = await page.evaluate(async () => {
    const databases =
      typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function'
        ? await indexedDB.databases()
        : [];
    return {
      localStorageLength: window.localStorage.length,
      sessionStorageLength: window.sessionStorage.length,
      indexedDbCount: databases.length,
      cookie: document.cookie,
    };
  });

  expect(storage.localStorageLength).toBe(0);
  expect(storage.sessionStorageLength).toBe(0);
  expect(storage.indexedDbCount).toBe(0);
  expect(storage.cookie).toBe('');
}

async function createRoomAndGetInviteUrl(
  hostPage: Page,
  options?: { displayName?: string; mode?: 'normal' | 'tor' },
): Promise<string> {
  await hostPage.goto('/');

  if (options?.displayName) {
    await hostPage.getByLabel('Seu nome (opcional)').fill(options.displayName);
  }

  if (options?.mode === 'tor') {
    await hostPage.getByRole('radio', { name: /Modo Tor/i }).check();
  }

  await hostPage.getByRole('button', { name: 'Criar nova sala' }).click();
  await expect(hostPage.getByText('Sua sala foi criada!')).toBeVisible();

  await hostPage.getByRole('button', { name: 'Compartilhar' }).click();
  await expect(
    hostPage.locator('section').getByRole('button', { name: 'Link copiado!' }),
  ).toBeVisible();

  const inviteUrl = await hostPage.evaluate(() => navigator.clipboard.readText());
  expect(inviteUrl).toContain('?room=');
  expect(inviteUrl).toContain('#k=');
  return inviteUrl;
}

async function joinWithInviteUrl(
  context: BrowserContext,
  inviteUrl: string,
): Promise<Page> {
  const guestPage = await context.newPage();
  await guestPage.goto(inviteUrl);
  await expect(guestPage.locator('header').getByText('2 pessoas online')).toBeVisible();
  return guestPage;
}

test.describe('PULSO Phase 1 E2E Suite', () => {
  test('desktop two-tab E2EE chat, typing indicator, and matching SAS verification', async ({
    browser,
  }) => {
    const context = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const hostPage = await context.newPage();
      const inviteUrl = await createRoomAndGetInviteUrl(hostPage, { displayName: 'Alice' });
      const roomCode = (await hostPage.locator('header h1').textContent())?.trim() ?? '';
      expect(roomCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

      const guestPage = await joinWithInviteUrl(context, inviteUrl);
      await expect(hostPage.locator('header').getByText('2 pessoas online')).toBeVisible();

      const guestComposer = guestPage.getByLabel('Mensagem efêmera', { exact: true });
      await guestComposer.fill('Olá Alice, mensagem cifrada!');
      await expect(hostPage.getByText('Visitante está digitando…')).toBeVisible();

      await guestComposer.press('Enter');
      await expect(
        guestPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText('Olá Alice, mensagem cifrada!'),
      ).toBeVisible();
      await expect(
        hostPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText('Olá Alice, mensagem cifrada!'),
      ).toBeVisible();

      const hostComposer = hostPage.getByLabel('Mensagem efêmera', { exact: true });
      await hostComposer.fill('Oi Visitante! Tudo protegido ponta a ponta.');
      await hostComposer.press('Enter');

      await expect(
        guestPage
          .getByRole('log', { name: 'Mensagens efêmeras' })
          .getByText('Oi Visitante! Tudo protegido ponta a ponta.'),
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
      await context.close();
    }
  });

  test('switches i18n locales (pt-br, en, es, zh-CN) and light/dark themes dynamically', async ({
    browser,
  }) => {
    const context = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const page = await context.newPage();
      await page.goto('/');

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
    }
  });

  test('runs simulated Video Call in Normal Mode and strictly blocks video in Tor Mode', async ({
    browser,
  }) => {
    const context = await browser.newContext(CONTEXT_OPTIONS);
    try {
      const page = await context.newPage();
      await page.goto('/');

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
      await page.getByRole('button', { name: 'Criar nova sala' }).click();

      await expect(page.locator('header').locator('[data-room-mode="tor"]')).toContainText('Modo Tor');
      await expect(page.getByText(/[a-z2-7]{56}\.onion/i).first()).toBeVisible();
      await expect(
        page.getByText('Chamada de vídeo bloqueada no Modo Tor para proteger seu anonimato.'),
      ).toBeVisible();

      const torVideoButton = page.locator('header').getByRole('button', {
        name: 'Iniciar chamada de vídeo',
      });
      await expect(torVideoButton).toBeDisabled();

      await assertZeroTrace(page);
    } finally {
      await context.close();
    }
  });

  test('activates ScreenShield blur curtain on blur and purges messages when inactivity hits 00:00', async ({
    browser,
  }) => {
    const context = await browser.newContext(CONTEXT_OPTIONS);
    try {
      await context.clock.install();

      const hostPage = await context.newPage();
      const inviteUrl = await createRoomAndGetInviteUrl(hostPage, { displayName: 'Anfitriã' });
      const guestPage = await joinWithInviteUrl(context, inviteUrl);

      const hostComposer = hostPage.getByLabel('Mensagem efêmera', { exact: true });
      await hostComposer.fill('Conteúdo ultrassecreto da sessão');
      await hostComposer.press('Enter');

      await expect(
        hostPage
          .getByRole('log', { name: 'Mensagens efêmeras' })
          .getByText('Conteúdo ultrassecreto da sessão'),
      ).toBeVisible();
      await expect(
        guestPage
          .getByRole('log', { name: 'Mensagens efêmeras' })
          .getByText('Conteúdo ultrassecreto da sessão'),
      ).toBeVisible();

      await hostPage.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect(hostPage.getByText('Conversa ocultada por privacidade')).toBeVisible();

      await hostPage.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(hostPage.getByText('Conversa ocultada por privacidade')).toHaveCount(0);

      await hostPage.clock.fastForward('56:00');
      await expect(hostPage.locator('[data-inactivity-banner="warning"]')).toBeVisible();

      await hostPage.clock.fastForward('04:05');
      await expect(hostPage.getByRole('heading', { name: 'Sala encerrada' })).toBeVisible();
      await expect(hostPage.getByText('Conteúdo ultrassecreto da sessão')).toHaveCount(0);

      await assertZeroTrace(hostPage);
      await assertZeroTrace(guestPage);
    } finally {
      await context.close();
    }
  });

  test('mobile viewport (390x844) renders compact header, slide-over drawer, and ephemeral messaging', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ...CONTEXT_OPTIONS,
      viewport: { width: 390, height: 844 },
    });
    try {
      const mobileHost = await context.newPage();
      const inviteUrl = await createRoomAndGetInviteUrl(mobileHost, { displayName: 'MobileHost' });

      const desktopGuest = await context.newPage();
      await desktopGuest.setViewportSize({ width: 1280, height: 800 });
      await desktopGuest.goto(inviteUrl);
      await expect(desktopGuest.locator('header').getByText('2 pessoas online')).toBeVisible();

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
      await mobileComposer.fill('Mensagem enviada do mobile!');
      await mobileComposer.press('Enter');

      await expect(
        mobileHost
          .getByRole('log', { name: 'Mensagens efêmeras' })
          .getByText('Mensagem enviada do mobile!'),
      ).toBeVisible();
      await expect(
        desktopGuest
          .getByRole('log', { name: 'Mensagens efêmeras' })
          .getByText('Mensagem enviada do mobile!'),
      ).toBeVisible();

      await assertZeroTrace(mobileHost);
      await assertZeroTrace(desktopGuest);
    } finally {
      await context.close();
    }
  });
});
