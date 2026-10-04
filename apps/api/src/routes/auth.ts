import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import QRCode from 'qrcode';
import {
  changePasswordSchema, CONSENT_VERSION, forgotSchema, loginSchema, mfaCodeSchema, reauthSchema,
  registerSchema, resetSchema, tokenSchema, type MeResponse,
} from '@vitalog/shared';
import { config } from '../config';
import { db } from '../db/client';
import { authTokens, consents, profiles, recoveryCodes, sessions, users } from '../db/schema';
import {
  burnPasswordCheck, clearSessionCookie, createSession, hashPassword, passwordProblem, requireRecentAuth,
  requireUser, revokeOtherSessions, verifyPassword,
} from '../lib/auth';
import { decrypt, encrypt, newWrappedDek, randomToken, sha256, unwrapDek } from '../lib/crypto';
import { audit } from '../lib/audit';
import { sendEmail } from '../lib/email';
import { badRequest, HttpError, ipPrefix, unauthorized } from '../lib/http';
import { createDemoAccount } from '../demo/seed-user';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export const CONSENT_TEXT_HEALTH =
  'Съгласявам се Vitalog да съхранява и обработва качените от мен медицински документи и лабораторни резултати с цел организиране и визуализиране (чл. 9, ал. 2, буква „а“ от GDPR). Мога да оттегля съгласието си по всяко време чрез изтриване на профила.';
export const CONSENT_TEXT_AI =
  'Съгласявам се текстът на качените документи (без име и лични идентификатори) да бъде изпращан към външен AI доставчик в ЕС само за структуриране на таблиците с резултати.';

export async function buildMe(userId: string, csrfToken: string, mfaPending: boolean): Promise<MeResponse> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  return {
    csrfToken,
    mfaPending,
    user: { id: u!.id, email: u!.email, emailVerified: !!u!.emailVerifiedAt, role: u!.role, mfaEnabled: !!u!.mfaEnabledAt, createdAt: u!.createdAt },
    profile: {
      userId,
      displayName: p!.displayName,
      fullName: p!.fullName,
      birthYear: p!.birthYear,
      theme: p!.theme,
      locale: p!.locale,
      onboardingCompletedAt: p!.onboardingCompletedAt,
      aiProcessingConsent: !!p!.aiProcessingConsentAt,
      isDemo: u!.isDemo,
    },
  };
}

async function issueToken(userId: string, kind: 'email_verify' | 'password_reset', ttlMinutes: number) {
  const token = randomToken(32);
  await db.insert(authTokens).values({ userId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString() });
  return token;
}

async function consumeToken(token: string, kind: 'email_verify' | 'password_reset') {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date().toISOString())))
    .returning({ userId: authTokens.userId });
  return row?.userId ?? null;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', async (req, reply) => {
    if (!req.user || !req.session) return reply.status(401).send({ code: 'unauthorized', message: 'Не си влязъл.' });
    return buildMe(req.user.id, req.session.csrfToken, req.session.mfaPending);
  });

  app.post('/register', authLimit, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const problem = passwordProblem(body.password, body.email);
    if (problem) throw badRequest(problem, 'weak_password');
    const existing = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${body.email}`);
    if (existing.length) {
      // Same response shape as success would leak nothing more than the error; we show a
      // neutral message and notify the owner by email instead (no account enumeration via timing).
      await sendEmail(body.email, 'Опит за регистрация във Vitalog', 'Някой се опита да създаде акаунт с този email. Ако си бил ти, използвай „Забравена парола“.');
      throw badRequest('Не успяхме да създадем акаунт с този email. Ако вече имаш акаунт, влез или използвай „Забравена парола“.', 'register_failed');
    }
    const passwordHash = await hashPassword(body.password);
    const user = await db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ email: body.email, passwordHash, dekEnc: newWrappedDek() }).returning();
      await tx.insert(profiles).values({ userId: u!.id, displayName: body.displayName });
      await tx.insert(consents).values({ userId: u!.id, kind: 'health_data', version: CONSENT_VERSION, granted: true, textHash: sha256(CONSENT_TEXT_HEALTH), ipPrefix: ipPrefix(req) });
      return u!;
    });
    const token = await issueToken(user.id, 'email_verify', 24 * 60);
    await sendEmail(user.email, 'Потвърди email адреса си', `Отвори линка, за да потвърдиш адреса си:\n${config.APP_ORIGIN}/verify?token=${token}\n\nЛинкът е валиден 24 часа.`);
    const s = await createSession(req, reply, user.id);
    await audit(req, 'auth.register', { actor: user.id });
    return buildMe(user.id, s.csrfToken, false);
  });

  app.post('/login', authLimit, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${body.email}`);
    const invalid = new HttpError(401, 'invalid_credentials', 'Грешен email или парола.');
    if (!user) {
      await burnPasswordCheck(body.password);
      throw invalid;
    }
    if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
      await burnPasswordCheck(body.password);
      throw new HttpError(429, 'locked', `Твърде много неуспешни опита. Опитай отново след ${LOCK_MINUTES} минути.`);
    }
    if (!(await verifyPassword(user.passwordHash, body.password))) {
      const count = user.failedLoginCount + 1;
      await db.update(users).set({ failedLoginCount: count, lockedUntil: count >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null }).where(eq(users.id, user.id));
      await audit(req, 'auth.login_failed', { actor: null, subject: user.id });
      throw invalid;
    }
    await db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
    const mfaPending = !!user.mfaEnabledAt;
    const s = await createSession(req, reply, user.id, { mfaPending });
    if (!mfaPending) await audit(req, 'auth.login', { actor: user.id });
    return buildMe(user.id, s.csrfToken, mfaPending);
  });

  app.post('/mfa/verify', authLimit, async (req) => {
    if (!req.user || !req.session?.mfaPending) throw unauthorized();
    const { code } = mfaCodeSchema.parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.id, req.user.id));
    const ok = await checkMfaCode(u!.id, u!.mfaSecretEnc, u!.dekEnc, code);
    if (!ok) {
      await audit(req, 'auth.login_failed');
      throw new HttpError(401, 'invalid_code', 'Невалиден код.');
    }
    await db.update(sessions).set({ mfaPending: false, reauthAt: new Date().toISOString() }).where(eq(sessions.id, req.session.id));
    await audit(req, 'auth.login');
    return buildMe(req.user.id, req.session.csrfToken, false);
  });

  app.post('/logout', async (req, reply) => {
    if (req.session) {
      await db.delete(sessions).where(eq(sessions.id, req.session.id));
      await audit(req, 'auth.logout');
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post('/verify-email', authLimit, async (req) => {
    const { token } = tokenSchema.parse(req.body);
    const userId = await consumeToken(token, 'email_verify');
    if (!userId) throw badRequest('Линкът е невалиден или е изтекъл.', 'invalid_token');
    await db.update(users).set({ emailVerifiedAt: new Date().toISOString() }).where(eq(users.id, userId));
    await audit(req, 'auth.email_verified', { actor: userId });
    return { ok: true };
  });

  app.post('/resend-verification', { preHandler: requireUser, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (req) => {
    if (req.user!.emailVerified) return { ok: true };
    const token = await issueToken(req.user!.id, 'email_verify', 24 * 60);
    await sendEmail(req.user!.email, 'Потвърди email адреса си', `${config.APP_ORIGIN}/verify?token=${token}`);
    return { ok: true };
  });

  app.post('/forgot', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req) => {
    const { email } = forgotSchema.parse(req.body);
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    if (user && !user.isDemo) {
      const token = await issueToken(user.id, 'password_reset', 30);
      await sendEmail(user.email, 'Смяна на парола', `Отвори линка, за да зададеш нова парола (валиден 30 минути):\n${config.APP_ORIGIN}/reset?token=${token}\n\nАко не си поискал смяна, игнорирай това съобщение.`);
      await audit(req, 'auth.password_reset_requested', { actor: null, subject: user.id });
    }
    // Same answer whether or not the account exists
    return { ok: true, message: 'Ако има акаунт с този email, изпратихме линк за смяна на паролата.' };
  });

  app.post('/reset', authLimit, async (req, reply) => {
    const { token, password } = resetSchema.parse(req.body);
    const userId = await consumeToken(token, 'password_reset');
    if (!userId) throw badRequest('Линкът е невалиден или е изтекъл.', 'invalid_token');
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    const problem = passwordProblem(password, u!.email);
    if (problem) throw badRequest(problem, 'weak_password');
    await db.update(users).set({ passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
    await revokeOtherSessions(userId, null);
    clearSessionCookie(reply);
    await audit(req, 'auth.password_reset', { actor: userId });
    return { ok: true };
  });

  app.post('/change-password', { preHandler: requireUser, ...authLimit }, async (req) => {
    const body = changePasswordSchema.parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.id, req.user!.id));
    if (!(await verifyPassword(u!.passwordHash, body.currentPassword))) throw badRequest('Текущата парола е грешна.', 'invalid_password');
    const problem = passwordProblem(body.newPassword, u!.email);
    if (problem) throw badRequest(problem, 'weak_password');
    await db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, u!.id));
    await revokeOtherSessions(u!.id, req.session!.id);
    await audit(req, 'auth.password_changed');
    return { ok: true };
  });

  /** Step-up: confirm password before sensitive actions. */
  app.post('/reauth', { preHandler: requireUser, ...authLimit }, async (req) => {
    const { password } = reauthSchema.parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.id, req.user!.id));
    if (!(await verifyPassword(u!.passwordHash, password))) throw badRequest('Грешна парола.', 'invalid_password');
    await db.update(sessions).set({ reauthAt: new Date().toISOString() }).where(eq(sessions.id, req.session!.id));
    return { ok: true };
  });

  // ── Sessions / devices ─────────────────────────────────────────
  app.get('/sessions', { preHandler: requireUser }, async (req) => {
    const rows = await db.select().from(sessions).where(eq(sessions.userId, req.user!.id)).orderBy(desc(sessions.lastSeenAt));
    return rows.map((s) => ({ id: s.id, userAgent: s.userAgent, ipPrefix: s.ipPrefix, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === req.session!.id }));
  });

  app.delete<{ Params: { id: string } }>('/sessions/:id', { preHandler: requireUser }, async (req) => {
    await db.delete(sessions).where(and(eq(sessions.id, req.params.id), eq(sessions.userId, req.user!.id)));
    await audit(req, 'auth.session_revoked', { targetType: 'session', targetId: req.params.id });
    return { ok: true };
  });

  app.post('/sessions/revoke-others', { preHandler: requireUser }, async (req) => {
    await revokeOtherSessions(req.user!.id, req.session!.id);
    await audit(req, 'auth.session_revoked', { targetType: 'session', targetId: 'others' });
    return { ok: true };
  });

  // ── MFA (TOTP) ─────────────────────────────────────────────────
  app.post('/mfa/setup', { preHandler: requireRecentAuth }, async (req) => {
    const secret = generateSecret();
    const dek = unwrapDek(req.user!.dekEnc);
    await db.update(users).set({ mfaSecretEnc: encrypt(dek, Buffer.from(secret), 'mfa').toString('base64'), mfaEnabledAt: null }).where(eq(users.id, req.user!.id));
    const uri = generateURI({ issuer: 'Vitalog', label: req.user!.email, secret });
    return { secret, otpauthUrl: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
  });

  app.post('/mfa/enable', { preHandler: requireRecentAuth }, async (req) => {
    const { code } = mfaCodeSchema.parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.id, req.user!.id));
    if (!u!.mfaSecretEnc) throw badRequest('Първо започни настройката.');
    const secret = decrypt(unwrapDek(u!.dekEnc), Buffer.from(u!.mfaSecretEnc, 'base64'), 'mfa').toString();
    if (!(await verifyTotp({ secret, token: code, epochTolerance: 30 })).valid) throw badRequest('Невалиден код. Провери часовника на телефона.', 'invalid_code');
    const codes = Array.from({ length: 10 }, () => randomToken(6).replace(/[-_]/g, 'x').slice(0, 8).toUpperCase());
    await db.transaction(async (tx) => {
      await tx.update(users).set({ mfaEnabledAt: new Date().toISOString() }).where(eq(users.id, u!.id));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, u!.id));
      for (const c of codes) await tx.insert(recoveryCodes).values({ userId: u!.id, codeHash: await hashPassword(c) });
    });
    await audit(req, 'auth.mfa_enabled');
    return { recoveryCodes: codes };
  });

  app.post('/mfa/disable', { preHandler: requireRecentAuth }, async (req) => {
    await db.update(users).set({ mfaEnabledAt: null, mfaSecretEnc: null }).where(eq(users.id, req.user!.id));
    await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, req.user!.id));
    await audit(req, 'auth.mfa_disabled');
    return { ok: true };
  });

  // ── Demo mode: an isolated, synthetic, auto-expiring account per visitor ──
  app.post('/demo', { config: { rateLimit: { max: config.DEMO_RATE_LIMIT_PER_HOUR, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!config.DEMO_MODE_ENABLED) throw new HttpError(404, 'not_found', 'Демо режимът е изключен.');
    const userId = await createDemoAccount();
    const s = await createSession(req, reply, userId);
    return buildMe(userId, s.csrfToken, false);
  });

  app.get('/consent-texts', async () => ({ version: CONSENT_VERSION, health: CONSENT_TEXT_HEALTH, ai: CONSENT_TEXT_AI }));
};

async function checkMfaCode(userId: string, secretEnc: string | null, dekEnc: string, code: string): Promise<boolean> {
  if (!secretEnc) return false;
  const clean = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(clean)) {
    const secret = decrypt(unwrapDek(dekEnc), Buffer.from(secretEnc, 'base64'), 'mfa').toString();
    return (await verifyTotp({ secret, token: clean, epochTolerance: 30 })).valid;
  }
  // Recovery code (single use)
  const codes = await db.select().from(recoveryCodes).where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  for (const c of codes) {
    if (await verifyPassword(c.codeHash, clean.toUpperCase())) {
      await db.update(recoveryCodes).set({ usedAt: new Date().toISOString() }).where(eq(recoveryCodes.id, c.id));
      return true;
    }
  }
  return false;
}
