import { randomUUID } from 'node:crypto';
import { decrypt, encrypt, unwrapDek } from './crypto';
import { storage } from './storage';

/** Encrypt-then-store user files. Storage keys never contain user-supplied names. */
export async function putUserFile(userId: string, wrappedDek: string, data: Buffer): Promise<string> {
  const key = `u/${userId}/${randomUUID()}`;
  await storage.put(key, encrypt(unwrapDek(wrappedDek), data, key));
  return key;
}

export async function getUserFile(wrappedDek: string, key: string): Promise<Buffer> {
  return decrypt(unwrapDek(wrappedDek), await storage.get(key), key);
}

export const deleteUserFile = (key: string) => storage.delete(key);
export const deleteAllUserFiles = (userId: string) => storage.deletePrefix(`u/${userId}`);
