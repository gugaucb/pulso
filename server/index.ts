import { createServer } from './app';

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
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await app.listen({ host, port });
  console.info(`PULSO server listening on http://${host}:${port}`);
}

main().catch((err) => {
  console.error('Failed to start PULSO server:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
