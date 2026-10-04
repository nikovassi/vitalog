import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { documentUpdateSchema, isoDate } from '@vitalog/shared';
import { db } from '../db/client';
import { documents, labReports, users } from '../db/schema';
import { requireUser } from '../lib/auth';
import { audit } from '../lib/audit';
import { hmac, safeEqual } from '../lib/crypto';
import { deleteUserFile, getUserFile } from '../lib/files';
import { badRequest, HttpError, likeEscape, notFound, UUID_RE } from '../lib/http';
import { storeUpload } from '../services/uploads';
import { toDocument } from '../services/mappers';

const idParam = z.object({ id: z.string().regex(UUID_RE) });
const categoryEnum = z.enum(['lab_results', 'imaging', 'discharge_summary', 'outpatient_sheet', 'prescription', 'other']);
const URL_TTL_SECONDS = 300;

/**
 * Signed temporary URL: payload + HMAC, bound to the user and the document, valid 5 min.
 * Even with the URL, the request must come from the same logged-in user (no public links).
 */
export function signFileToken(userId: string, documentId: string, disposition: 'inline' | 'attachment') {
  const payload = Buffer.from(JSON.stringify({ u: userId, d: documentId, x: disposition, e: Math.floor(Date.now() / 1000) + URL_TTL_SECONDS })).toString('base64url');
  return `${payload}.${hmac(payload)}`;
}

function verifyFileToken(token: string): { u: string; d: string; x: 'inline' | 'attachment'; e: number } | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, hmac(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.e !== 'number' || data.e < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export const documentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.get('/documents', async (req) => {
    const q = z.object({
      category: categoryEnum.optional(),
      search: z.string().max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(30),
    }).parse(req.query);
    const uid = req.user!.id;
    const conds = [eq(documents.userId, uid)];
    if (q.category) conds.push(eq(documents.category, q.category));
    if (q.search) conds.push(ilike(documents.name, `%${likeEscape(q.search)}%`));
    const where = and(...conds);
    const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(documents).where(where)) as [{ total: number }];
    const rows = await db
      .select({ d: documents, reportId: labReports.id })
      .from(documents)
      .leftJoin(labReports, and(eq(labReports.documentId, documents.id), eq(labReports.userId, uid)))
      .where(where)
      .orderBy(desc(sql`coalesce(${documents.documentDate}::timestamptz, ${documents.uploadedAt})`))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const counts = await db.select({ category: documents.category, n: sql<number>`count(*)::int` }).from(documents).where(eq(documents.userId, uid)).groupBy(documents.category);
    return { items: rows.map(({ d, reportId }) => ({ ...toDocument(d), reportId })), total, page: q.page, pageSize: q.pageSize, counts };
  });

  /** Store a non-lab document (imaging, discharge summary…) without processing. */
  app.post('/documents', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req) => {
    let category: z.infer<typeof categoryEnum> = 'other';
    let documentDate: string | null = null;
    let fileBuf: Buffer | null = null;
    let fileName = 'document.pdf';
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        fileBuf = await part.toBuffer();
        if (part.file.truncated) throw new HttpError(413, 'file_too_large', 'Файлът е твърде голям.');
        fileName = part.filename;
      } else if (part.fieldname === 'category') category = categoryEnum.parse(part.value);
      else if (part.fieldname === 'documentDate' && part.value) documentDate = isoDate.parse(part.value);
    }
    if (!fileBuf?.length) throw badRequest('Не е избран файл.', 'no_file');
    const doc = await storeUpload(req.user!, fileBuf, fileName, category, documentDate);
    await audit(req, 'document.upload', { targetType: 'document', targetId: doc.id });
    return toDocument(doc);
  });

  app.patch('/documents/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = documentUpdateSchema.parse(req.body);
    const [row] = await db.update(documents).set(body).where(and(eq(documents.id, id), eq(documents.userId, req.user!.id))).returning();
    if (!row) throw notFound('Документът');
    return toDocument(row);
  });

  app.delete('/documents/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const [row] = await db.delete(documents).where(and(eq(documents.id, id), eq(documents.userId, req.user!.id))).returning();
    if (!row) throw notFound('Документът');
    await deleteUserFile(row.storageKey);
    await audit(req, 'document.delete', { targetType: 'document', targetId: id });
    return { ok: true };
  });

  app.post('/documents/:id/url', async (req) => {
    const { id } = idParam.parse(req.params);
    const { disposition } = z.object({ disposition: z.enum(['inline', 'attachment']).default('inline') }).parse(req.body ?? {});
    const [doc] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, id), eq(documents.userId, req.user!.id)));
    if (!doc) throw notFound('Документът');
    return { url: `/api/files/${signFileToken(req.user!.id, id, disposition)}`, expiresIn: URL_TTL_SECONDS };
  });

  app.get('/files/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().max(600) }).parse(req.params);
    const data = verifyFileToken(token);
    if (!data || data.u !== req.user!.id) throw new HttpError(404, 'not_found', 'Линкът е невалиден или е изтекъл.');
    const [doc] = await db.select().from(documents).where(and(eq(documents.id, data.d), eq(documents.userId, req.user!.id)));
    if (!doc) throw notFound('Документът');
    const [u] = await db.select({ dekEnc: users.dekEnc }).from(users).where(eq(users.id, req.user!.id));
    const file = await getUserFile(u!.dekEnc, doc.storageKey);
    await audit(req, data.x === 'inline' ? 'document.view' : 'document.download', { targetType: 'document', targetId: doc.id });
    const asciiName = doc.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `${data.x}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`)
      .header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'") // no scripts; 'sandbox' would break browser PDF viewers
      .header('X-Frame-Options', 'SAMEORIGIN')
      .header('Cache-Control', 'no-store, private')
      .send(file);
  });
};
