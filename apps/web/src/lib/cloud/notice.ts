/** One-time hand-over of a new recovery code to the UI (kept only in memory, shown once). */
let code: string | null = null;
const listeners = new Set<() => void>();
export const setRecoveryCode = (c: string | undefined | null) => { if (c) { code = c; listeners.forEach((l) => l()); } };
export const peekRecoveryCode = () => code;
export const clearRecoveryCode = () => { code = null; listeners.forEach((l) => l()); };
export const onRecoveryCode = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Which storage the user chose in local mode: this device only, or encrypted cloud sync. */
export type StorageMode = 'device' | 'cloud';
export function getStorageMode(): StorageMode {
  try { return localStorage.getItem('vl-storage') === 'cloud' ? 'cloud' : 'device'; } catch { return 'device'; }
}
export function setStorageMode(m: StorageMode) {
  try { localStorage.setItem('vl-storage', m); } catch { /* ignore */ }
}
