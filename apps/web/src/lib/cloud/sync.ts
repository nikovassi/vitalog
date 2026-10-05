/**
 * Cloud sync on Supabase (Free plan, Frankfurt). Configured at build time with
 * VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the anon key is public by design; access is
 * enforced by Row Level Security – see supabase/migrations/0001_vitalog.sql).
 *
 * Only ciphertext leaves the browser: see ./crypto.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createKeys, decryptBytes, decryptJson, encryptBytes, encryptJson, rewrap, unwrapWithPassword, unwrapWithRecovery,
  type WrappedKeys,
} from './crypto';
import type { LocalState, RemoteAdapter } from '../local/store';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const CLOUD_AVAILABLE = !!(URL_ && KEY);

const BUCKET = 'vitalog-files';
const STATE_AAD = 'vitalog-state-v1';

let clientPromise: Promise<SupabaseClient> | null = null;
export function supabase(): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } }));
  return clientPromise;
}

export class CloudError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

// ── Device key cache (non-extractable CryptoKey in IndexedDB, cleared on logout) ──
const KEY_DB = 'vitalog-cloud-key';
function keyDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(KEY_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function keyOp<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const d = await keyDb();
  return new Promise((res, rej) => {
    const t = d.transaction('k', mode);
    const req = fn(t.objectStore('k'));
    t.oncomplete = () => res(req ? (req.result as T) : undefined);
    t.onerror = () => rej(t.error);
  });
}
const cacheDek = (userId: string, dek: CryptoKey) => keyOp('readwrite', (s) => s.put({ userId, dek }, 'dek'));
const cachedDek = async (userId: string) => {
  const v = await keyOp<{ userId: string; dek: CryptoKey }>('readonly', (s) => s.get('dek')).catch(() => undefined);
  return v?.userId === userId ? v.dek : null;
};
const clearDek = () => keyOp('readwrite', (s) => s.delete('dek')).catch(() => {});

// ── Remote adapter ───────────────────────────────────────────────
function adapter(sb: SupabaseClient, userId: string, dek: CryptoKey): RemoteAdapter {
  let version = 0;
  const path = (id: string) => `${userId}/${id}`;
  return {
    async pull() {
      const { data, error } = await sb.from('vitalog_state').select('version, ciphertext').eq('user_id', userId).maybeSingle();
      if (error) throw new CloudError('sync', 'Неуспешно зареждане на данните от облака.');
      if (!data) { version = 0; return null; }
      version = data.version;
      return decryptJson<LocalState>(dek, data.ciphertext, `${STATE_AAD}:${userId}`);
    },
    async push(state) {
      const ciphertext = await encryptJson(dek, state, `${STATE_AAD}:${userId}`);
      if (version === 0) {
        const { error } = await sb.from('vitalog_state').insert({ user_id: userId, version: 1, ciphertext });
        if (error) throw new CloudError('sync', 'Неуспешен запис в облака.');
        version = 1;
        return;
      }
      // optimistic concurrency: only overwrite the version we last saw
      const { data, error } = await sb.from('vitalog_state').update({ ciphertext, version: version + 1, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('version', version).select('version');
      if (error) throw new CloudError('sync', 'Неуспешен запис в облака.');
      if (!data?.length) throw new CloudError('conflict', 'Данните са променени от друго устройство. Презареди страницата.', 409);
      version += 1;
    },
    async putFile(id, bytes) {
      const blob = await encryptBytes(dek, bytes, `file:${path(id)}`);
      const { error } = await sb.storage.from(BUCKET).upload(path(id), new Blob([blob as unknown as ArrayBuffer], { type: 'application/octet-stream' }), { upsert: true, contentType: 'application/octet-stream' });
      if (error) throw new CloudError('sync', 'Неуспешно качване на файла в облака.');
    },
    async getFile(id) {
      const { data, error } = await sb.storage.from(BUCKET).download(path(id));
      if (error || !data) return undefined;
      return decryptBytes(dek, new Uint8Array(await data.arrayBuffer()), `file:${path(id)}`);
    },
    async deleteFile(id) {
      await sb.storage.from(BUCKET).remove([path(id)]);
    },
  };
}

const keysOf = (row: Record<string, unknown>): WrappedKeys => ({
  kdf_salt: row.kdf_salt as string, kdf_iterations: row.kdf_iterations as number, wrapped_dek_password: row.wrapped_dek_password as string,
  recovery_salt: row.recovery_salt as string, wrapped_dek_recovery: row.wrapped_dek_recovery as string,
});

async function loadKeys(sb: SupabaseClient, userId: string): Promise<WrappedKeys | null> {
  const { data, error } = await sb.from('vitalog_keys').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new CloudError('sync', 'Неуспешна връзка с облака.');
  return data ? keysOf(data) : null;
}

/** Password kept only in memory between "login" and "recovery code" steps. */
let pendingPassword: string | null = null;

export interface CloudSession { adapter: RemoteAdapter; email: string; recoveryCode?: string }

/** Restore a session on page load (Supabase session + device key cache). */
export async function resumeSession(): Promise<CloudSession | null> {
  const sb = await supabase();
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const dek = await cachedDek(user.id);
  if (!dek) return null;
  return { adapter: adapter(sb, user.id, dek), email: user.email ?? '' };
}

export async function signUp(email: string, password: string): Promise<CloudSession | 'confirm_email'> {
  const sb = await supabase();
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}login` } });
  if (error) throw new CloudError('signup', translate(error.message));
  if (!data.session) return 'confirm_email';
  return finishLogin(sb, data.session.user.id, data.session.user.email ?? email, password);
}

export async function signIn(email: string, password: string): Promise<CloudSession> {
  const sb = await supabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new CloudError('invalid_credentials', translate(error?.message ?? ''), 401);
  return finishLogin(sb, data.session.user.id, data.session.user.email ?? email, password);
}

async function finishLogin(sb: SupabaseClient, userId: string, email: string, password: string): Promise<CloudSession> {
  const keys = await loadKeys(sb, userId);
  if (!keys) {
    const created = await createKeys(password);
    const { error } = await sb.from('vitalog_keys').insert({ user_id: userId, ...created.keys });
    if (error) throw new CloudError('sync', 'Неуспешно създаване на ключовете.');
    await cacheDek(userId, created.dek);
    return { adapter: adapter(sb, userId, created.dek), email, recoveryCode: created.recoveryCode };
  }
  try {
    const dek = await unwrapWithPassword(keys, password);
    await cacheDek(userId, dek);
    return { adapter: adapter(sb, userId, dek), email };
  } catch {
    // Password was reset via email: the old password-wrapped key no longer opens → recovery code
    pendingPassword = password;
    throw new CloudError('recovery_required', 'Паролата ти е сменена. Въведи кода за възстановяване, за да отключиш данните.', 403);
  }
}

/** After a password reset: unlock with the recovery code and re-wrap with the new password. */
export async function recover(code: string): Promise<CloudSession> {
  const sb = await supabase();
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user || !pendingPassword) throw new CloudError('unauthorized', 'Влез отново.', 401);
  const keys = await loadKeys(sb, user.id);
  let dek: CryptoKey;
  try {
    dek = await unwrapWithRecovery(keys!, code, true);
  } catch {
    throw new CloudError('invalid_code', 'Невалиден код за възстановяване.', 400);
  }
  const { keys: next, recoveryCode } = await rewrap(dek, pendingPassword);
  const { error } = await sb.from('vitalog_keys').update({ ...next, updated_at: new Date().toISOString() }).eq('user_id', user.id);
  if (error) throw new CloudError('sync', 'Неуспешно обновяване на ключовете.');
  pendingPassword = null;
  const finalDek = await crypto.subtle.importKey('raw', await crypto.subtle.exportKey('raw', dek), 'AES-GCM', false, ['encrypt', 'decrypt']);
  await cacheDek(user.id, finalDek);
  return { adapter: adapter(sb, user.id, finalDek), email: user.email ?? '', recoveryCode };
}

/** Change password while logged in: same data key, re-wrapped (and a new recovery code). */
export async function changePassword(currentPassword: string, newPassword: string): Promise<string> {
  const sb = await supabase();
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user) throw new CloudError('unauthorized', 'Влез отново.', 401);
  const { error: authErr } = await sb.auth.signInWithPassword({ email: user.email!, password: currentPassword });
  if (authErr) throw new CloudError('invalid_password', 'Текущата парола е грешна.');
  const keys = await loadKeys(sb, user.id);
  const dek = await unwrapWithPassword(keys!, currentPassword, true);
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw new CloudError('weak_password', translate(error.message));
  const { keys: next, recoveryCode } = await rewrap(dek, newPassword);
  await sb.from('vitalog_keys').update({ ...next, updated_at: new Date().toISOString() }).eq('user_id', user.id);
  return recoveryCode;
}

export async function requestPasswordReset(email: string) {
  const sb = await supabase();
  await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${import.meta.env.BASE_URL}reset` });
}

/** Called on the /reset page: Supabase has put a recovery session in the URL. */
export async function setNewPassword(password: string) {
  const sb = await supabase();
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new CloudError('reset', translate(error.message));
  await sb.auth.signOut();
}

export async function signOut() {
  const sb = await supabase();
  await clearDek();
  await sb.auth.signOut();
}

/** GDPR erasure: all files, then the account (rows cascade). */
export async function deleteAccount() {
  const sb = await supabase();
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user) throw new CloudError('unauthorized', 'Влез отново.', 401);
  for (;;) {
    const { data: files } = await sb.storage.from(BUCKET).list(user.id, { limit: 100 });
    if (!files?.length) break;
    await sb.storage.from(BUCKET).remove(files.map((f) => `${user.id}/${f.name}`));
  }
  const { error } = await sb.rpc('vitalog_delete_my_account');
  if (error) throw new CloudError('delete', 'Неуспешно изтриване на профила.');
  await clearDek();
  await sb.auth.signOut();
}

function translate(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Грешен email или парола.';
  if (/email not confirmed/i.test(msg)) return 'Потвърди email адреса си от писмото, което ти изпратихме.';
  if (/already registered|already exists/i.test(msg)) return 'Вече има профил с този email. Влез или смени паролата.';
  if (/password/i.test(msg) && /(short|weak|characters)/i.test(msg)) return 'Паролата е твърде слаба.';
  if (/rate limit/i.test(msg)) return 'Твърде много опити. Опитай отново след малко.';
  return 'Неуспешна операция. Опитай отново.';
}
