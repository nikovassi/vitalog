import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    on();
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Private pages must not be indexed even if a URL leaks. */
export function useNoIndex() {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'robots';
      document.head.appendChild(meta);
    }
    meta.content = 'noindex, nofollow';
  }, []);
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Vitalog` : 'Vitalog';
  }, [title]);
}

/** Date range presets → from date (ISO) */
export type RangePreset = '3m' | '6m' | '1y' | '3y' | 'all' | 'custom';
export const RANGE_LABELS: Record<RangePreset, string> = { '3m': '3 месеца', '6m': '6 месеца', '1y': '1 година', '3y': '3 години', all: 'Всички', custom: 'Период' };
export function presetFrom(p: RangePreset): string | null {
  const months: Record<string, number> = { '3m': 3, '6m': 6, '1y': 12, '3y': 36 };
  if (!(p in months)) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - months[p]!);
  return d.toISOString().slice(0, 10);
}
