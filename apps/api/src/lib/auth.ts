import { hash, verify } from '@node-rs/argon2';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, IS_PROD } from '../config';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { randomToken, sha256 } from './crypto';
import { HttpError, ipPrefix, unauthorized, userAgent } from './http';

/** OWASP Password Storage Cheat Sheet: Argon2id, m=19 MiB, t=2, p=1. */
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 /* Argon2id */ } as const;

export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

/** Used to equalize timing when the email does not exist (no user enumeration). */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(pw: string) {
  dummyHash ??= hashPassword('timing-equalizer-password');
  await verifyPassword(await dummyHash, pw);
}

const COMMON = new Set([
  'password123', 'password1234', '1234567890', '12345678910', 'qwertyuiop', 'qwerty12345', 'iloveyou12',
  'parola1234', 'parolaparola', 'parola12345', 'abc1234567', 'letmein123', 'welcome123', 'admin12345',
  'passw0rd123', '1q2w3e4r5t', 'asdfghjkl1', 'zxcvbnm123', '0000000000', '1111111111',
]);

export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < 10) return 'Паролата трябва да е поне 10 символа.';
  if (COMMON.has(pw.toLowerCase())) return 'Тази парола е твърде често срещана. Избери друга.';
  if (email && pw.toLowerCase().includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length >= 4) {
    return 'Паролата не трябва да съдържа email адреса.';
  }
  if (new Set(pw).size < 4) return 'Паролата е твърде проста.';
  return null;
}

export const SESSION_COOKIE = IS_PROD ? '__Host-vl_session' : 'vl_session';

export interface SessionUser {
  id: string;
  email: string;
  role: 'user' | 'support' | 'admin' | 'superadmin';
  emailVerified: boolean;
  mfaEnabled: boolean;
  isDemo: boolean;
  dekEnc: string;
}

export interface SessionInfo {
  id: string;
  csrfToken: string;
  mfaPending: boolean;
  reauthAt: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    session: SessionInfo | null;
  }
}

export async function createSession(req: FastifyRequest, reply: FastifyReply, userId: string, opts: { mfaPending?: boolean } = {}) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + config.SESSION_ABSOLUTE_HOURS * 3600_000).toISOString();
  const [row] = await db
    .insert(sessions)
    .values({ userId, tokenHash: sha256(token), csrfToken, mfaPending: opts.mfaPending ?? false, reauthAt: opts.mfaPending ? null : new Date().toISOString(), userAgent: userAgent(req), ipPrefix: ipPrefix(req), expiresAt })
    .returning({ id: sessions.id });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_ABSOLUTE_HOURS * 3600,
  });
  return { id: row!.id, csrfToken };
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: IS_PROD, sameSite: 'lax' });
}

/** Load the session from the cookie, enforcing idle and absolute timeouts. */
export async function loadSession(req: FastifyRequest, reply: FastifyReply) {
  req.user = null;
  req.session = null;
  const token = req.cookies[SESSION_COOKIE];
  if (!token || token.length > 100) return;
  const rows = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    clearSessionCookie(reply);
    return;
  }
  const now = Date.now();
  const idleExpired = now - Date.parse(row.s.lastSeenAt) > config.SESSION_IDLE_MINUTES * 60_000;
  if (Date.parse(row.s.expiresAt) < now || idleExpired) {
    await db.delete(sessions).where(eq(sessions.id, row.s.id));
    clearSessionCookie(reply);
    return;
  }
  if (now - Date.parse(row.s.lastSeenAt) > 60_000) {
    await db.update(sessions).set({ lastSeenAt: new Date().toISOString() }).where(eq(sessions.id, row.s.id));
  }
  req.session = { id: row.s.id, csrfToken: row.s.csrfToken, mfaPending: row.s.mfaPending, reauthAt: row.s.reauthAt };
  req.user = {
    id: row.u.id,
    email: row.u.email,
    role: row.u.role,
    emailVerified: !!row.u.emailVerifiedAt,
    mfaEnabled: !!row.u.mfaEnabledAt,
    isDemo: row.u.isDemo,
    dekEnc: row.u.dekEnc,
  };
}

/** preHandler: authenticated, MFA-complete user. */
export async function requireUser(req: FastifyRequest) {
  if (!req.user || !req.session || req.session.mfaPending) throw unauthorized();
}

export function requireRole(...roles: SessionUser['role'][]) {
  return async (req: FastifyRequest) => {
    await requireUser(req);
    if (!roles.includes(req.user!.role)) throw new HttpError(404, 'not_found', 'Ресурсът не е намерен.');
  };
}

/** Step-up auth for sensitive actions (export all, delete account, disable MFA). */
export async function requireRecentAuth(req: FastifyRequest) {
  await requireUser(req);
  const at = req.session!.reauthAt;
  if (!at || Date.now() - Date.parse(at) > 10 * 60_000) {
    throw new HttpError(403, 'reauth_required', 'За това действие потвърди паролата си.');
  }
}

export async function revokeOtherSessions(userId: string, keepSessionId: string | null) {
  await db.delete(sessions).where(keepSessionId ? and(eq(sessions.userId, userId), sql`${sessions.id} <> ${keepSessionId}`) : eq(sessions.userId, userId));
}

export async function purgeExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString()));
}
