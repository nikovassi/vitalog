import type { ThemePreference } from '@vitalog/shared';

/** Theme preference: stored in the profile (server) and mirrored in localStorage for first paint. */
export function applyTheme(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    if (pref === 'system') localStorage.removeItem('vl-theme');
    else localStorage.setItem('vl-theme', pref);
  } catch { /* storage unavailable */ }
}

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}
