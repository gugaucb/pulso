import { describe, expect, it } from 'vitest';
import { BroadcastChannelTransport } from './BroadcastChannelTransport';
import { createDefaultTransport } from './createDefaultTransport';
import { WebSocketTransport } from './WebSocketTransport';

describe('createDefaultTransport', () => {
  it('defaults to WebSocketTransport when no local override is set', () => {
    const transport = createDefaultTransport({ search: '', envTransport: undefined });
    expect(transport).toBeInstanceOf(WebSocketTransport);
    transport.dispose();
  });

  it('uses BroadcastChannelTransport when ?transport=local is present', () => {
    const transport = createDefaultTransport({ search: '?transport=local', envTransport: undefined });
    expect(transport).toBeInstanceOf(BroadcastChannelTransport);
    transport.dispose();
  });

  it('uses BroadcastChannelTransport when VITE_TRANSPORT=broadcast', () => {
    const transport = createDefaultTransport({ search: '', envTransport: 'broadcast' });
    expect(transport).toBeInstanceOf(BroadcastChannelTransport);
    transport.dispose();
  });
});
