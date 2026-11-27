import { createServer } from './app';
import { resolvePort } from './config';
import { logOperationalNotice } from './security';

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
