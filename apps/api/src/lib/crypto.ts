import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

/**
 * Envelope encryption: each user has a random 256-bit data key (DEK) stored wrapped with
 * the master key-encryption key (KEK). Files and secrets are AES-256-GCM encrypted with the
 * DEK. In production the KEK should live in a KMS (wrap/unwrap via KMS API instead).
 * Deleting the user row deletes the DEK → their files in storage and backups become unreadable.
 */

const VERSION = 1;
const kek = Buffer.from(config.ENCRYPTION_KEK, 'base64');
if (kek.length !== 32) throw new Error('ENCRYPTION_KEK must be 32 bytes, base64-encoded (openssl rand -base64 32)');

export function encrypt(key: Buffer, plaintext: Buffer, aad = ''): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function decrypt(key: Buffer, blob: Buffer, aad = ''): Buffer {
  if (blob[0] !== VERSION) throw new Error('Unknown ciphertext version');
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]);
}

export function newWrappedDek(): string {
  return encrypt(kek, randomBytes(32), 'dek').toString('base64');
}

export function unwrapDek(wrapped: string): Buffer {
  return decrypt(kek, Buffer.from(wrapped, 'base64'), 'dek');
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export function hmac(data: string): string {
  return createHmac('sha256', config.URL_SIGNING_SECRET).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
