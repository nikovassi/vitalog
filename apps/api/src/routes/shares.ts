import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { shareCreateSchema, type SeriesPoint } from '@vitalog/shared';
import { db } from '../db/client';
import { notifications, profiles, shareLinks, specialists } from '../db/schema';
import { requireUser } from '../lib/auth';
import { audit } from '../lib/audit';
import { randomToken, sha256 } from '../lib/crypto';
import { HttpError, notFound, UUID_RE } from '../lib/http';
import { biomarkerSeries, biomarkerSummaries, toSeriesPoint } from '../services/results';
import { toSpecialist } from '../services/mappers';

/**
 * "Сподели с лекар": scoped, read-only, expiring, revocable links. The token (256-bit) is
 * shown once; only its hash is stored. Documents/PDFs are never exposed through shares.
 */
export const shareRoutes: FastifyPluginAsync = async (app) => {
  app.get('/shares', { preHandler: requireUser }, async (req) => {
    const rows = await db.select().from(shareLinks).where(eq(shareLinks.userId, req.user!.id)).orderBy(desc(shareLinks.createdAt));
    return rows.map(({ tokenHash: _h, userId: _u, ...r }) => ({ ...r, active: !r.revokedAt && Date.parse(r.expiresAt) > Date.now() }));
  });

  app.post('/shares', { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req) => {
    if (req.user!.isDemo) throw new HttpError(403, 'demo', 'Споделянето е изключено в демо режим.');
    const body = shareCreateSchema.parse(req.body);
    const token = randomToken(32);
    const [row] = await db.insert(shareLinks).values({
      userId: req.user!.id,
      label: body.label,
      tokenHash: sha256(token),
      scope: { biomarkerIds: body.biomarkerIds, from: body.from, to: body.to, includeSpecialists: body.includeSpecialists },
      expiresAt: new Date(Date.now() + body.expiresInHours * 3600_000).toISOString(),
    }).returning();
    await audit(req, 'share.create', { targetType: 'share', targetId: row!.id });
    return { id: row!.id, path: `/s/${token}`, expiresAt: row!.expiresAt };
  });

  app.post('/shares/:id/revoke', { preHandler: requireUser }, async (req) => {
    const { id } = z.object({ id: z.string().regex(UUID_RE) }).parse(req.params);
    const [row] = await db.update(shareLinks).set({ revokedAt: new Date().toISOString() }).where(and(eq(shareLinks.id, id), eq(shareLinks.userId, req.user!.id))).returning({ id: shareLinks.id });
    if (!row) throw notFound('Линкът');
    await audit(req, 'share.revoke', { targetType: 'share', targetId: id });
    return { ok: true };
  });

  /** Public read-only view for the doctor. No session needed; noindex; rate limited. */
  app.get('/public/share/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(req.params);
    const [link] = await db.select().from(shareLinks).where(and(eq(shareLinks.tokenHash, sha256(token)), isNull(shareLinks.revokedAt), gt(shareLinks.expiresAt, new Date().toISOString())));
    if (!link) throw new HttpError(404, 'share_unavailable', 'Линкът е изтекъл или е отменен.');
    await db.update(shareLinks).set({ accessCount: sql`${shareLinks.accessCount} + 1`, lastAccessedAt: new Date().toISOString() }).where(eq(shareLinks.id, link.id));
    if (link.accessCount === 0) {
      await db.insert(notifications).values({ userId: link.userId, kind: 'share_accessed', title: 'Споделеният линк беше отворен', body: `„${link.label}“`, link: '/app/share' });
    }
    await audit(req, 'share.access', { actor: null, subject: link.userId, targetType: 'share', targetId: link.id });
    const s = link.scope;
    const keys = s.biomarkerIds === 'all' ? undefined : s.biomarkerIds;
    const summaries = await biomarkerSummaries(link.userId, { keys, from: s.from, to: s.to });
    // Data minimization: no internal ids (documents, reports, results) leave through a share
    const strip = <T extends SeriesPoint | null>(p: T): T => (p ? { ...p, sourceDocumentId: null, reportId: null, resultId: '' } : p);
    const biomarkers = await Promise.all(summaries.map(async (sum) => ({
      summary: { ...sum, favorite: false, latest: strip(sum.latest), previous: strip(sum.previous) },
      series: (await biomarkerSeries(link.userId, sum.id, s.from, s.to)).map((r) => strip(toSeriesPoint(r))),
    })));
    const [profile] = await db.select({ displayName: profiles.displayName }).from(profiles).where(eq(profiles.userId, link.userId));
    return {
      label: link.label,
      sharedBy: profile?.displayName ?? '',
      expiresAt: link.expiresAt,
      from: s.from,
      to: s.to,
      biomarkers,
      specialists: s.includeSpecialists ? (await db.select().from(specialists).where(eq(specialists.userId, link.userId))).map((x) => ({ ...toSpecialist(x), note: null })) : [],
    };
  });
};
