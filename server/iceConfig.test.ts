// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildIceServers, hasTurnConfigured } from './iceConfig';

describe('buildIceServers', () => {
  it('returns default Google STUN servers when no custom STUN_URLS or TURN_URLS are configured', () => {
    expect(buildIceServers({})).toEqual([
      {
        urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
      },
    ]);
  });

  it('overrides default STUN servers when STUN_URLS is provided and omits STUN when STUN_URLS is empty', () => {
    expect(
      buildIceServers({
        STUN_URLS: ' stun:stun.example.org:3478 , stun:stun2.example.org:3478 ',
      }),
    ).toEqual([
      {
        urls: ['stun:stun.example.org:3478', 'stun:stun2.example.org:3478'],
      },
    ]);

    expect(
      buildIceServers({
        STUN_URLS: '',
      }),
    ).toEqual([]);
  });

  it('adds static TURN server config when TURN_URLS, TURN_USERNAME, and TURN_CREDENTIAL are set', () => {
    expect(
      buildIceServers({
        TURN_URLS: 'turn:turn.example.org:3478?transport=udp, turns:turn.example.org:5349?transport=tcp',
        TURN_USERNAME: 'pulso-user',
        TURN_CREDENTIAL: 'static-pass',
      }),
    ).toEqual([
      {
        urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
      },
      {
        urls: [
          'turn:turn.example.org:3478?transport=udp',
          'turns:turn.example.org:5349?transport=tcp',
        ],
        username: 'pulso-user',
        credential: 'static-pass',
      },
    ]);
  });

  it('generates coturn REST ephemeral HMAC-SHA1 credentials when TURN_SECRET is provided', () => {
    const nowSeconds = 1_700_000_000;
    const servers = buildIceServers(
      {
        STUN_URLS: '',
        TURN_URLS: 'turn:coturn.example.org:3478',
        TURN_SECRET: 'super-secret-coturn-key',
      },
      nowSeconds,
    );

    expect(servers).toHaveLength(1);
    const turn = servers[0];
    expect(turn.urls).toEqual(['turn:coturn.example.org:3478']);
    expect(turn.username).toMatch(/^1700003600:[a-f0-9]+$/);
    const expectedCred = createHmac('sha1', 'super-secret-coturn-key')
      .update(turn.username!)
      .digest('base64');
    expect(turn.credential).toBe(expectedCred);
  });

  it('uses custom TURN_TTL_SECONDS for ephemeral credentials when valid', () => {
    const nowSeconds = 1_700_000_000;
    const servers = buildIceServers(
      {
        STUN_URLS: '',
        TURN_URLS: 'turn:coturn.example.org:3478',
        TURN_SECRET: 'key-123',
        TURN_TTL_SECONDS: '900',
      },
      nowSeconds,
    );

    expect(servers).toHaveLength(1);
    expect(servers[0].username).toMatch(/^1700000900:[a-f0-9]+$/);
    const expectedCred = createHmac('sha1', 'key-123')
      .update(servers[0].username!)
      .digest('base64');
    expect(servers[0].credential).toBe(expectedCred);
  });
});

describe('hasTurnConfigured', () => {
  it('detects turn: and turns: URLs while returning false for STUN-only or empty lists', () => {
    expect(hasTurnConfigured([])).toBe(false);
    expect(
      hasTurnConfigured([
        { urls: ['stun:stun.l.google.com:19302', 'stun:turn.example.org:3478'] },
      ]),
    ).toBe(false);
    expect(hasTurnConfigured([{ urls: 'turn:turn.example.org:3478?transport=udp' }])).toBe(true);
    expect(
      hasTurnConfigured([
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: [' TURNS:turn.example.org:5349?transport=tcp '] },
      ]),
    ).toBe(true);
  });
});
