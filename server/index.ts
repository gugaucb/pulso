import { createServer } from './app';
import { logOperationalNotice } from './security';

const DEFAULT_PORT = 3001;

function resolvePort(): number {
  const raw = process.env.PORT;
  if (!raw) return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

async function main(): Promise<void> {
  const host = process.env.HOST ?? '0.0.0.0';
  const port = resolvePort();
  const app = await createServer();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logOperationalNotice({ event: 'server_stopping' });
    try {
      await app.close();
    } finally {
      logOperationalNotice({ event: 'server_stopped' });
      process.exit(0);
    }
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await app.listen({ host, port });
  const addressInfo = app.server.address();
  const actualPort =
    addressInfo && typeof addressInfo === 'object' ? addressInfo.port : port;
  logOperationalNotice({ event: 'server_listening', port: actualPort });
}

main().catch((err) => {
  const code =
    err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
      ? err.code
      : undefined;
  logOperationalNotice({ event: 'server_start_failed', code });
  process.exit(1);
});
