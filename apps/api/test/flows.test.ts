import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { documents, labResults, resultEdits, users } from '../src/db/schema';
import { runProcessingJob } from '../src/services/processing';
import { Client, getApp } from './helpers';

let app: FastifyInstance;
beforeAll(async () => { app = await getApp(); });

describe('upload validation (OWASP file upload)', () => {
  it('rejects non-PDF content even with a .pdf name', async () => {
    const c = new Client(app);
    await c.register();
    const r = await c.uploadFile('not-a-pdf.pdf');
    expect(r.status).toBe(415);
    expect(r.json.code).toBe('not_pdf');
  });

  it('rejects duplicates and points to the existing report', async () => {
    const c = new Client(app);
    await c.register();
    const first = await c.addReport('demo-2025-01-15-alpha.pdf');
    const dup = await c.uploadFile('demo-2025-01-15-alpha.pdf');
    expect(dup.status).toBe(409);
    expect(dup.json.reportId).toBe(first.reportId);
  });

  it('never stores the file in plaintext or under the user-supplied name', async () => {
    const c = new Client(app);
    await c.register();
    const { documentId } = await c.addReport('demo-2025-06-15-alpha.pdf');
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
    expect(doc!.storageKey).toMatch(/^u\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    const { readFile } = await import('node:fs/promises');
    const blob = await readFile(path.resolve(process.cwd(), '../../storage/test-files', doc!.storageKey));
    expect(blob.subarray(0, 5).toString()).not.toBe('%PDF-');
  });

  it.each([
    ['encrypted.pdf', 'encrypted_pdf'],
    ['corrupted.pdf', 'invalid_pdf'],
    ['scanned-bg.pdf', 'no_text'], // OCR disabled in tests
    ['no-results.pdf', 'unrecognized_document'],
  ])('%s → job fails with %s and a notification', async (file, code) => {
    const c = new Client(app);
    await c.register();
    const up = await c.uploadFile(file);
    expect(up.status).toBe(202);
    await runProcessingJob(up.json.jobId);
    const job = await c.get(`/api/jobs/${up.json.jobId}`);
    expect(job.json.stage).toBe('failed');
    expect(job.json.errorCode).toBe(code);
    const n = await c.get('/api/notifications');
    expect(n.json.items[0].kind).toBe('processing_failed');
  });
});

describe('human review is mandatory', () => {
  it('nothing is stored before confirmation', async () => {
    const c = new Client(app);
    const { id } = await c.register();
    const up = await c.uploadFile('demo-2025-10-10-beta.pdf');
    await runProcessingJob(up.json.jobId);
    const rows = await db.select().from(labResults).where(eq(labResults.userId, id));
    expect(rows).toHaveLength(0);
    const review = await c.get(`/api/jobs/${up.json.jobId}/review`);
    expect(review.json.candidates).toHaveLength(19);
    expect(review.json.meta.collectedAt).toBe('2025-10-10');
  });

  it('refuses to save unreadable values', async () => {
    const c = new Client(app);
    await c.register();
    const up = await c.uploadFile('edge-cases.pdf');
    await runProcessingJob(up.json.jobId);
    const rv = await c.get(`/api/jobs/${up.json.jobId}/review`);
    const bad = rv.json.candidates.find((x: { valueText: string }) => x.valueText === '4?2');
    const r = await c.post(`/api/jobs/${up.json.jobId}/confirm`, {
      meta: { collectedAt: '2025-05-05', title: 'T', reportType: 'blood', laboratoryName: null, specialistId: null },
      candidates: [{ id: bad.id, decision: 'accepted', biomarkerId: 'uric_acid', originalName: bad.originalName, valueText: '4?2', unit: 'µmol/L', referenceRange: null }],
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('unreadable_value');
  });

  it('keeps an audit trail of corrections made during review and later', async () => {
    const c = new Client(app);
    await c.register();
    const up = await c.uploadFile('edge-cases.pdf');
    await runProcessingJob(up.json.jobId);
    const rv = await c.get(`/api/jobs/${up.json.jobId}/review`);
    const ua = rv.json.candidates.find((x: { valueText: string }) => x.valueText === '4?2');
    const conf = await c.post(`/api/jobs/${up.json.jobId}/confirm`, {
      meta: { collectedAt: '2025-05-05', title: 'T', reportType: 'blood', laboratoryName: null, specialistId: null },
      candidates: [{ id: ua.id, decision: 'accepted', biomarkerId: 'uric_acid', originalName: ua.originalName, valueText: '412', unit: 'µmol/L', referenceRange: { low: 202, high: 416 } }],
    });
    expect(conf.status).toBe(200);
    const rep = await c.get(`/api/reports/${conf.json.reportId}`);
    const res = rep.json.results[0];
    expect(res).toMatchObject({ valueText: '412', valueNumeric: 412, edited: true, source: 'pdf', status: 'in_range' });
    // later edit
    await c.patch(`/api/results/${res.id}`, { valueText: '412,0' });
    const hist = await c.get(`/api/results/${res.id}/history`);
    expect(hist.json.edits).toEqual([
      expect.objectContaining({ field: 'value', originalValue: '4?2', newValue: '412', context: 'review' }),
      expect.objectContaining({ field: 'value', originalValue: '412', newValue: '412,0', context: 'edit' }),
    ]);
    const rows = await db.select().from(resultEdits).where(eq(resultEdits.resultId, res.id));
    expect(rows).toHaveLength(2);
  });
});

describe('medical data integrity', () => {
  it('stores values exactly as printed and the lab’s own range', async () => {
    const c = new Client(app);
    await c.register();
    const { reportId } = await c.addReport('demo-2025-10-10-beta.pdf');
    const rep = await c.get(`/api/reports/${reportId}`);
    const glu = rep.json.results.find((r: { biomarkerId: string }) => r.biomarkerId === 'glucose');
    expect(glu).toMatchObject({ valueText: '6,3', valueNumeric: 6.3, unit: 'mmol/L', referenceRange: { low: 3.9, high: 6.1, source: 'laboratory' }, status: 'above', labCode: '2001', sourcePage: 1 });
  });

  it('never invents a reference range: manual result without range → unknown status', async () => {
    const c = new Client(app);
    await c.register();
    const r = await c.post('/api/results', { biomarkerId: 'glucose', originalName: 'Глюкоза', collectedAt: '2025-01-01', valueText: '9,9', unit: 'mmol/L', referenceRange: null });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ referenceRange: null, status: 'unknown', source: 'manual' });
  });

  it('converts units for the trend only with exact rules and keeps originals', async () => {
    const c = new Client(app);
    await c.register();
    await c.addReport('demo-2025-01-15-alpha.pdf');
    await c.addReport('demo-2026-02-01-gamma.pdf');
    const d = await c.get('/api/biomarkers/uric_acid');
    const us = d.json.series.find((p: { unit: string }) => p.unit === 'mg/dL');
    expect(us).toMatchObject({ valueText: '6.2', value: 6.2, displayValue: 368.8 }); // 6.2 × 59.48
    expect(d.json.summary.mixedUnits).toBe(false);
  });

  it('does not merge different biomarkers (absolute neutrophils vs %)', async () => {
    const c = new Client(app);
    await c.register();
    const up = await c.uploadFile('edge-cases.pdf');
    await runProcessingJob(up.json.jobId);
    const rv = await c.get(`/api/jobs/${up.json.jobId}/review`);
    const neu = rv.json.candidates.find((x: { originalName: string }) => x.originalName === 'Neutrophils');
    expect(neu.biomarkerId).toBeNull();
  });

  it('computes change and percent from the previous measurement, never a judgement', async () => {
    const c = new Client(app);
    await c.register();
    await c.addReport('demo-2025-01-15-alpha.pdf');
    await c.addReport('demo-2025-06-15-alpha.pdf');
    const d = await c.get('/api/biomarkers/uric_acid');
    expect(d.json.summary.change).toMatchObject({ latest: 356, previous: 312, absolute: 44, percent: 14.1, direction: 'up' });
    expect(JSON.stringify(d.json)).not.toMatch(/влош|подобр|опасн|тревог/i);
  });
});

describe('sharing with a doctor', () => {
  it('shares only the selected biomarkers, can be revoked, and never exposes documents', async () => {
    const c = new Client(app);
    await c.register();
    await c.addReport('demo-2025-01-15-alpha.pdf');
    const s = await c.post('/api/shares', { label: 'Д-р', biomarkerIds: ['glucose'], from: null, to: null, includeSpecialists: false, expiresInHours: 24 });
    expect(s.status).toBe(200);
    const token = s.json.path.split('/s/')[1];
    const anon = new Client(app);
    const pub = await anon.get(`/api/public/share/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.json.biomarkers.map((b: { summary: { id: string } }) => b.summary.id)).toEqual(['glucose']);
    expect(JSON.stringify(pub.json)).not.toMatch(/sourceDocumentId":"[0-9a-f]/);
    expect(pub.raw.headers['x-robots-tag']).toContain('noindex');
    await c.post(`/api/shares/${s.json.id}/revoke`);
    expect((await anon.get(`/api/public/share/${token}`)).status).toBe(404);
  });
});

describe('exports and data subject rights', () => {
  it('full export requires recent password confirmation', async () => {
    const c = new Client(app);
    const { password } = await c.register();
    await c.addReport('demo-2025-01-15-alpha.pdf');
    // simulate an old session: no recent reauth
    const { sessions } = await import('../src/db/schema');
    await db.update(sessions).set({ reauthAt: new Date(Date.now() - 3600_000).toISOString() });
    const denied = await c.get('/api/export/json');
    expect(denied.status).toBe(403);
    expect(denied.json.code).toBe('reauth_required');
    await c.post('/api/auth/reauth', { password });
    const ok = await c.get('/api/export/json');
    expect(ok.status).toBe(200);
    expect(ok.json.results.length).toBe(33);
    expect(JSON.stringify(ok.json)).not.toMatch(/storageKey|passwordHash|dekEnc|tokenHash/);
  });

  it('FHIR export produces a Bundle with Observations, LOINC codes and Provenance', async () => {
    const c = new Client(app);
    await c.register();
    await c.addReport('demo-2025-01-15-alpha.pdf');
    const f = await c.get('/api/export/fhir');
    expect(f.json.resourceType).toBe('Bundle');
    const types = new Set(f.json.entry.map((e: { resource: { resourceType: string } }) => e.resource.resourceType));
    expect([...types]).toEqual(expect.arrayContaining(['Patient', 'Observation', 'DiagnosticReport', 'Organization', 'DocumentReference', 'Provenance']));
    const ua = f.json.entry.map((e: { resource: unknown }) => e.resource).find((r: { code?: { coding?: Array<{ code: string }> } }) => r.code?.coding?.some((x) => x.code === '14933-6'));
    expect(ua.valueQuantity).toMatchObject({ value: 312, unit: 'µmol/L', system: 'http://unitsofmeasure.org', code: 'umol/L' });
    expect(ua.referenceRange[0]).toMatchObject({ low: { value: 202 }, high: { value: 416 } });
  });

  it('CSV export is injection-safe and UTF-8 with BOM', async () => {
    const c = new Client(app);
    await c.register();
    await c.post('/api/results', { biomarkerId: null, originalName: '=HYPERLINK("http://evil")', collectedAt: '2025-01-01', valueText: '1', unit: null, referenceRange: null });
    const csv = await c.get('/api/export/csv');
    expect(csv.raw.body.charCodeAt(0)).toBe(0xfeff);
    expect(csv.raw.body).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('account deletion removes all data and files (crypto-shredding)', async () => {
    const c = new Client(app);
    const { id, password } = await c.register();
    await c.addReport('demo-2025-01-15-alpha.pdf');
    await c.post('/api/auth/reauth', { password });
    const wrong = await c.post('/api/account/delete', { password, confirmation: 'delete' });
    expect(wrong.status).toBe(400);
    const r = await c.post('/api/account/delete', { password, confirmation: 'ИЗТРИЙ' });
    expect(r.status).toBe(200);
    expect(await db.select().from(users).where(eq(users.id, id))).toHaveLength(0);
    expect(await db.select().from(labResults).where(eq(labResults.userId, id))).toHaveLength(0);
    const dir = path.resolve(process.cwd(), '../../storage/test-files/u');
    expect((await readdir(dir).catch(() => [] as string[])).includes(id)).toBe(false);
    expect((await c.get('/api/dashboard')).status).toBe(401);
  });
});

describe('demo mode', () => {
  it('creates an isolated synthetic account with 5 reports, 30+ biomarkers and a pending review', async () => {
    const c = new Client(app);
    const r = await c.post('/api/auth/demo');
    expect(r.status).toBe(200);
    expect(r.json.profile.isDemo).toBe(true);
    const d = await c.get('/api/dashboard');
    expect(d.json.stats.reports).toBe(5);
    expect(d.json.stats.biomarkers).toBeGreaterThanOrEqual(30);
    expect(d.json.pendingReviews).toHaveLength(1);
    expect((await c.get('/api/specialists')).json.length).toBe(3);
  });
});
