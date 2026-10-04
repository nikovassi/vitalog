import PgBoss from 'pg-boss';
import { config } from '../config';

/** Job queue in PostgreSQL (pg-boss): retries, backoff, no extra infrastructure. */
export const QUEUE_PROCESS = 'process-document';
export const QUEUE_MAINTENANCE = 'maintenance';

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  const b = new PgBoss({ connectionString: config.DATABASE_URL, schema: 'pgboss' });
  b.on('error', (e) => console.error('queue error', e.message));
  await b.start();
  await b.createQueue(QUEUE_PROCESS, { name: QUEUE_PROCESS, retryLimit: 2, retryDelay: 10, retryBackoff: true, expireInSeconds: 600 });
  await b.createQueue(QUEUE_MAINTENANCE, { name: QUEUE_MAINTENANCE });
  boss = b;
  return b;
}

export async function enqueueProcessing(jobId: string) {
  await (await getBoss()).send(QUEUE_PROCESS, { jobId }, { singletonKey: jobId });
}

export async function stopQueue() {
  await boss?.stop({ graceful: true });
  boss = null;
}
