// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sanitizeRuntimeInfo } from './protocol';

describe('sanitizeRuntimeInfo', () => {
  it('validates publicOrigin as strict http/https origin, allows tunnelActive and tunnelProvider=cloudflare, and scopes turnConfigured to normal mode', () => {
    expect(
      sanitizeRuntimeInfo({
        runtimeMode: 'normal',
        publicOrigin: 'https://pulso-demo.trycloudflare.com/room/X9K2-P7M4?x=1#k=abc',
        tunnelActive: true,
        tunnelProvider: 'cloudflare',
        turnConfigured: true,
        extraSecret: 'leak',
      }),
    ).toEqual({
      runtimeMode: 'normal',
      publicOrigin: 'https://pulso-demo.trycloudflare.com',
      tunnelActive: true,
      tunnelProvider: 'cloudflare',
      turnConfigured: true,
    });

    expect(
      sanitizeRuntimeInfo({
        runtimeMode: 'normal',
        publicOrigin: 'http://127.0.0.1:3001/',
        tunnelActive: false,
        tunnelProvider: 'ngrok',
        turnConfigured: false,
      }),
    ).toEqual({
      runtimeMode: 'normal',
      publicOrigin: 'http://127.0.0.1:3001',
      tunnelActive: false,
      turnConfigured: false,
    });

    expect(
      sanitizeRuntimeInfo({
        runtimeMode: 'normal',
        publicOrigin: 'javascript:alert(1)',
        tunnelActive: 'yes',
        turnConfigured: 'true',
      }),
    ).toEqual({
      runtimeMode: 'normal',
    });

    expect(
      sanitizeRuntimeInfo({
        runtimeMode: 'normal',
        publicOrigin: 'ftp://files.example.com',
      }),
    ).toEqual({
      runtimeMode: 'normal',
    });

    expect(
      sanitizeRuntimeInfo({
        runtimeMode: 'tor',
        torStatus: 'ready',
        onionAddress: 'http://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.onion',
        turnConfigured: true,
      }),
    ).toEqual({
      runtimeMode: 'tor',
      torStatus: 'ready',
      onionAddress: 'http://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.onion',
    });
  });
});
