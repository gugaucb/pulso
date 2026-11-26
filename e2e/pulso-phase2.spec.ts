import { expect, test, type WebSocketRoute } from '@playwright/test';
import { WebSocket } from 'ws';
import { WS_PROTOCOL_VERSION, type ServerWsMessage } from '../shared/protocol';
import {
  assertServerLogsZeroTrace,
  assertZeroTrace,
  attachWsFrameAuditor,
  createIsolatedContext,
  createRoomAndGetInviteUrl,
  joinRoomViaInviteUrl,
  spawnProductionServer,
  startControlledTorServer,
} from './helpers/pulsoHarness';

async function readSasCode(page: import('@playwright/test').Page): Promise<string> {
  await page.getByRole('button', { name: 'Verificar código SAS' }).click();
  const dialog = page.getByRole('dialog', { name: 'Verificação mútua (SAS)' });
  const sasText = (
    await dialog.getByText(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/).textContent()
  )?.trim();
  expect(sasText).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  return sasText!;
}

test.describe('PULSO Phase 2 Full-Stack Multi-Browser E2E Suite', () => {
  test('Normal Mode: 1:1 E2EE across isolated contexts, WS frame audit, matching SAS, and 3rd-entrant room_full rejection', async ({
    browser,
  }) => {
    const server = await spawnProductionServer();
    const hostContext = await createIsolatedContext(browser);
    const guestContext = await createIsolatedContext(browser);
    const intruderContext = await createIsolatedContext(browser);

    const guestMessage = 'Segredo do convidado via WebSocket real';
    const hostReply = 'Resposta cifrada do anfitrião sem senderName';
    let roomCode = '';

    try {
      const hostPage = await hostContext.newPage();
      const hostWsAudit = attachWsFrameAuditor(hostPage);

      const created = await createRoomAndGetInviteUrl(hostPage, server.baseUrl, {
        displayName: 'Alice',
      });
      roomCode = created.roomCode;

      const guestPage = await guestContext.newPage();
      const guestWsAudit = attachWsFrameAuditor(guestPage);
      await guestPage.goto(created.inviteUrl);
      await expect(guestPage.locator('header').getByText('2 pessoas online')).toBeVisible();
      await expect(hostPage.locator('header').getByText('2 pessoas online')).toBeVisible();

      const guestComposer = guestPage.getByLabel('Mensagem efêmera', { exact: true });
      await guestComposer.fill(guestMessage);
      await expect(hostPage.getByText('Visitante está digitando…')).toBeVisible();
      await guestComposer.press('Enter');

      await expect(
        hostPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(guestMessage),
      ).toBeVisible();

      const hostComposer = hostPage.getByLabel('Mensagem efêmera', { exact: true });
      await hostComposer.fill(hostReply);
      await hostComposer.press('Enter');

      await expect(
        guestPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(hostReply),
      ).toBeVisible();

      const hostSas = await readSasCode(hostPage);
      const guestSas = await readSasCode(guestPage);
      expect(hostSas).toBe(guestSas);

      // 3rd isolated BrowserContext attempting to join by Room Code must be rejected with room_full
      const intruderPage = await intruderContext.newPage();
      await intruderPage.goto(server.baseUrl);
      await intruderPage.getByLabel('Código da sala').fill(roomCode);
      await intruderPage.getByLabel('Seu nome (opcional)').fill('Intruso');
      await intruderPage.getByRole('button', { name: 'Entrar na sala' }).click();

      await expect(intruderPage.getByRole('alert')).toContainText(
        'Esta sala 1:1 já está ocupada por 2 participantes.',
      );

      // Wire audit: encrypted_message frames never contain plaintext or senderName
      hostWsAudit.assertEncryptedFramesClean([guestMessage, hostReply], ['Alice', 'Intruso']);
      guestWsAudit.assertEncryptedFramesClean([guestMessage, hostReply], ['Alice', 'Intruso']);

      await assertZeroTrace(hostPage);
      await assertZeroTrace(guestPage);
      await assertZeroTrace(intruderPage);
    } finally {
      await hostContext.close();
      await guestContext.close();
      await intruderContext.close();
      await server.stop();
    }

    assertServerLogsZeroTrace(server.getOutput(), {
      secrets: [roomCode, 'Alice', 'Intruso', guestMessage, hostReply],
    });
  });

  test('recovers silently within 30s grace window preserving E2EE keys and volatile history', async ({
    browser,
  }) => {
    const server = await spawnProductionServer();
    const hostContext = await createIsolatedContext(browser);
    const guestContext = await createIsolatedContext(browser);

    const beforeDropMsg = 'Mensagem antes da queda de rede';
    const afterReconnectGuestMsg = 'Mensagem pós-reconexão com mesma chave E2EE';
    const afterReconnectHostMsg = 'Anfitrião confirmando recepção após reconexão';
    let roomCode = '';

    let blockGuestWs = false;
    const guestWsHolder: { route: WebSocketRoute | null } = { route: null };

    await guestContext.routeWebSocket(/\/ws$/, async (ws) => {
      if (blockGuestWs) {
        await ws.close({ code: 4000, reason: 'Simulated temporary outage' });
        return;
      }
      guestWsHolder.route = ws;
      ws.connectToServer();
    });

    try {
      const hostPage = await hostContext.newPage();
      const created = await createRoomAndGetInviteUrl(hostPage, server.baseUrl, {
        displayName: 'Alice',
      });
      roomCode = created.roomCode;

      const guestPage = await joinRoomViaInviteUrl(guestContext, created.inviteUrl);

      const hostComposer = hostPage.getByLabel('Mensagem efêmera', { exact: true });
      await hostComposer.fill(beforeDropMsg);
      await hostComposer.press('Enter');

      await expect(
        guestPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(beforeDropMsg),
      ).toBeVisible();

      // Simulate transient WebSocket outage on Guest without page reload
      expect(guestWsHolder.route).not.toBeNull();
      blockGuestWs = true;
      await guestWsHolder.route!.close({ code: 4000, reason: 'Simulated temporary outage' });

      await expect(
        guestPage.locator('[data-connection-status-banner="reconnecting"]'),
      ).toBeVisible();
      await expect(
        guestPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(beforeDropMsg),
      ).toBeVisible();
      await expect(hostPage.locator('[data-connection-status="waiting"]')).toBeVisible();

      // Restore connectivity within 30s grace window
      blockGuestWs = false;

      await expect(
        guestPage.locator('[data-connection-status-banner="reconnecting"]'),
      ).toHaveCount(0, { timeout: 15_000 });
      await expect(guestPage.locator('[data-connection-status="online"]')).toBeVisible();
      await expect(hostPage.locator('[data-connection-status="online"]')).toBeVisible();

      // Existing volatile history remains and E2EE keys continue working seamlessly
      await expect(
        guestPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(beforeDropMsg),
      ).toBeVisible();

      const guestComposer = guestPage.getByLabel('Mensagem efêmera', { exact: true });
      await guestComposer.fill(afterReconnectGuestMsg);
      await guestComposer.press('Enter');

      await expect(
        hostPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(afterReconnectGuestMsg),
      ).toBeVisible();

      await hostComposer.fill(afterReconnectHostMsg);
      await hostComposer.press('Enter');

      await expect(
        guestPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(afterReconnectHostMsg),
      ).toBeVisible();

      await assertZeroTrace(hostPage);
      await assertZeroTrace(guestPage);
    } finally {
      await hostContext.close();
      await guestContext.close();
      await server.stop();
    }

    assertServerLogsZeroTrace(server.getOutput(), {
      secrets: [roomCode, 'Alice', beforeDropMsg, afterReconnectGuestMsg, afterReconnectHostMsg],
    });
  });

  test('handles explicit Guest leave (re-open for new Guest with new E2EE keys) and Host leave (immediate expiry for Guest)', async ({
    browser,
  }) => {
    const server = await spawnProductionServer();
    const hostContext = await createIsolatedContext(browser);
    const guest1Context = await createIsolatedContext(browser);
    const guest2Context = await createIsolatedContext(browser);

    const firstGuestMsg = 'Primeira conversa efêmera';
    const secondGuestMsg = 'Segunda conversa após saída do primeiro convidado';
    let roomCode = '';

    try {
      const hostPage = await hostContext.newPage();
      const created = await createRoomAndGetInviteUrl(hostPage, server.baseUrl, {
        displayName: 'Anfitriã',
      });
      roomCode = created.roomCode;

      const guest1Page = await joinRoomViaInviteUrl(guest1Context, created.inviteUrl);
      const sas1Host = await readSasCode(hostPage);
      const sas1Guest = await readSasCode(guest1Page);
      expect(sas1Host).toBe(sas1Guest);

      await guest1Page.getByLabel('Mensagem efêmera', { exact: true }).fill(firstGuestMsg);
      await guest1Page.getByLabel('Mensagem efêmera', { exact: true }).press('Enter');
      await expect(
        hostPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(firstGuestMsg),
      ).toBeVisible();

      // Guest 1 explicitly leaves -> Host stays in room waiting
      await guest1Page.locator('header').getByRole('button', { name: 'Sair da sala' }).click();
      await guest1Page
        .getByRole('dialog', { name: 'Sair da sala?' })
        .getByRole('button', { name: 'Sair e limpar' })
        .click();

      await expect(guest1Page.getByRole('heading', { name: 'Entre ou crie uma sala' })).toBeVisible();
      await expect(hostPage.locator('[data-connection-status="waiting"]')).toBeVisible();

      // Fresh Guest 2 joins with invite link and negotiates new E2EE keys
      const guest2Page = await joinRoomViaInviteUrl(guest2Context, created.inviteUrl);
      await expect(hostPage.locator('header').getByText('2 pessoas online')).toBeVisible();

      const sas2Host = await readSasCode(hostPage);
      const sas2Guest = await readSasCode(guest2Page);
      expect(sas2Host).toBe(sas2Guest);
      expect(sas2Host).not.toBe(sas1Host);

      await guest2Page.getByLabel('Mensagem efêmera', { exact: true }).fill(secondGuestMsg);
      await guest2Page.getByLabel('Mensagem efêmera', { exact: true }).press('Enter');
      await expect(
        hostPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(secondGuestMsg),
      ).toBeVisible();

      // Host explicitly leaves -> Guest 2 immediately transitions to ExpiredRoomScreen
      await hostPage.locator('header').getByRole('button', { name: 'Sair da sala' }).click();
      await hostPage
        .getByRole('dialog', { name: 'Sair da sala?' })
        .getByRole('button', { name: 'Sair e limpar' })
        .click();

      await expect(hostPage.getByRole('heading', { name: 'Entre ou crie uma sala' })).toBeVisible();
      await expect(guest2Page.getByRole('heading', { name: 'Sala encerrada' })).toBeVisible();
      await expect(
        guest2Page.getByText(
          'O anfitrião encerrou a sala e todas as mensagens efêmeras foram removidas.',
        ),
      ).toBeVisible();
      await expect(guest2Page.getByText(secondGuestMsg)).toHaveCount(0);

      await assertZeroTrace(hostPage);
      await assertZeroTrace(guest1Page);
      await assertZeroTrace(guest2Page);
    } finally {
      await hostContext.close();
      await guest1Context.close();
      await guest2Context.close();
      await server.stop();
    }

    assertServerLogsZeroTrace(server.getOutput(), {
      secrets: [roomCode, 'Anfitriã', firstGuestMsg, secondGuestMsg],
    });
  });

  test('server-authoritative inactivity expiration (PULSO_INACTIVITY_MS=3500) purges both contexts', async ({
    browser,
  }) => {
    const server = await spawnProductionServer({ PULSO_INACTIVITY_MS: '3500' });
    const hostContext = await createIsolatedContext(browser);
    const guestContext = await createIsolatedContext(browser);

    const secretMessage = 'Mensagem que deve sumir na expiração autoritativa';
    let roomCode = '';

    try {
      const hostPage = await hostContext.newPage();
      const created = await createRoomAndGetInviteUrl(hostPage, server.baseUrl, {
        displayName: 'Alice',
      });
      roomCode = created.roomCode;

      const guestPage = await joinRoomViaInviteUrl(guestContext, created.inviteUrl);

      const guestComposer = guestPage.getByLabel('Mensagem efêmera', { exact: true });
      await guestComposer.fill(secretMessage);
      await guestComposer.press('Enter');

      await expect(
        hostPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(secretMessage),
      ).toBeVisible();

      // Wait passively for server timer (3.5s) to purge the room and notify both browsers
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
      secrets: [roomCode, 'Alice', secretMessage],
    });
  });

  test('Normal Mode: real two-context Video Call with fake media devices, remote stream, controls, and hangup', async ({
    browser,
  }) => {
    const server = await spawnProductionServer();
    const hostContext = await createIsolatedContext(browser);
    const guestContext = await createIsolatedContext(browser);

    let roomCode = '';

    try {
      const hostPage = await hostContext.newPage();
      const created = await createRoomAndGetInviteUrl(hostPage, server.baseUrl, {
        displayName: 'Alice',
      });
      roomCode = created.roomCode;

      const guestPage = await joinRoomViaInviteUrl(guestContext, created.inviteUrl);

      // Host opens video preview and enters call
      await hostPage.locator('header').getByRole('button', { name: 'Iniciar chamada de vídeo' }).click();
      const hostPreview = hostPage.getByRole('dialog', {
        name: 'Pré-visualização antes da chamada',
      });
      await expect(hostPreview).toBeVisible();
      await hostPreview.getByRole('button', { name: 'Entrar com vídeo' }).click();

      const hostStage = hostPage.locator('section[data-call-layout]');
      await expect(hostStage).toHaveAttribute('data-call-layout', 'hybrid');
      await expect(hostStage.getByText('Você com câmera ligada')).toBeVisible();

      // Guest joins call
      await guestPage.locator('header').getByRole('button', { name: 'Iniciar chamada de vídeo' }).click();
      const guestPreview = guestPage.getByRole('dialog', {
        name: 'Pré-visualização antes da chamada',
      });
      await expect(guestPreview).toBeVisible();
      await guestPreview.getByRole('button', { name: 'Entrar com vídeo' }).click();

      const guestStage = guestPage.locator('section[data-call-layout]');
      await expect(guestStage).toHaveAttribute('data-call-layout', 'hybrid');

      // WebRTC media stream connects between isolated contexts
      await expect(guestStage.locator('video[aria-label="Alice"]')).toBeVisible({
        timeout: 15_000,
      });

      // Toggle mic, camera, and layouts
      await hostStage.getByRole('button', { name: 'Silenciar microfone' }).click();
      await expect(hostStage.getByRole('button', { name: 'Ativar microfone' })).toBeVisible();
      await expect(guestPage.getByText('Alice silenciou o microfone')).toBeVisible();

      await hostStage.getByRole('button', { name: 'Desligar câmera' }).click();
      await expect(hostStage.getByText('Você com câmera desligada')).toBeVisible();

      await hostStage.getByRole('button', { name: 'Alternar layout' }).click();
      await hostStage.getByRole('menuitemradio', { name: 'Picture-in-Picture' }).click();
      await expect(hostStage).toHaveAttribute('data-call-layout', 'pip');

      await hostStage.getByRole('button', { name: 'Encerrar chamada' }).click();
      await expect(hostStage).toHaveCount(0);
      await expect(guestPage.getByText('Alice saiu da chamada de vídeo')).toBeVisible();

      await guestStage.getByRole('button', { name: 'Encerrar chamada' }).click();
      await expect(guestStage).toHaveCount(0);

      await assertZeroTrace(hostPage);
      await assertZeroTrace(guestPage);
    } finally {
      await hostContext.close();
      await guestContext.close();
      await server.stop();
    }

    assertServerLogsZeroTrace(server.getOutput(), {
      secrets: [roomCode, 'Alice'],
    });
  });

  test('Tor Mode runtime: locks UI to Tor, displays real .onion invite, blocks video on UI & server (tor_video_blocked)', async ({
    browser,
  }) => {
    const onionHost = `${'b'.repeat(56)}.onion`;
    const onionAddress = `http://${onionHost}`;
    const torServer = await startControlledTorServer(onionAddress);
    const hostContext = await createIsolatedContext(browser);
    const guestContext = await createIsolatedContext(browser);

    const torMessage = 'Mensagem cifrada exclusivamente sobre circuito Tor';
    const rogueRoomCode = 'T7R2-M9K4';
    let hostRoomCode = '';

    try {
      const hostPage = await hostContext.newPage();
      await hostPage.goto(torServer.baseUrl);

      await expect(hostPage.getByRole('radio', { name: /Modo Normal/i })).toBeDisabled();
      await expect(hostPage.getByRole('radio', { name: /Modo Tor/i })).toBeChecked();
      await expect(
        hostPage.getByText('Serviço .onion pronto para criar a Sala.'),
      ).toBeVisible();
      await expect(hostPage.getByText(onionAddress)).toBeVisible();

      const created = await createRoomAndGetInviteUrl(hostPage, torServer.baseUrl, {
        displayName: 'TorHost',
        skipGoto: true,
      });
      hostRoomCode = created.roomCode;

      expect(created.inviteUrl.startsWith(`${onionAddress}/?room=${hostRoomCode}&mode=tor#k=`)).toBe(
        true,
      );
      await expect(hostPage.locator('header').locator('[data-room-mode="tor"]')).toContainText(
        'Modo Tor',
      );
      await expect(hostPage.getByText(onionAddress).first()).toBeVisible();
      await expect(
        hostPage.getByText('Chamada de vídeo bloqueada no Modo Tor para proteger seu anonimato.'),
      ).toBeVisible();
      await expect(
        hostPage.locator('header').getByRole('button', { name: 'Iniciar chamada de vídeo' }),
      ).toBeDisabled();

      // Guest joins via invite params against local Tor runtime server
      const parsedInvite = new URL(created.inviteUrl);
      const guestUrl = `${torServer.baseUrl}${parsedInvite.pathname}${parsedInvite.search}${parsedInvite.hash}`;
      const guestPage = await joinRoomViaInviteUrl(guestContext, guestUrl);

      await expect(guestPage.locator('header').locator('[data-room-mode="tor"]')).toContainText(
        'Modo Tor',
      );
      await expect(
        guestPage.locator('header').getByRole('button', { name: 'Iniciar chamada de vídeo' }),
      ).toBeDisabled();

      const hostComposer = hostPage.getByLabel('Mensagem efêmera', { exact: true });
      await hostComposer.fill(torMessage);
      await hostComposer.press('Enter');

      await expect(
        guestPage.getByRole('log', { name: 'Mensagens efêmeras' }).getByText(torMessage),
      ).toBeVisible();

      // Server-side enforcement: rogue WebSocket client sending call_signal in a Tor room receives tor_video_blocked
      const rogueWsUrl = `${torServer.baseUrl.replace('http://', 'ws://')}/ws`;
      const blockedError = await new Promise<Extract<ServerWsMessage, { type: 'room_error' }>>(
        (resolve, reject) => {
          const ws = new WebSocket(rogueWsUrl);
          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Timed out waiting for tor_video_blocked'));
          }, 5000);

          ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });

          ws.on('open', () => {
            ws.send(
              JSON.stringify({
                type: 'create_room',
                version: WS_PROTOCOL_VERSION,
                roomCode: rogueRoomCode,
                displayName: 'Rogue',
                mode: 'tor',
                onionAddress,
              }),
            );
          });

          ws.on('message', (data) => {
            const msg = JSON.parse(data.toString('utf8')) as ServerWsMessage;
            if (msg.type === 'room_joined') {
              ws.send(
                JSON.stringify({
                  type: 'call_signal',
                  version: WS_PROTOCOL_VERSION,
                  signal: {
                    type: 'offer',
                    fromId: msg.participant.id,
                    payload: { type: 'offer', sdp: 'v=0' },
                  },
                }),
              );
              return;
            }
            if (msg.type === 'room_error') {
              clearTimeout(timeout);
              ws.close();
              resolve(msg);
            }
          });
        },
      );

      expect(blockedError.code).toBe('tor_video_blocked');

      await assertZeroTrace(hostPage);
      await assertZeroTrace(guestPage);
    } finally {
      await hostContext.close();
      await guestContext.close();
      await torServer.stop();
    }

    assertServerLogsZeroTrace(torServer.getOutput(), {
      allowLocalhostNotice: true,
      secrets: [hostRoomCode, rogueRoomCode, 'TorHost', 'Rogue', torMessage],
    });
  });
});
