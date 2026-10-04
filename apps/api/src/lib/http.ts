import type { FastifyRequest } from 'fastify';

/** Errors with Bulgarian user-facing messages. Never include medical values or internals. */
export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}
export const notFound = (what = 'Ресурсът') => new HttpError(404, 'not_found', `${what} не е намерен.`);
export const badRequest = (msg: string, code = 'bad_request') => new HttpError(400, code, msg);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Сесията е изтекла. Моля, влез отново.');
export const forbidden = () => new HttpError(403, 'forbidden', 'Нямаш достъп до този ресурс.');

/** IPv4 → /24, IPv6 → /48. Enough for abuse analysis, less identifying (data minimization). */
export function ipPrefix(req: FastifyRequest): string {
  const ip = req.ip ?? '';
  if (ip.includes('.')) return ip.split('.').slice(0, 3).join('.') + '.0/24';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::/48';
  return 'unknown';
}

export function userAgent(req: FastifyRequest): string | null {
  return (req.headers['user-agent'] ?? '').slice(0, 200) || null;
}

/** Escape LIKE wildcards in user search input. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
