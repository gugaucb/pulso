// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WS_PROTOCOL_VERSION } from '../shared/protocol';
import { createE2eeSession } from '../src/crypto/e2eeSession';
import { buildInviteUrl, parseInviteUrl } from '../src/domain/inviteLink';
import type { TransportEvent } from '../src/domain/types';
import { WebSocketTransport, type WebSocketLike } from '../src/transport/WebSocketTransport';
import { createServer } from './app';
import { ManualClock } from './clock';

function createObservedWsClient(wsUrl: string) {
  const sentFrames: string[] = [];
  const receivedFrames: string[] = [];

  const transport = new WebSocketTransport({
    url: wsUrl,
    webSocketFactory: (url) => {
      const ws = new globalThis.WebSocket(url);
      ws.addEventListener('message', (event) => {
        if (typeof event.data === 'string') {
          receivedFrames.push(event.data);
        }
      });
      return {
        get readyState() {
          return ws.readyState;
        },
        send(data: string) {
          sentFrames.push(data);
          ws.send(data);
        },
        close(code?: number, reason?: string) {
          ws.close(code, reason);
        },
        addEventListener(type: string, listener: (event: never) => void) {
          ws.addEventListener(type, listener);
        },
        removeEventListener(type: string, listener: (event: never) => void) {
          ws.removeEventListener(type, listener);
        },
      } as WebSocketLike;
    },
  });

  const events: TransportEvent[] = [];
  transport.subscribe((event) => events.push(event));

  return { transport, events, sentFrames, receivedFrames };
}

async function waitForEvent<T extends TransportEvent['type']>(
  events: TransportEvent[],
  type: T,
  timeoutMs = 3000,
): Promise<Extract<TransportEvent, { type: T }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find((e): e is Extract<TransportEvent, { type: T }> => e.type === type);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timed out waiting for transport event: ${type}`);
}

describe('PULSO Fastify server HTTP + WebSocket integration', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  it('serves /healthz, /api/runtime, static assets, and SPA fallback while hiding server bundle', async () => {
    const tempDist = mkdtempSync(join(tmpdir(), 'pulso-dist-'));
    mkdirSync(join(tempDist, 'server'), { recursive: true });
    writeFileSync(join(tempDist, 'index.html'), '<!doctype html><html><body>PULSO_SPA</body></html>');
    writeFileSync(join(tempDist, 'app.js'), 'console.log("client");');
    writeFileSync(join(tempDist, 'server', 'index.js'), 'SECRET_SERVER_CODE');
    cleanups.push(() => rmSync(tempDist, { recursive: true, force: true }));

    const app = await createServer({
      clock: new ManualClock(1_700_000_000_000),
      staticDir: tempDist,
    });
    cleanups.push(() => app.close());

    const address = await app.listen({ host: '127.0.0.1', port: 0 });

    const healthRes = await fetch(`${address}/healthz`);
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toEqual({ ok: true });

    const runtimeRes = await fetch(`${address}/api/runtime`);
    expect(runtimeRes.status).toBe(200);
    expect(await runtimeRes.json()).toEqual({ runtimeMode: 'normal', turnConfigured: false });

    const spaRes = await fetch(`${address}/room/X9K2-P7M4`);
    expect(spaRes.status).toBe(200);
    expect(await spaRes.text()).toContain('PULSO_SPA');

    const assetRes = await fetch(`${address}/app.js`);
    expect(assetRes.status).toBe(200);
    expect(await assetRes.text()).toContain('client');

    const serverBundleRes = await fetch(`${address}/server/index.js`);
    expect(serverBundleRes.status).toBe(404);

    const api404 = await fetch(`${address}/api/unknown`);
    expect(api404.status).toBe(404);
  });

  it('runs full 1:1 E2EE flow over real WebSocketTransport (create_room, join by #k, key_exchange, bidirectional messages without senderName, typing, room_not_found, room_full)', async () => {
    const app = await createServer({
      clock: new ManualClock(1_700_000_000_000),
    });
    cleanups.push(() => app.close());

    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const wsUrl = `${address.replace('http://', 'ws://')}/ws`;

    // Unknown room returns room_not_found
    const lostGuest = createObservedWsClient(wsUrl);
    cleanups.push(() => lostGuest.transport.dispose());
    await lostGuest.transport.joinRoom({ roomCode: 'A7K9-M2P4', displayName: 'Perdido' });
    const notFound = await waitForEvent(lostGuest.events, 'room_error');
    expect(notFound.code).toBe('room_not_found');

    // Host creates room
    const host = createObservedWsClient(wsUrl);
    const guest = createObservedWsClient(wsUrl);
    const intruder = createObservedWsClient(wsUrl);
    cleanups.push(() => host.transport.dispose());
    cleanups.push(() => guest.transport.dispose());
    cleanups.push(() => intruder.transport.dispose());

    const roomCode = 'X9K2-P7M4';
    const secretKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const inviteUrl = buildInviteUrl({
      origin: address,
      roomCode,
      secretKey,
      mode: 'normal',
    });
    const parsedInvite = parseInviteUrl(inviteUrl)!;
    expect(parsedInvite.roomCode).toBe(roomCode);
    expect(parsedInvite.secretKey).toBe(secretKey);

    await host.transport.createRoom({
      roomCode,
      displayName: 'Ana',
      mode: 'normal',
    });
    const hostJoined = await waitForEvent(host.events, 'room_joined');

    // Guest joins using parsed roomCode & #k
    await guest.transport.joinRoom({
      roomCode: parsedInvite.roomCode,
      displayName: 'João',
    });
    const guestJoined = await waitForEvent(guest.events, 'room_joined');
    await waitForEvent(host.events, 'participant_joined');

    // 3rd entrant is rejected with room_full
    await intruder.transport.joinRoom({
      roomCode,
      displayName: 'Intruso',
    });
    const fullErr = await waitForEvent(intruder.events, 'room_error');
    expect(fullErr.code).toBe('room_full');

    // Typing indicator relay
    await host.transport.setTyping(true);
    const typingEvent = await waitForEvent(guest.events, 'typing');
    expect(typingEvent.isTyping).toBe(true);
    expect(typingEvent.participantId).toBe(hostJoined.participant.id);

    // E2EE key exchange over real WebSocket
    const hostE2ee = createE2eeSession({
      role: 'host',
      roomCode,
      secretKey,
    });
    const guestE2ee = createE2eeSession({
      role: 'guest',
      roomCode,
      secretKey: parsedInvite.secretKey,
    });
    cleanups.push(() => hostE2ee.destroy());
    cleanups.push(() => guestE2ee.destroy());

    const hostPub = await hostE2ee.init();
    const guestPub = await guestE2ee.init();

    await host.transport.sendKeyExchange(hostPub, { hasSecret: true });
    await guest.transport.sendKeyExchange(guestPub, { hasSecret: true });

    const guestSawHostKey = await waitForEvent(guest.events, 'key_exchange');
    const hostSawGuestKey = await waitForEvent(host.events, 'key_exchange');

    const hostSas = await hostE2ee.completeKeyExchange(hostSawGuestKey.publicKeyJwk, {
      useSecretKey: true,
    });
    const guestSas = await guestE2ee.completeKeyExchange(guestSawHostKey.publicKeyJwk, {
      useSecretKey: true,
    });
    expect(hostSas).toBe(guestSas);

    // Bidirectional encrypted messages
    const hostPlain = 'Mensagem secreta do anfitrião via WS';
    const hostEnvelope = await hostE2ee.encrypt(hostPlain, {
      roomCode,
      senderId: hostJoined.participant.id,
      senderRole: 'host',
    });
    await host.transport.sendEncryptedMessage(hostEnvelope);

    const guestReceived = await waitForEvent(guest.events, 'encrypted_message');
    expect(await guestE2ee.decrypt(guestReceived.envelope)).toBe(hostPlain);

    const guestPlain = 'Resposta secreta do convidado via WS';
    const guestEnvelope = await guestE2ee.encrypt(guestPlain, {
      roomCode,
      senderId: guestJoined.participant.id,
      senderRole: 'guest',
    });
    await guest.transport.sendEncryptedMessage(guestEnvelope);

    const hostReceived = await waitForEvent(host.events, 'encrypted_message');
    expect(await hostE2ee.decrypt(hostReceived.envelope)).toBe(guestPlain);

    // Wire inspection: NO plaintext and NO senderName in any encrypted_message frame
    const wireEncryptedFrames = [
      ...host.sentFrames,
      ...guest.sentFrames,
      ...host.receivedFrames,
      ...guest.receivedFrames,
    ]
      .map((raw) => JSON.parse(raw) as { type: string; version: number; envelope?: Record<string, unknown> })
      .filter((msg) => msg.type === 'encrypted_message');

    expect(wireEncryptedFrames).toHaveLength(4);
    for (const frame of wireEncryptedFrames) {
      expect(frame.version).toBe(WS_PROTOCOL_VERSION);
      expect(frame.envelope).toBeDefined();
      expect(frame.envelope).not.toHaveProperty('senderName');
      const serialized = JSON.stringify(frame);
      expect(serialized).not.toContain(hostPlain);
      expect(serialized).not.toContain(guestPlain);
      expect(serialized).not.toContain('Ana');
      expect(serialized).not.toContain('João');
    }
  });
});
