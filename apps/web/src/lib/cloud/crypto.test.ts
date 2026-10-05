// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createKeys, decryptBytes, decryptJson, encryptBytes, encryptJson, newRecoveryCode, normalizeRecoveryCode, rewrap,
  unwrapWithPassword, unwrapWithRecovery,
} from './crypto';

describe('zero-knowledge crypto', () => {
  it('encrypts state so the ciphertext reveals nothing and round-trips', async () => {
    const { dek } = await createKeys('correct horse battery staple');
    const secret = { results: [{ name: 'Пикочна киселина', value: '371' }] };
    const ct = await encryptJson(dek, secret, 'state:u1');
    expect(ct).not.toContain('371');
    expect(atob(ct)).not.toContain('Пикочна');
    expect(await decryptJson(dek, ct, 'state:u1')).toEqual(secret);
  });

  it('binds ciphertext to its purpose (AAD): a file blob cannot be replayed as another file', async () => {
    const { dek } = await createKeys('pw-1234567890');
    const blob = await encryptBytes(dek, new Uint8Array([1, 2, 3]), 'file:u1/a');
    await expect(decryptBytes(dek, blob, 'file:u1/b')).rejects.toThrow();
    expect([...await decryptBytes(dek, blob, 'file:u1/a')]).toEqual([1, 2, 3]);
  });

  it('unlocks with the password or the recovery code, never with a wrong one', async () => {
    const { keys, dek, recoveryCode } = await createKeys('pw-one-1234');
    const ct = await encryptJson(dek, { a: 1 }, 'x');
    await expect(unwrapWithPassword(keys, 'wrong-password')).rejects.toThrow();
    await expect(unwrapWithRecovery(keys, newRecoveryCode())).rejects.toThrow();
    expect(await decryptJson(await unwrapWithPassword(keys, 'pw-one-1234'), ct, 'x')).toEqual({ a: 1 });
    // recovery code is accepted regardless of case/dashes
    const loose = normalizeRecoveryCode(recoveryCode).toLowerCase().replace(/-/g, ' ');
    expect(await decryptJson(await unwrapWithRecovery(keys, loose), ct, 'x')).toEqual({ a: 1 });
  });

  it('password change keeps the same data key (old data stays readable)', async () => {
    const { keys, dek } = await createKeys('old-password-1');
    const ct = await encryptJson(dek, { v: 'data' }, 'x');
    const extractable = await unwrapWithPassword(keys, 'old-password-1', true);
    const { keys: next, recoveryCode } = await rewrap(extractable, 'new-password-2');
    await expect(unwrapWithPassword(next, 'old-password-1')).rejects.toThrow();
    expect(await decryptJson(await unwrapWithPassword(next, 'new-password-2'), ct, 'x')).toEqual({ v: 'data' });
    expect(await decryptJson(await unwrapWithRecovery(next, recoveryCode), ct, 'x')).toEqual({ v: 'data' });
  }, 30_000);

  it('the cached device key cannot be exported', async () => {
    const { dek } = await createKeys('pw-123456789');
    await expect(crypto.subtle.exportKey('raw', dek)).rejects.toThrow();
  });
});
