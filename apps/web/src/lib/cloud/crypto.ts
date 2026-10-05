/**
 * Zero-knowledge encryption for cloud sync (WebCrypto only).
 *
 *   password ──PBKDF2-SHA256 (600k)──► KEK₁ ─┐
 *   recovery code ──PBKDF2 (600k)────► KEK₂ ─┼─ AES-KW wrap ─► wrapped DEKs (stored in Supabase)
 *   random 256-bit DEK ──────────────────────┘
 *   DEK ── AES-256-GCM ──► state JSON and every file (stored in Supabase as ciphertext)
 *
 * The server never sees the password, the recovery code or the DEK. Forgetting both the
 * password and the recovery code makes the data unrecoverable – by design.
 */

export const KDF_ITERATIONS = 600_000; // OWASP 2023 recommendation for PBKDF2-HMAC-SHA256
const enc = new TextEncoder();
const dec = new TextDecoder();

export const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const buf = (u: Uint8Array) => u as unknown as BufferSource;

export function randomBytes(n: number) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Human-friendly recovery code: 24 chars from an unambiguous alphabet, grouped by 4. */
export function newRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = randomBytes(24);
  const chars = [...r].map((b) => alphabet[b % alphabet.length]).join('');
  return chars.match(/.{4}/g)!.join('-');
}
export const normalizeRecoveryCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') ?? '';

async function deriveKek(secret: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', buf(enc.encode(secret.normalize('NFKC'))), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations }, base, { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

export interface WrappedKeys {
  kdf_salt: string;
  kdf_iterations: number;
  wrapped_dek_password: string;
  recovery_salt: string;
  wrapped_dek_recovery: string;
}

/** First login: create a DEK and wrap it with the password and with a new recovery code. */
export async function createKeys(password: string): Promise<{ keys: WrappedKeys; dek: CryptoKey; recoveryCode: string }> {
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const recoveryCode = newRecoveryCode();
  const keys = await wrapAll(dek, password, recoveryCode);
  return { keys, dek: await nonExtractable(dek), recoveryCode };
}

async function wrapAll(dek: CryptoKey, password: string, recoveryCode: string): Promise<WrappedKeys> {
  const salt = randomBytes(16);
  const rsalt = randomBytes(16);
  const [w1, w2] = await Promise.all([
    crypto.subtle.wrapKey('raw', dek, await deriveKek(password, salt, KDF_ITERATIONS), 'AES-KW'),
    crypto.subtle.wrapKey('raw', dek, await deriveKek(normalizeRecoveryCode(recoveryCode), rsalt, KDF_ITERATIONS), 'AES-KW'),
  ]);
  return { kdf_salt: toB64(salt), kdf_iterations: KDF_ITERATIONS, wrapped_dek_password: toB64(new Uint8Array(w1)), recovery_salt: toB64(rsalt), wrapped_dek_recovery: toB64(new Uint8Array(w2)) };
}

async function unwrap(wrapped: string, secret: string, salt: string, iterations: number, extractable: boolean): Promise<CryptoKey> {
  const kek = await deriveKek(secret, fromB64(salt), iterations);
  return crypto.subtle.unwrapKey('raw', buf(fromB64(wrapped)), kek, 'AES-KW', { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

/** Throws if the password does not match (AES-KW integrity check). */
export const unwrapWithPassword = (k: WrappedKeys, password: string, extractable = false) =>
  unwrap(k.wrapped_dek_password, password, k.kdf_salt, k.kdf_iterations, extractable);

export const unwrapWithRecovery = (k: WrappedKeys, code: string, extractable = false) =>
  unwrap(k.wrapped_dek_recovery, normalizeRecoveryCode(code), k.recovery_salt, k.kdf_iterations, extractable);

/** Re-wrap the same DEK after a password change or recovery (data stays readable). */
export async function rewrap(extractableDek: CryptoKey, newPassword: string): Promise<{ keys: WrappedKeys; recoveryCode: string }> {
  const recoveryCode = newRecoveryCode();
  return { keys: await wrapAll(extractableDek, newPassword, recoveryCode), recoveryCode };
}

async function nonExtractable(dek: CryptoKey): Promise<CryptoKey> {
  const raw = await crypto.subtle.exportKey('raw', dek);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM: [12-byte IV][ciphertext+tag]. `aad` binds the blob to its purpose/path. */
export async function encryptBytes(dek: CryptoKey, data: Uint8Array, aad: string): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(enc.encode(aad)) }, dek, buf(data)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(dek: CryptoKey, blob: Uint8Array, aad: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(blob.subarray(0, 12)), additionalData: buf(enc.encode(aad)) }, dek, buf(blob.subarray(12))));
}

export const encryptJson = async (dek: CryptoKey, value: unknown, aad: string) => toB64(await encryptBytes(dek, enc.encode(JSON.stringify(value)), aad));
export const decryptJson = async <T,>(dek: CryptoKey, b64: string, aad: string): Promise<T> => JSON.parse(dec.decode(await decryptBytes(dek, fromB64(b64), aad))) as T;
