import { runMigrations } from './migrate';
import { sqlClient } from './client';
import { createSeedUser } from '../demo/seed-user';

/**
 * Local development seed: a SYNTHETIC demo account with 5 lab reports, 30+ biomarkers,
 * specialists, documents and a pending review. Credentials come from .env (SEED_DEMO_*).
 */
async function main() {
  const email = process.env.SEED_DEMO_EMAIL;
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!email || !password) throw new Error('Set SEED_DEMO_EMAIL and SEED_DEMO_PASSWORD in .env (see .env.example).');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');
  await runMigrations();
  await createSeedUser(email.toLowerCase(), password);
  console.log(`Seeded synthetic demo account ${email} (password from .env).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => sqlClient.end());
