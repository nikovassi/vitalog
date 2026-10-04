import type { FastifyRequest } from 'fastify';
import type { AuditAction } from '@vitalog/shared';
import { db } from '../db/client';
import { auditLogs } from '../db/schema';
import { ipPrefix, userAgent } from './http';

/** Security audit trail. NEVER pass medical values here – only ids and actions. */
export async function audit(
  req: FastifyRequest | null,
  action: AuditAction,
  opts: { actor?: string | null; subject?: string | null; targetType?: string; targetId?: string } = {},
) {
  const actor = opts.actor !== undefined ? opts.actor : (req?.user?.id ?? null);
  await db.insert(auditLogs).values({
    action,
    actorUserId: actor,
    subjectUserId: opts.subject !== undefined ? opts.subject : actor,
    targetType: opts.targetType ?? null,
    targetId: opts.targetId ?? null,
    ipPrefix: req ? ipPrefix(req) : null,
    userAgent: req ? userAgent(req) : null,
  });
}
