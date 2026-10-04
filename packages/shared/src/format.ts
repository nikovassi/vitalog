/** Display formatting (Bulgarian locale: decimal comma, DD.MM.YYYY). */

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  return dt.toLocaleString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Keeps as many decimals as needed (max 3) without inventing precision. */
export function formatNumber(n: number | null | undefined, maxDecimals = 3): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('bg-BG', { maximumFractionDigits: maxDecimals, useGrouping: Math.abs(n) >= 10000 });
}

export function formatSigned(n: number, maxDecimals = 2): string {
  const s = formatNumber(Math.abs(n), maxDecimals);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

export function formatRange(low: number | null, high: number | null, text?: string | null): string {
  if (low !== null && high !== null) return `${formatNumber(low)} – ${formatNumber(high)}`;
  if (high !== null) return `< ${formatNumber(high)}`;
  if (low !== null) return `> ${formatNumber(low)}`;
  return text ?? '—';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('bg-BG', { maximumFractionDigits: 1 })} MB`;
}

/** Bulgarian plural helper: plural(37, 'показател', 'показателя') */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('bg-BG')} ${n === 1 ? one : many}`;
}

export const DISCLAIMER =
  'Тази платформа организира и визуализира предоставени медицински данни. Тя не поставя диагнози и не заменя консултацията с квалифициран медицински специалист.';
