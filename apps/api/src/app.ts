import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config, IS_PROD } from './config';
import { loadSession } from './lib/auth';
import { safeEqual } from './lib/crypto';
import { HttpError } from './lib/http';
import { authRoutes } from './routes/auth';
import { dataRoutes } from './routes/data';
import { uploadRoutes } from './routes/uploads';
import { documentRoutes } from './routes/documents';
import { careRoutes } from './routes/care';
import { exportRoutes } from './routes/exports';
import { shareRoutes } from './routes/shares';
import { accountRoutes } from './routes/account';
import { adminRoutes } from './routes/admin';

/** Pre-authentication endpoints: no session yet, protected by Origin check + rate limits. */
const PUBLIC_POST = new Set([
  '/api/auth/login', '/api/auth/register', '/api/auth/forgot', '/api/auth/reset',
  '/api/auth/verify-email', '/api/auth/demo', '/api/auth/mfa/verify',
]);

export async function buildApp() {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    routerOptions: { maxParamLength: 600 }, // signed file tokens are ~250 chars
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      // Never log cookies, CSRF tokens or bodies (may contain health data)
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
      ...(IS_PROD ? {} : { transport: { target: 'pino-pretty', options: { singleLine: true, ignore: 'pid,hostname' } } }),
    },
  });

  app.decorateRequest('user', null);
  app.decorateRequest('session', null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
    hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.user?.id ?? req.ip,
    errorResponseBuilder: () => ({ statusCode: 429, code: 'rate_limited', message: 'Твърде много заявки. Опитай отново след малко.' }),
  });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5, fieldSize: 1000 },
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    await loadSession(req, reply);
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    // CSRF layer 1: Origin must be our app (browsers always send it on cross-site POSTs)
    const origin = req.headers.origin;
    if (origin && origin !== config.APP_ORIGIN) {
      throw new HttpError(403, 'bad_origin', 'Невалиден произход на заявката.');
    }
    // CSRF layer 2: synchronizer token for every authenticated state-changing request
    const path = req.url.split('?')[0]!;
    if (req.session && !PUBLIC_POST.has(path)) {
      const token = req.headers['x-csrf-token'];
      if (typeof token !== 'string' || !safeEqual(token, req.session.csrfToken)) {
        throw new HttpError(403, 'csrf', 'Сесията е невалидна. Презареди страницата.');
      }
    } else if (!req.session && !PUBLIC_POST.has(path) && !path.startsWith('/api/public/')) {
      throw new HttpError(401, 'unauthorized', 'Сесията е изтекла. Моля, влез отново.');
    }
  });

  app.setErrorHandler((err: FastifyError | HttpError | ZodError, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ code: 'validation', message: err.issues[0]?.message ?? 'Невалидни данни.', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ ...err.details, code: err.code, message: err.message });
    const fe = err as FastifyError;
    if (fe.code === 'FST_REQ_FILE_TOO_LARGE' || fe.code === 'FST_FILES_LIMIT') {
      return reply.status(413).send({ code: 'file_too_large', message: `Файлът е твърде голям. Максимум ${config.MAX_UPLOAD_MB} MB.` });
    }
    if (fe.statusCode === 429) return reply.status(429).send(err);
    if (fe.statusCode && fe.statusCode < 500) return reply.status(fe.statusCode).send({ code: 'bad_request', message: 'Невалидна заявка.' });
    req.log.error({ err: { message: err.message, code: fe.code, stack: err.stack } }, 'unhandled error');
    return reply.status(500).send({ code: 'server_error', message: 'Възникна грешка в сървъра. Опитай отново.' });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ code: 'not_found', message: 'Ресурсът не е намерен.' }));

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(dataRoutes, { prefix: '/api' });
  await app.register(uploadRoutes, { prefix: '/api' });
  await app.register(documentRoutes, { prefix: '/api' });
  await app.register(careRoutes, { prefix: '/api' });
  await app.register(exportRoutes, { prefix: '/api' });
  await app.register(shareRoutes, { prefix: '/api' });
  await app.register(accountRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  return app;
}
