import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { auditLogs, sessions, users } from '../src/db/schema';
import { Client, getApp } from './helpers';

let app: FastifyInstance;
beforeAll(async () => { app = await getApp(); });

describe('authentication', () => {
  it('requires explicit health-data consent and a non-trivial password', async () => {
    const c = new Client(app);
    const noConsent = await c.post('/api/auth/register', { email: 'a@example.com', password: 'correct horse battery 9', displayName: 'A', consentHealthData: false, consentVersion: 'x' });
    expect(noConsent.status).toBe(400);
    const weak = await c.post('/api/auth/register', { email: 'b@example.com', password: 'password123', displayName: 'B', consentHealthData: true, consentVersion: 'x' });
    expect(weak.status).toBe(400);
    expect(weak.json.code).toBe('weak_password');
  });

  it('stores only Argon2id hashes and hashed session tokens', async () => {
    const c = new Client(app);
    const { id, password } = await c.register();
    const [u] = await db.select().from(users).where(eq(users.id, id));
    expect(u!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(u!.passwordHash).not.toContain(password);
    const token = decodeURIComponent(c.cookie.split('=')[1]!);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, id));
    expect(rows.every((s) => s.tokenHash !== token && s.tokenHash.length === 64)).toBe(true);
  });

  it('sets an HttpOnly, SameSite session cookie', async () => {
    const c = new Client(app);
    const r = await c.post('/api/auth/register', { email: `c${Date.now()}@example.com`, password: 'correct horse battery 9', displayName: 'C', consentHealthData: true, consentVersion: 'x' });
    const cookie = String(r.raw.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('does not reveal whether an email exists on login or password reset', async () => {
    const c = new Client(app);
    const { email } = await c.register();
    const anon = new Client(app);
    const wrongPw = await anon.post('/api/auth/login', { email, password: 'wrong-password-123' });
    const noUser = await anon.post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong-password-123' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.json.message).toBe(noUser.json.message);
    const f1 = await anon.post('/api/auth/forgot', { email });
    const f2 = await anon.post('/api/auth/forgot', { email: 'nobody@example.com' });
    expect(f1.json).toEqual(f2.json);
  });

  it('locks the account after 5 failed attempts', async () => {
    const owner = new Client(app);
    const { email, password } = await owner.register();
    for (let i = 0; i < 5; i++) {
      const attacker = new Client(app); // different IPs → not just IP rate limiting
      await attacker.post('/api/auth/login', { email, password: `wrong-${i}-password` });
    }
    const r = await new Client(app).post('/api/auth/login', { email, password });
    expect(r.status).toBe(429);
    expect(r.json.code).toBe('locked');
  });

  it('rate-limits login attempts per IP', async () => {
    const c = new Client(app);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await c.post('/api/auth/login', { email: `x${i}@example.com`, password: 'whatever-123' })).status;
    expect(last).toBe(429);
  });

  it('logout invalidates the session server-side', async () => {
    const c = new Client(app);
    await c.register();
    const cookie = c.cookie;
    await c.post('/api/auth/logout');
    const stolen = new Client(app);
    stolen.cookie = cookie;
    expect((await stolen.get('/api/dashboard')).status).toBe(401);
  });

  it('password reset revokes all sessions', async () => {
    const c = new Client(app);
    const { email } = await c.register();
    // capture the token by reading the DB-issued token is impossible (hashed) – use the console email
    const logs: string[] = [];
    const orig = console.info;
    console.info = (m: string) => logs.push(m);
    await new Client(app).post('/api/auth/forgot', { email });
    console.info = orig;
    const token = logs.join('\n').match(/reset\?token=([\w-]+)/)?.[1];
    expect(token).toBeTruthy();
    const r = await new Client(app).post('/api/auth/reset', { token, password: 'another long passphrase 7' });
    expect(r.status).toBe(200);
    expect((await c.get('/api/dashboard')).status).toBe(401);
    // token is single-use
    expect((await new Client(app).post('/api/auth/reset', { token, password: 'yet another passphrase 8' })).status).toBe(400);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the CSRF token', async () => {
    const c = new Client(app);
    await c.register();
    const r = await c.req('POST', '/api/specialists', { name: 'Д-р Тест', specialty: 'Тест' }, { csrf: false });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('csrf');
  });

  it('rejects requests from a foreign Origin', async () => {
    const c = new Client(app);
    await c.register();
    const r = await c.req('POST', '/api/specialists', { name: 'Д-р Тест', specialty: 'Тест' }, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('bad_origin');
  });
});

describe('authorization – one user can NEVER access another user’s data (IDOR)', () => {
  let alice: Client;
  let bob: Client;
  let a: Awaited<ReturnType<Client['addReport']>>;
  let resultId: string;
  let specialistId: string;
  let noteId: string;
  let fileUrl: string;

  beforeAll(async () => {
    alice = new Client(app);
    bob = new Client(app);
    await alice.register();
    await bob.register();
    a = await alice.addReport('demo-2025-01-15-alpha.pdf');
    const rep = await alice.get(`/api/reports/${a.reportId}`);
    resultId = rep.json.results[0].id;
    specialistId = (await alice.post('/api/specialists', { name: 'Д-р А', specialty: 'Ендокринолог' })).json.id;
    noteId = (await alice.post('/api/notes', { targetType: 'general', targetId: null, body: 'лична бележка' })).json.id;
    fileUrl = (await alice.post(`/api/documents/${a.documentId}/url`, { disposition: 'inline' })).json.url;
  });

  it('alice can read her own data', async () => {
    expect((await alice.get(`/api/reports/${a.reportId}`)).status).toBe(200);
    expect((await alice.get(fileUrl)).status).toBe(200);
  });

  it.each([
    ['GET', () => `/api/reports/${a.reportId}`],
    ['PATCH', () => `/api/reports/${a.reportId}`],
    ['DELETE', () => `/api/reports/${a.reportId}`],
    ['PATCH', () => `/api/results/${resultId}`],
    ['DELETE', () => `/api/results/${resultId}`],
    ['GET', () => `/api/results/${resultId}/history`],
    ['GET', () => `/api/specialists/${specialistId}`],
    ['PATCH', () => `/api/specialists/${specialistId}`],
    ['DELETE', () => `/api/specialists/${specialistId}`],
    ['DELETE', () => `/api/notes/${noteId}`],
    ['PATCH', () => `/api/notes/${noteId}`],
    ['POST', () => `/api/documents/${a.documentId}/url`],
    ['DELETE', () => `/api/documents/${a.documentId}`],
    ['PATCH', () => `/api/documents/${a.documentId}`],
    ['GET', () => `/api/jobs/${a.jobId}`],
    ['GET', () => `/api/jobs/${a.jobId}/review`],
    ['POST', () => `/api/jobs/${a.jobId}/discard`],
    ['GET', () => `/api/reports/compare?a=${a.reportId}&b=${a.reportId}`],
  ])('bob gets 404 on %s %s', async (method, url) => {
    const body = method === 'PATCH' ? (url().includes('notes') ? { body: 'x' } : url().includes('results') ? { valueText: '1' } : { title: 'hacked', name: 'hacked' }) : method === 'POST' ? {} : undefined;
    const r = await bob.req(method, url(), body);
    expect(r.status).toBe(404);
  });

  it('bob cannot use alice’s signed file URL', async () => {
    expect((await bob.get(fileUrl)).status).toBe(404);
  });

  it('bob cannot link his report to alice’s specialist', async () => {
    const b = await bob.addReport('english-us-units.pdf');
    const r = await bob.patch(`/api/reports/${b.reportId}`, { specialistId });
    expect(r.status).toBe(404);
  });

  it('bob sees none of alice’s data in lists, search, dashboard, exports', async () => {
    const bm = await bob.get('/api/biomarkers');
    expect(bm.json.every((s: { latest: { reportId: string } }) => s.latest.reportId !== a.reportId)).toBe(true);
    expect((await bob.get('/api/biomarkers/uric_acid')).json.series.every((p: { reportId: string }) => p.reportId !== a.reportId)).toBe(true);
    const search = await bob.get('/api/search?q=Алфа');
    expect(search.json.reports).toHaveLength(0);
    const docs = await bob.get('/api/documents');
    expect(docs.json.items.some((d: { id: string }) => d.id === a.documentId)).toBe(false);
    const csv = await bob.get('/api/export/csv');
    expect(csv.raw.body).not.toContain('Синтетична лаборатория „Алфа“');
    expect((await bob.get('/api/specialists')).json).toHaveLength(0);
  });

  it('alice’s data is intact after bob’s attempts', async () => {
    const rep = await alice.get(`/api/reports/${a.reportId}`);
    expect(rep.status).toBe(200);
    expect(rep.json.report.title).toBe('Тест');
    expect((await alice.get(`/api/specialists/${specialistId}`)).json.specialist.name).toBe('Д-р А');
  });

  it('unauthenticated requests get 401', async () => {
    const anon = new Client(app);
    expect((await anon.get(`/api/reports/${a.reportId}`)).status).toBe(401);
    expect((await anon.get(fileUrl)).status).toBe(401);
    expect((await anon.get('/api/dashboard')).status).toBe(401);
  });
});

describe('roles – admins see metadata, never medical values', () => {
  it('normal users cannot reach admin endpoints', async () => {
    const c = new Client(app);
    await c.register();
    expect((await c.get('/api/admin/stats')).status).toBe(404);
  });

  it('admin stats contain only aggregate metadata', async () => {
    const c = new Client(app);
    const { id } = await c.register();
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, id));
    const r = await c.get('/api/admin/stats');
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.json) + JSON.stringify((await c.get('/api/admin/jobs/failed')).json);
    expect(text).not.toMatch(/mmol|µmol|valueText|originalName|Глюкоза/);
    expect((await c.req('PATCH', `/api/admin/users/${id}/role`, { role: 'superadmin' })).status).toBe(404); // superadmin only
  });
});

describe('audit log', () => {
  it('records critical actions without medical values', async () => {
    const c = new Client(app);
    const { id } = await c.register();
    await c.addReport('demo-2025-06-15-alpha.pdf');
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.subjectUserId, id));
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.register', 'document.upload', 'report.confirm']));
    expect(JSON.stringify(rows)).not.toMatch(/mmol|µmol|Глюкоза|Пикочна/);
  });
});
