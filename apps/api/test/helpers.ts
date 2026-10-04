import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { db } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { runProcessingJob } from '../src/services/processing';

export const ORIGIN = 'http://localhost:5173';
export const FIXTURES = path.resolve(__dirname, '../../../fixtures/pdfs');

let app: FastifyInstance | null = null;
export async function getApp() {
  if (app) return app;
  await runMigrations();
  await db.execute(sql`truncate users, audit_logs, biomarker_aliases restart identity cascade`);
  await runMigrations(); // re-sync aliases
  app = await buildApp();
  await app.ready();
  return app;
}

let ipCounter = 10;
/** A browser-like client: cookie jar, CSRF header, Origin header, its own IP. */
export class Client {
  cookie = '';
  csrf = '';
  ip = `10.0.${ipCounter++}.1`;
  constructor(private app: FastifyInstance) {}

  async req(method: string, url: string, body?: unknown, opts: { csrf?: boolean; origin?: string | null; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...opts.headers };
    if (this.cookie) headers.cookie = this.cookie;
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    if (method !== 'GET' && opts.csrf !== false && this.csrf) headers['x-csrf-token'] = this.csrf;
    const res = await this.app.inject({ method: method as 'GET', url, headers, remoteAddress: this.ip, ...(body !== undefined ? { payload: body as object } : {}) });
    const set = res.headers['set-cookie'];
    const cookies = Array.isArray(set) ? set : set ? [set] : [];
    for (const c of cookies) {
      const [pair] = c.split(';');
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) this.cookie = '';
      else if (pair) this.cookie = pair;
    }
    let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { json = res.json(); } catch { /* binary */ }
    if (json?.csrfToken) this.csrf = json.csrfToken;
    return { status: res.statusCode, json, raw: res };
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b: unknown = {}) => this.req('POST', u, b);
  patch = (u: string, b: unknown) => this.req('PATCH', u, b);
  del = (u: string) => this.req('DELETE', u);

  async register(email = `u${Math.random().toString(36).slice(2)}@example.com`, password = 'correct horse battery 9') {
    const r = await this.post('/api/auth/register', { email, password, displayName: 'Тест', consentHealthData: true, consentVersion: '2026-10-01' });
    if (r.status !== 200) throw new Error(`register failed ${r.status} ${JSON.stringify(r.json)}`);
    return { email, password, id: r.json.user.id as string };
  }

  async uploadFile(file: string, url = '/api/uploads', fields: Record<string, string> = {}) {
    const data = await readFile(path.join(FIXTURES, file));
    const boundary = '----vitalogtest' + Math.random().toString(16).slice(2);
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file}"\r\nContent-Type: application/pdf\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`));
    return this.req('POST', url, Buffer.concat(parts), { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
  }

  /** Upload + process synchronously (no worker) + confirm all candidates. */
  async addReport(file: string, collectedAt?: string) {
    const up = await this.uploadFile(file);
    if (up.status !== 202) throw new Error(`upload ${up.status} ${JSON.stringify(up.json)}`);
    await runProcessingJob(up.json.jobId);
    const rv = await this.get(`/api/jobs/${up.json.jobId}/review`);
    const c = await this.post(`/api/jobs/${up.json.jobId}/confirm`, {
      meta: { collectedAt: collectedAt ?? rv.json.meta.collectedAt, title: 'Тест', reportType: 'blood', laboratoryName: rv.json.meta.laboratoryName, specialistId: null },
      candidates: rv.json.candidates.filter((x: any) => !x.valueText.includes('?')).map((x: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        id: x.id, decision: 'accepted', biomarkerId: x.biomarkerId, originalName: x.originalName, valueText: x.valueText, unit: x.unit,
        referenceRange: x.referenceRange ? { low: x.referenceRange.low, high: x.referenceRange.high } : null,
      })),
    });
    if (c.status !== 200) throw new Error(`confirm ${c.status} ${JSON.stringify(c.json)}`);
    return { jobId: up.json.jobId as string, documentId: up.json.documentId as string, reportId: c.json.reportId as string, review: rv.json };
  }
}
