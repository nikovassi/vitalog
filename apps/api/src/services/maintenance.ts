import { and, eq, lt } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { auditLogs, authTokens, users } from '../db/schema';
import { purgeExpiredSessions } from '../lib/auth';
import { deleteAllUserFiles } from '../lib/files';

/** Periodic retention tasks (GDPR storage limitation). */
export async function runMaintenance() {
  await purgeExpiredSessions();
  const now = new Date().toISOString();
  await db.delete(authTokens).where(lt(authTokens.expiresAt, now));
  const expiredDemo = await db.select({ id: users.id }).from(users).where(and(eq(users.isDemo, true), lt(users.demoExpiresAt, now)));
  for (const u of expiredDemo) {
    await deleteAllUserFiles(u.id);
    await db.delete(users).where(eq(users.id, u.id));
  }
  const auditCutoff = new Date(Date.now() - config.AUDIT_RETENTION_DAYS * 86400_000).toISOString();
  await db.delete(auditLogs).where(lt(auditLogs.at, auditCutoff));
  return { expiredDemo: expiredDemo.length };
}
