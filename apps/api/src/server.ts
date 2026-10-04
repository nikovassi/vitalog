import { buildApp } from './app';
import { config } from './config';
import { getBoss, stopQueue } from './lib/queue';
import { sqlClient } from './db/client';

const app = await buildApp();
await getBoss(); // producer side of the queue
await app.listen({ port: config.PORT, host: config.HOST });

const shutdown = async () => {
  await app.close();
  await stopQueue();
  await sqlClient.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
