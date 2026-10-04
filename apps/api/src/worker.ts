import { getBoss, QUEUE_MAINTENANCE, QUEUE_PROCESS, stopQueue } from './lib/queue';
import { runProcessingJob } from './services/processing';
import { runMaintenance } from './services/maintenance';
import { getOcr } from './services/providers';

/**
 * Separate worker process: PDF parsing/OCR never runs in the API process, so a malicious or
 * heavy PDF cannot block or crash request handling. Run more replicas to scale.
 */
async function main() {
  const boss = await getBoss();
  await boss.work<{ jobId: string }>(QUEUE_PROCESS, { batchSize: 1 }, async ([job]) => {
    if (job) await runProcessingJob(job.data.jobId);
  });
  await boss.schedule(QUEUE_MAINTENANCE, '*/15 * * * *');
  await boss.work(QUEUE_MAINTENANCE, async () => {
    const r = await runMaintenance();
    if (r.expiredDemo) console.info(`maintenance: removed ${r.expiredDemo} expired demo accounts`);
  });
  console.info('worker ready');
  const shutdown = async () => {
    await stopQueue();
    await getOcr().terminate?.();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
