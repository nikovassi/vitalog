import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { CONSENT_VERSION, deleteAccountSchema, profileUpdateSchema } from '@vitalog/shared';
import { config } from '../config';
import { db } from '../db/client';
import { auditLogs, consents, profiles, usageCounters, users } from '../db/schema';
import { clearSessionCookie, requireRecentAuth, requireUser, verifyPassword } from '../lib/auth';
import { audit } from '../lib/audit';
import { sha256 } from '../lib/crypto';
import { deleteAllUserFiles } from '../lib/files';
import { badRequest, ipPrefix } from '../lib/http';
import { buildMe, CONSENT_TEXT_AI } from './auth';
import { period } from '../services/uploads';

const VISIBLE_ACTIONS = ['auth.login', 'auth.login_failed', 'auth.logout', 'auth.password_changed', 'auth.password_reset', 'auth.mfa_enabled', 'auth.mfa_disabled', 'auth.session_revoked', 'document.upload', 'document.view', 'document.download', 'document.delete', 'report.delete', 'share.create', 'share.revoke', 'share.access', 'export.create'];

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.patch('/profile', async (req) => {
    const body = profileUpdateSchema.parse(req.body);
    const uid = req.user!.id;
    const set: Partial<typeof profiles.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (body.displayName !== undefined) set.displayName = body.displayName;
    if (body.fullName !== undefined) set.fullName = body.fullName;
    if (body.birthYear !== undefined) set.birthYear = body.birthYear;
    if (body.theme !== undefined) set.theme = body.theme;
    if (body.onboardingCompleted) set.onboardingCompletedAt = new Date().toISOString();
    if (body.aiProcessingConsent !== undefined) {
      if (body.aiProcessingConsent && config.AI_PROVIDER === 'none') throw badRequest('AI обработката не е налична на този сървър.');
      set.aiProcessingConsentAt = body.aiProcessingConsent ? new Date().toISOString() : null;
      await db.insert(consents).values({ userId: uid, kind: 'ai_processing', version: CONSENT_VERSION, granted: body.aiProcessingConsent, textHash: sha256(CONSENT_TEXT_AI), ipPrefix: ipPrefix(req) });
      await audit(req, 'consent.change', { targetType: 'consent', targetId: 'ai_processing' });
    }
    await db.update(profiles).set(set).where(eq(profiles.userId, uid));
    return buildMe(uid, req.session!.csrfToken, false);
  });

  app.get('/account/privacy', async (req) => {
    const uid = req.user!.id;
    const rows = await db.select().from(consents).where(eq(consents.userId, uid)).orderBy(desc(consents.at));
    const [usage] = await db.select().from(usageCounters).where(and(eq(usageCounters.userId, uid), eq(usageCounters.period, period())));
    return {
      aiAvailable: config.AI_PROVIDER !== 'none',
      consents: rows.map((c) => ({ kind: c.kind, version: c.version, granted: c.granted, at: c.at })),
      usage: { period: period(), documentsProcessed: usage?.documentsProcessed ?? 0, documentsLimit: config.MONTHLY_PROCESSING_LIMIT, aiCalls: usage?.aiCalls ?? 0 },
      retention: { auditDays: config.AUDIT_RETENTION_DAYS },
    };
  });

  /** The user's own access log ("кой и кога е достъпвал данните ми"). */
  app.get('/account/activity', async (req) => {
    const rows = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.subjectUserId, req.user!.id), inArray(auditLogs.action, VISIBLE_ACTIONS)))
      .orderBy(desc(auditLogs.at)).limit(100);
    return rows.map((r) => ({ action: r.action, at: r.at, ipPrefix: r.ipPrefix, userAgent: r.userAgent, byOwner: r.actorUserId === req.user!.id }));
  });

  /** GDPR Art. 17. Irreversible: files, DEK (crypto-shredding), all rows via cascade. */
  app.post('/account/delete', { preHandler: requireRecentAuth, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = deleteAccountSchema.parse(req.body);
    const uid = req.user!.id;
    const [u] = await db.select().from(users).where(eq(users.id, uid));
    if (!(await verifyPassword(u!.passwordHash, body.password))) throw badRequest('Грешна парола.', 'invalid_password');
    await audit(req, 'account.delete', { targetType: 'user', targetId: uid });
    await deleteAllUserFiles(uid);
    await db.delete(users).where(eq(users.id, uid));
    clearSessionCookie(reply);
    return { ok: true };
  });
};
