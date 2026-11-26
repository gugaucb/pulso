import { BroadcastChannelTransport } from './BroadcastChannelTransport';
import type { RoomTransport } from './RoomTransport';
import { WebSocketTransport } from './WebSocketTransport';

export interface CreateDefaultTransportOptions {
  search?: string;
  envTransport?: string;
}

/**
 * Creates the default RoomTransport for the application.
 * Uses WebSocketTransport by default and falls back to BroadcastChannelTransport
 * only when VITE_TRANSPORT=broadcast or ?transport=local is explicitly active.
 */
export function createDefaultTransport(
  options: CreateDefaultTransportOptions = {},
): RoomTransport {
  const envTransport = options.envTransport ?? import.meta.env.VITE_TRANSPORT;
  const search =
    options.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const params = new URLSearchParams(search);

  if (envTransport === 'broadcast' || params.get('transport') === 'local') {
    return new BroadcastChannelTransport();
  }

  return new WebSocketTransport();
}
