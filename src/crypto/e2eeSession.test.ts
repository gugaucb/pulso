import { describe, expect, it } from 'vitest';
import { createE2eeSession } from './e2eeSession';

const SAS_FORMAT_REGEX = /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

describe('e2eeSession (Web Crypto ECDH P-256 + HKDF-SHA256 + AES-256-GCM)', () => {
  it('establishes directional keys and matching SAS between Host and Guest with #k', async () => {
    const roomCode = 'X9K2-P7M4';
    const secretKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const host = createE2eeSession({ role: 'host', roomCode, secretKey });
    const guest = createE2eeSession({ role: 'guest', roomCode, secretKey });

    expect(host.isReady()).toBe(false);
    expect(host.getSasCode()).toBeNull();

    const hostPub = await host.init();
    const guestPub = await guest.init();

    expect(hostPub.kty).toBe('EC');
    expect(hostPub.crv).toBe('P-256');
    expect(guestPub.kty).toBe('EC');
    expect(guestPub.crv).toBe('P-256');

    const hostSas = await host.completeKeyExchange(guestPub);
    const guestSas = await guest.completeKeyExchange(hostPub);

    expect(host.isReady()).toBe(true);
    expect(guest.isReady()).toBe(true);
    expect(hostSas).toMatch(SAS_FORMAT_REGEX);
    expect(hostSas).toBe(guestSas);
    expect(host.getSasCode()).toBe(hostSas);
    expect(guest.getSasCode()).toBe(guestSas);

    // Host -> Guest encryption & decryption
    const hostEnvelope = await host.encrypt('Segredo do anfitrião', {
      roomCode,
      senderId: 'host-1',
      senderName: 'Ana',
      senderRole: 'host',
    });

    expect(hostEnvelope.seq).toBe(1);
    expect(atob(hostEnvelope.ciphertext)).not.toContain('Segredo');
    const hostIv = base64ToBytes(hostEnvelope.iv);
    expect(hostIv.length).toBe(12);
    const hostIvView = new DataView(hostIv.buffer);
    expect(hostIvView.getUint32(0, false)).toBe(1); // host direction ID = 1
    expect(hostIvView.getBigUint64(4, false)).toBe(1n);

    expect(await guest.decrypt(hostEnvelope)).toBe('Segredo do anfitrião');

    // Guest -> Host encryption & decryption
    const guestEnvelope = await guest.encrypt('Resposta do convidado', {
      roomCode,
      senderId: 'guest-1',
      senderName: 'João',
      senderRole: 'guest',
    });

    expect(guestEnvelope.seq).toBe(1);
    const guestIv = base64ToBytes(guestEnvelope.iv);
    expect(guestIv.length).toBe(12);
    const guestIvView = new DataView(guestIv.buffer);
    expect(guestIvView.getUint32(0, false)).toBe(2); // guest direction ID = 2
    expect(guestIvView.getBigUint64(4, false)).toBe(1n);

    expect(await host.decrypt(guestEnvelope)).toBe('Resposta do convidado');

    host.destroy();
    guest.destroy();
  });

  it('rejects decryption and produces divergent SAS when #k mismatches or is missing on one side', async () => {
    const roomCode = 'A7K9-M2P4';
    const host = createE2eeSession({
      role: 'host',
      roomCode,
      secretKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    });
    const guestWrongK = createE2eeSession({
      role: 'guest',
      roomCode,
      secretKey: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    });
    const guestNoK = createE2eeSession({
      role: 'guest',
      roomCode,
    });

    const hostPub = await host.init();
    const guestWrongPub = await guestWrongK.init();
    const guestNoKPub = await guestNoK.init();

    const hostSas = await host.completeKeyExchange(guestWrongPub);
    const wrongKSas = await guestWrongK.completeKeyExchange(hostPub);
    expect(hostSas).not.toBe(wrongKSas);

    const envFromHost = await host.encrypt('Mensagem confidencial', {
      roomCode,
      senderId: 'host-1',
      senderName: 'Ana',
      senderRole: 'host',
    });
    await expect(guestWrongK.decrypt(envFromHost)).rejects.toThrow();

    // Also compare host with #k vs guest without #k
    const host2 = createE2eeSession({
      role: 'host',
      roomCode,
      secretKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    });
    const host2Pub = await host2.init();
    const host2Sas = await host2.completeKeyExchange(guestNoKPub);
    const noKSas = await guestNoK.completeKeyExchange(host2Pub);
    expect(host2Sas).not.toBe(noKSas);

    const env2 = await host2.encrypt('Só com #k', {
      roomCode,
      senderId: 'host-2',
      senderName: 'Ana',
      senderRole: 'host',
    });
    await expect(guestNoK.decrypt(env2)).rejects.toThrow();

    host.destroy();
    host2.destroy();
    guestWrongK.destroy();
    guestNoK.destroy();
  });

  it('produces divergent SAS when different ephemeral ECDH keys are exchanged (MITM detection)', async () => {
    const roomCode = 'B8N3-Q4R5';
    const host = createE2eeSession({ role: 'host', roomCode });
    const guest = createE2eeSession({ role: 'guest', roomCode });
    const mitmForHost = createE2eeSession({ role: 'guest', roomCode });
    const mitmForGuest = createE2eeSession({ role: 'host', roomCode });

    const hostPub = await host.init();
    const guestPub = await guest.init();
    const mitmHostSidePub = await mitmForHost.init();
    const mitmGuestSidePub = await mitmForGuest.init();

    const hostSas = await host.completeKeyExchange(mitmHostSidePub);
    const guestSas = await guest.completeKeyExchange(mitmGuestSidePub);
    await mitmForHost.completeKeyExchange(hostPub);
    await mitmForGuest.completeKeyExchange(guestPub);

    expect(hostSas).toMatch(SAS_FORMAT_REGEX);
    expect(guestSas).toMatch(SAS_FORMAT_REGEX);
    expect(hostSas).not.toBe(guestSas);

    host.destroy();
    guest.destroy();
    mitmForHost.destroy();
    mitmForGuest.destroy();
  });

  it('strictly rejects replay (seq <= lastSeenSeq), out-of-order envelopes, and tampered ciphertext/tag/AAD', async () => {
    const roomCode = 'C5D6-E7F8';
    const host = createE2eeSession({ role: 'host', roomCode });
    const guest = createE2eeSession({ role: 'guest', roomCode });

    const hostPub = await host.init();
    const guestPub = await guest.init();
    await host.completeKeyExchange(guestPub);
    await guest.completeKeyExchange(hostPub);

    const env1 = await host.encrypt('Msg 1', {
      roomCode,
      senderId: 'host-1',
      senderName: 'Ana',
      senderRole: 'host',
    });
    const env2 = await host.encrypt('Msg 2', {
      roomCode,
      senderId: 'host-1',
      senderName: 'Ana',
      senderRole: 'host',
    });
    const env3 = await host.encrypt('Msg 3', {
      roomCode,
      senderId: 'host-1',
      senderName: 'Ana',
      senderRole: 'host',
    });

    // Tampered ciphertext / GCM auth tag must be rejected
    const cipherBytes = base64ToBytes(env1.ciphertext);
    cipherBytes[0] ^= 0xff;
    await expect(
      guest.decrypt({ ...env1, ciphertext: bytesToBase64(cipherBytes) }),
    ).rejects.toThrow();

    // Tampered AAD (roomCode) or forged high seq must fail WITHOUT advancing lastSeenSeq
    await expect(guest.decrypt({ ...env1, roomCode: 'ZZZZ-ZZZZ' })).rejects.toThrow();
    await expect(guest.decrypt({ ...env1, seq: 99 })).rejects.toThrow();

    // Legitimate env1 still works (proving failed tampered high-seq didn't DoS seq=1)
    expect(await guest.decrypt(env1)).toBe('Msg 1');

    // Replay of env1 (seq === lastSeenSeq) must be rejected
    await expect(guest.decrypt(env1)).rejects.toThrow(/replay|out-of-order/i);

    // Deliver env3 (seq=3) -> succeeds, then out-of-order env2 (seq=2 <= 3) must be rejected
    expect(await guest.decrypt(env3)).toBe('Msg 3');
    await expect(guest.decrypt(env2)).rejects.toThrow(/replay|out-of-order/i);

    host.destroy();
    guest.destroy();
  });

  it('clears keys, SAS, and rejects operations after destroy()', async () => {
    const roomCode = 'H2J3-K4M5';
    const host = createE2eeSession({
      role: 'host',
      roomCode,
      secretKey: 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    });
    const guest = createE2eeSession({
      role: 'guest',
      roomCode,
      secretKey: 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    });

    const hostPub = await host.init();
    const guestPub = await guest.init();
    await host.completeKeyExchange(guestPub);
    await guest.completeKeyExchange(hostPub);

    const env = await host.encrypt('Antes de destruir', {
      roomCode,
      senderId: 'host-1',
      senderName: 'Ana',
      senderRole: 'host',
    });

    host.destroy();

    expect(host.isReady()).toBe(false);
    expect(host.getSasCode()).toBeNull();
    await expect(
      host.encrypt('Depois', {
        roomCode,
        senderId: 'host-1',
        senderName: 'Ana',
        senderRole: 'host',
      }),
    ).rejects.toThrow(/destroyed/i);
    await expect(host.decrypt(env)).rejects.toThrow(/destroyed/i);

    guest.destroy();
  });
});
