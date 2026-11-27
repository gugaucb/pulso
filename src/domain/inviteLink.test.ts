import { describe, expect, it } from 'vitest';
import { buildInviteUrl, parseInviteUrl } from './inviteLink';

describe('inviteLink domain utilities', () => {
  it('builds a standard invite URL with room code and secret fragment', () => {
    const url = buildInviteUrl({
      origin: 'https://pulso.example',
      roomCode: 'x9k2p7m4',
      secretKey: 'superSecret256BitKey',
    });

    expect(url).toBe('https://pulso.example/?room=X9K2-P7M4#k=superSecret256BitKey');
  });

  it('builds a Tor invite URL when mode is tor and onionAddress is provided', () => {
    const url = buildInviteUrl({
      origin: 'https://pulso.example',
      roomCode: 'A7K9-M2P4',
      secretKey: 'abc123',
      mode: 'tor',
      onionAddress: 'http://pulsoabc123.onion',
    });

    expect(url).toBe('http://pulsoabc123.onion/?room=A7K9-M2P4&mode=tor#k=abc123');
  });

  it('parses /?room=XXXX-XXXX#k=... invite URLs and normalizes lowercase codes', () => {
    const parsed = parseInviteUrl('https://pulso.example/?room=x9k2p7m4#k=secretKey123');

    expect(parsed).toEqual({
      roomCode: 'X9K2-P7M4',
      secretKey: 'secretKey123',
      mode: 'normal',
      onionAddress: undefined,
    });
  });

  it('parses /s/XXXX-XXXX#k=... short invite URLs', () => {
    const parsed = parseInviteUrl('https://pulso.example/s/a7k9-m2p4#k=key999');

    expect(parsed).toEqual({
      roomCode: 'A7K9-M2P4',
      secretKey: 'key999',
      mode: 'normal',
      onionAddress: undefined,
    });
  });

  it('returns null for missing or invalid room codes', () => {
    expect(parseInviteUrl('https://pulso.example/')).toBeNull();
    expect(parseInviteUrl('https://pulso.example/?room=BAD0-CODE#k=abc')).toBeNull();
    expect(parseInviteUrl('https://pulso.example/s/SHORT')).toBeNull();
  });

  it('parses Tor mode invite links with ?mode=tor or &onion= query parameters', () => {
    const v3Host = `${'b'.repeat(56)}.onion`;
    const modeOnly = parseInviteUrl('https://pulso.example/?room=A7K9-M2P4&mode=tor#k=torKey1');
    expect(modeOnly).toEqual({
      roomCode: 'A7K9-M2P4',
      secretKey: 'torKey1',
      mode: 'tor',
      onionAddress: undefined,
    });

    const withOnionParam = parseInviteUrl(
      `https://pulso.example/?room=A7K9-M2P4&onion=${v3Host}#k=torKey2`,
    );
    expect(withOnionParam).toEqual({
      roomCode: 'A7K9-M2P4',
      secretKey: 'torKey2',
      mode: 'tor',
      onionAddress: `http://${v3Host}`,
    });

    const onionOrigin = parseInviteUrl(`http://${v3Host}/?room=A7K9-M2P4&mode=tor#k=torKey3`);
    expect(onionOrigin).toEqual({
      roomCode: 'A7K9-M2P4',
      secretKey: 'torKey3',
      mode: 'tor',
      onionAddress: `http://${v3Host}`,
    });
  });

  it('uses publicOrigin in normal mode only when tunnelActive is true and falls back to origin otherwise', () => {
    expect(
      buildInviteUrl({
        origin: 'http://127.0.0.1:3001',
        roomCode: 'A7K9-M2P4',
        secretKey: 'sec123',
        mode: 'normal',
        tunnelActive: true,
        publicOrigin: 'https://brisk-otter.trycloudflare.com/',
      }),
    ).toBe('https://brisk-otter.trycloudflare.com/?room=A7K9-M2P4#k=sec123');

    expect(
      buildInviteUrl({
        origin: 'http://127.0.0.1:3001',
        roomCode: 'A7K9-M2P4',
        secretKey: 'sec123',
        mode: 'normal',
        tunnelActive: false,
        publicOrigin: 'https://brisk-otter.trycloudflare.com',
      }),
    ).toBe('http://127.0.0.1:3001/?room=A7K9-M2P4#k=sec123');

    expect(
      buildInviteUrl({
        origin: 'http://127.0.0.1:3001',
        roomCode: 'A7K9-M2P4',
        secretKey: 'sec123',
        mode: 'normal',
        tunnelActive: true,
        publicOrigin: 'javascript:alert(1)',
      }),
    ).toBe('http://127.0.0.1:3001/?room=A7K9-M2P4#k=sec123');
  });
});
