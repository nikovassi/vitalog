import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { isoDate, noteSchema, specialistSchema, timelineEventSchema } from '@vitalog/shared';
import { db } from '../db/client';
import { appointments, labReports, notes, notifications, specialists, timelineEvents, users } from '../db/schema';
import { requireUser } from '../lib/auth';
import { deleteUserFile, getUserFile, putUserFile } from '../lib/files';
import { badRequest, HttpError, notFound, UUID_RE } from '../lib/http';
import { reportSummaries } from '../services/results';
import { toNote, toSpecialist, toTimelineEvent } from '../services/mappers';

const idParam = z.object({ id: z.string().regex(UUID_RE) });

export const careRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  // ── Specialists ──────────────────────────────────────────────
  app.get('/specialists', async (req) => {
    const rows = await db.select({
      s: specialists,
      reports: sql<number>`(select count(*)::int from lab_reports r where r.specialist_id = ${specialists.id})`,
    }).from(specialists).where(eq(specialists.userId, req.user!.id)).orderBy(asc(specialists.name));
    return rows.map(({ s, reports }) => ({ ...toSpecialist(s), reportCount: reports }));
  });

  app.get('/specialists/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const uid = req.user!.id;
    const [s] = await db.select().from(specialists).where(and(eq(specialists.id, id), eq(specialists.userId, uid)));
    if (!s) throw notFound('Специалистът');
    const reports = await reportSummaries(uid, eq(labReports.specialistId, id), 50);
    const n = await db.select().from(notes).where(and(eq(notes.userId, uid), eq(notes.targetType, 'specialist'), eq(notes.targetId, id))).orderBy(desc(notes.createdAt));
    const appts = await db.select().from(appointments).where(and(eq(appointments.userId, uid), eq(appointments.specialistId, id))).orderBy(desc(appointments.at));
    return { specialist: toSpecialist(s), reports, notes: n.map(toNote), appointments: appts };
  });

  app.post('/specialists', async (req) => {
    const body = specialistSchema.parse(req.body);
    const [row] = await db.insert(specialists).values({ ...body, userId: req.user!.id }).returning();
    return toSpecialist(row!);
  });

  app.patch('/specialists/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = specialistSchema.partial().parse(req.body);
    const [row] = await db.update(specialists).set({ ...body, updatedAt: new Date().toISOString() }).where(and(eq(specialists.id, id), eq(specialists.userId, req.user!.id))).returning();
    if (!row) throw notFound('Специалистът');
    return toSpecialist(row);
  });

  app.delete('/specialists/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const [row] = await db.delete(specialists).where(and(eq(specialists.id, id), eq(specialists.userId, req.user!.id))).returning();
    if (!row) throw notFound('Специалистът');
    if (row.photoStorageKey) await deleteUserFile(row.photoStorageKey);
    return { ok: true };
  });

  app.put('/specialists/:id/photo', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const uid = req.user!.id;
    const [s] = await db.select().from(specialists).where(and(eq(specialists.id, id), eq(specialists.userId, uid)));
    if (!s) throw notFound('Специалистът');
    const file = await req.file({ limits: { fileSize: 2 * 1024 * 1024 } });
    if (!file) throw badRequest('Не е избран файл.');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw new HttpError(413, 'file_too_large', 'Снимката е твърде голяма (макс. 2 MB).');
    const ft = await fileTypeFromBuffer(buf);
    if (!ft || !['image/jpeg', 'image/png', 'image/webp'].includes(ft.mime)) throw new HttpError(415, 'bad_type', 'Поддържат се само JPEG, PNG и WebP снимки.');
    const key = await putUserFile(uid, req.user!.dekEnc, buf);
    if (s.photoStorageKey) await deleteUserFile(s.photoStorageKey);
    await db.update(specialists).set({ photoStorageKey: key }).where(eq(specialists.id, id));
    return { ok: true };
  });

  app.get('/specialists/:id/photo', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [s] = await db.select().from(specialists).where(and(eq(specialists.id, id), eq(specialists.userId, req.user!.id)));
    if (!s?.photoStorageKey) throw notFound('Снимката');
    const [u] = await db.select({ dekEnc: users.dekEnc }).from(users).where(eq(users.id, req.user!.id));
    const buf = await getUserFile(u!.dekEnc, s.photoStorageKey);
    const ft = await fileTypeFromBuffer(buf);
    return reply.header('Content-Type', ft?.mime ?? 'application/octet-stream').header('Cache-Control', 'private, no-store').send(buf);
  });

  // ── Appointments ─────────────────────────────────────────────
  app.post('/appointments', async (req) => {
    const body = z.object({
      specialistId: z.string().regex(UUID_RE).nullable(),
      title: z.string().trim().min(1).max(160),
      at: z.string().datetime({ offset: true }).or(isoDate),
      location: z.string().trim().max(300).nullable().optional(),
      note: z.string().trim().max(2000).nullable().optional(),
    }).parse(req.body);
    const uid = req.user!.id;
    if (body.specialistId) {
      const [s] = await db.select({ id: specialists.id }).from(specialists).where(and(eq(specialists.id, body.specialistId), eq(specialists.userId, uid)));
      if (!s) throw notFound('Специалистът');
    }
    const [row] = await db.insert(appointments).values({ ...body, userId: uid, at: new Date(body.at).toISOString() }).returning();
    await db.insert(timelineEvents).values({ userId: uid, kind: 'appointment', title: body.title, date: new Date(body.at).toISOString().slice(0, 10), refId: row!.id, showOnCharts: true });
    return row;
  });

  app.delete('/appointments/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const [row] = await db.delete(appointments).where(and(eq(appointments.id, id), eq(appointments.userId, req.user!.id))).returning();
    if (!row) throw notFound('Прегледът');
    await db.delete(timelineEvents).where(and(eq(timelineEvents.userId, req.user!.id), eq(timelineEvents.refId, id)));
    return { ok: true };
  });

  // ── Notes ────────────────────────────────────────────────────
  app.get('/notes', async (req) => {
    const q = z.object({ targetType: noteSchema.shape.targetType.optional(), targetId: z.string().max(100).optional() }).parse(req.query);
    const conds = [eq(notes.userId, req.user!.id)];
    if (q.targetType) conds.push(eq(notes.targetType, q.targetType));
    if (q.targetId) conds.push(eq(notes.targetId, q.targetId));
    return (await db.select().from(notes).where(and(...conds)).orderBy(desc(notes.createdAt)).limit(200)).map(toNote);
  });

  app.post('/notes', async (req) => {
    const body = noteSchema.parse(req.body);
    const [row] = await db.insert(notes).values({ ...body, userId: req.user!.id }).returning();
    return toNote(row!);
  });

  app.patch('/notes/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { body } = z.object({ body: noteSchema.shape.body }).parse(req.body);
    const [row] = await db.update(notes).set({ body, updatedAt: new Date().toISOString() }).where(and(eq(notes.id, id), eq(notes.userId, req.user!.id))).returning();
    if (!row) throw notFound('Бележката');
    return toNote(row);
  });

  app.delete('/notes/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const [row] = await db.delete(notes).where(and(eq(notes.id, id), eq(notes.userId, req.user!.id))).returning({ id: notes.id });
    if (!row) throw notFound('Бележката');
    return { ok: true };
  });

  // ── Timeline events (diet change, medication start, …) ──────
  app.get('/events', async (req) => {
    const rows = await db.select().from(timelineEvents).where(and(eq(timelineEvents.userId, req.user!.id), isNull(timelineEvents.refId))).orderBy(desc(timelineEvents.date));
    return rows.map(toTimelineEvent);
  });

  app.post('/events', async (req) => {
    const body = timelineEventSchema.parse(req.body);
    const [row] = await db.insert(timelineEvents).values({ ...body, userId: req.user!.id }).returning();
    return toTimelineEvent(row!);
  });

  app.patch('/events/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = timelineEventSchema.partial().parse(req.body);
    const [row] = await db.update(timelineEvents).set(body).where(and(eq(timelineEvents.id, id), eq(timelineEvents.userId, req.user!.id))).returning();
    if (!row) throw notFound('Събитието');
    return toTimelineEvent(row);
  });

  app.delete('/events/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const [row] = await db.delete(timelineEvents).where(and(eq(timelineEvents.id, id), eq(timelineEvents.userId, req.user!.id))).returning({ id: timelineEvents.id });
    if (!row) throw notFound('Събитието');
    return { ok: true };
  });

  // ── Notifications ────────────────────────────────────────────
  app.get('/notifications', async (req) => {
    const uid = req.user!.id;
    const rows = await db.select().from(notifications).where(eq(notifications.userId, uid)).orderBy(desc(notifications.createdAt)).limit(30);
    const [{ unread }] = (await db.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, uid), isNull(notifications.readAt)))) as [{ unread: number }];
    return { items: rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt })), unread };
  });

  app.post('/notifications/:id/read', async (req) => {
    const { id } = idParam.parse(req.params);
    await db.update(notifications).set({ readAt: new Date().toISOString() }).where(and(eq(notifications.id, id), eq(notifications.userId, req.user!.id)));
    return { ok: true };
  });

  app.post('/notifications/read-all', async (req) => {
    await db.update(notifications).set({ readAt: new Date().toISOString() }).where(and(eq(notifications.userId, req.user!.id), isNull(notifications.readAt)));
    return { ok: true };
  });
};
