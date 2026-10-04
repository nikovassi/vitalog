import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { auditLogs, processingJobs, users } from '../db/schema';
import { requireRole } from '../lib/auth';
import { audit } from '../lib/audit';
import { notFound, UUID_RE } from '../lib/http';

/**
 * Operational admin API. Returns METADATA ONLY – there is deliberately no endpoint that
 * returns lab values, documents or notes to staff (least privilege, GDPR Art. 5(1)(c)).
 */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireRole('support', 'admin', 'superadmin'));

  app.get('/stats', async () => {
    const [counts] = await db.execute<Record<string, number>>(sql`
      select (select count(*)::int from users where not is_demo) as users,
             (select count(*)::int from users where is_demo) as demo_users,
             (select count(*)::int from documents) as documents,
             (select coalesce(sum(size_bytes),0)::float from documents) as storage_bytes,
             (select count(*)::int from lab_results) as results,
             (select coalesce(sum(ai_calls),0)::int from usage_counters where period = to_char(now(), 'YYYY-MM')) as ai_calls_month,
             (select coalesce(sum(documents_processed),0)::int from usage_counters where period = to_char(now(), 'YYYY-MM')) as processed_month`);
    const jobs = await db.select({ stage: processingJobs.stage, n: sql<number>`count(*)::int` }).from(processingJobs).groupBy(processingJobs.stage);
    return { ...counts, jobs };
  });

  app.get('/jobs/failed', async () => {
    const rows = await db.select({ id: processingJobs.id, errorCode: processingJobs.errorCode, usedOcr: processingJobs.usedOcr, pagesTotal: processingJobs.pagesTotal, createdAt: processingJobs.createdAt })
      .from(processingJobs).where(eq(processingJobs.stage, 'failed')).orderBy(desc(processingJobs.createdAt)).limit(100);
    return rows;
  });

  app.get('/security-events', async () => {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    return db.select({ action: auditLogs.action, at: auditLogs.at, ipPrefix: auditLogs.ipPrefix })
      .from(auditLogs)
      .where(sql`${auditLogs.at} >= ${since} and ${inArray(auditLogs.action, ['auth.login_failed', 'auth.password_reset_requested', 'admin.role_change', 'account.delete'])}`)
      .orderBy(desc(auditLogs.at)).limit(200);
  });

  app.patch('/users/:id/role', { preHandler: requireRole('superadmin') }, async (req) => {
    const { id } = z.object({ id: z.string().regex(UUID_RE) }).parse(req.params);
    const { role } = z.object({ role: z.enum(['user', 'support', 'admin', 'superadmin']) }).parse(req.body);
    const [row] = await db.update(users).set({ role }).where(eq(users.id, id)).returning({ id: users.id });
    if (!row) throw notFound('Потребителят');
    await audit(req, 'admin.role_change', { subject: id, targetType: 'user', targetId: id });
    return { ok: true };
  });

};
