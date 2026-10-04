/**
 * Records the API responses of a fresh SYNTHETIC demo account into
 * apps/web/public/demo-data/ so the frontend can run as a static demo (GitHub Pages).
 * No real data: the demo account is generated from fixtures/synthetic specs.
 *
 * Run: npm run static-demo:snapshot   (needs the local Postgres from docker-compose)
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app';
import { runMigrations } from '../src/db/migrate';
import { sqlClient } from '../src/db/client';
import { stopQueue } from '../src/lib/queue';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/demo-data');

async function main() {
  await runMigrations();
  const app = await buildApp();
  await app.ready();
  let cookie = '';
  let csrf = '';
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.inject({ method: method as 'GET', url, headers: { origin: 'http://localhost:5173', ...(cookie && { cookie }), ...(csrf && { 'x-csrf-token': csrf }) }, ...(body !== undefined && { payload: body as object }) });
    const set = res.headers['set-cookie'];
    if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(';')[0]!;
    if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body.slice(0, 200)}`);
    return res;
  };
  const json = async (url: string) => (await call('GET', url)).json();

  const me = (await call('POST', '/api/auth/demo')).json();
  csrf = me.csrfToken;
  const snap: Record<string, unknown> = {};
  const rec = async (url: string) => { snap[url] = await json(url); return snap[url] as any; }; // eslint-disable-line @typescript-eslint/no-explicit-any

  snap['/api/auth/me'] = { ...me, csrfToken: 'static-demo' };
  await rec('/api/dashboard');
  const biomarkers = await rec('/api/biomarkers?sort=newest&status=all');
  for (const b of biomarkers) await rec(`/api/biomarkers/${encodeURIComponent(b.id)}`);
  const reports = await rec('/api/reports?page=1&pageSize=100&sort=newest');
  for (const r of reports.items) await rec(`/api/reports/${r.id}`);
  const sorted = [...reports.items].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) await rec(`/api/reports/compare?a=${sorted[i].id}&b=${sorted[j].id}`);
  const jobs = await rec('/api/jobs');
  for (const j of jobs) { await rec(`/api/jobs/${j.id}`); if (j.stage === 'review_required') await rec(`/api/jobs/${j.id}/review`); }
  await rec('/api/catalog');
  const specs = await rec('/api/specialists');
  for (const s of specs) await rec(`/api/specialists/${s.id}`);
  const docs = await rec('/api/documents?pageSize=100');
  for (const u of ['/api/timeline?limit=200', '/api/notifications', '/api/shares', '/api/events', '/api/account/privacy', '/api/auth/sessions', '/api/account/activity']) await rec(u);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'docs'), { recursive: true });
  for (const d of docs.items) {
    const { url } = (await call('POST', `/api/documents/${d.id}/url`, { disposition: 'inline' })).json();
    await writeFile(path.join(OUT, 'docs', `${d.id}.pdf`), (await call('GET', url)).rawPayload);
  }
  await writeFile(path.join(OUT, 'snapshot.json'), JSON.stringify(snap));
  console.log(`Static demo snapshot: ${Object.keys(snap).length} responses, ${docs.items.length} PDFs → ${OUT}`);
  await app.close();
  await stopQueue();
  await sqlClient.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
