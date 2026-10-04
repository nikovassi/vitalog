import clsx from 'clsx';
import { ArrowDown, ArrowRight, ArrowUp, Check, Minus } from 'lucide-react';
import {
  describeChange, formatNumber, formatRange, formatSigned, STATUS_LABELS, STATUS_SHORT,
  type Change, type ResultStatus,
} from '@vitalog/shared';

/** Status = icon + text + color. Never color alone (WCAG 1.4.1). */
export function StatusBadge({ status, short, className }: { status: ResultStatus; short?: boolean; className?: string }) {
  const Icon = status === 'in_range' ? Check : status === 'above' ? ArrowUp : status === 'below' ? ArrowDown : Minus;
  const tone = status === 'in_range' ? 'bg-accent-soft text-accent-soft-ink' : status === 'unknown' ? 'bg-surface-2 text-muted' : 'bg-attention-soft text-attention-ink';
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-medium', tone, className)}>
      <Icon className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
      {short ? STATUS_SHORT[status] : STATUS_LABELS[status]}
    </span>
  );
}

/** Numeric change since previous measurement – neutral colors: direction is not "good" or "bad". */
export function ChangeBadge({ change, unit, className, showPercent = true }: { change: Change | null; unit?: string | null; className?: string; showPercent?: boolean }) {
  if (!change) return <span className={clsx('text-sm text-muted', className)}>—</span>;
  const Icon = change.direction === 'up' ? ArrowUp : change.direction === 'down' ? ArrowDown : ArrowRight;
  const text = change.direction === 'stable'
    ? 'без промяна'
    : `${formatSigned(change.absolute)}${unit ? ` ${unit}` : ''}${showPercent && change.percent !== null ? ` (${formatSigned(change.percent, 1)}%)` : ''}`;
  return (
    <span className={clsx('num inline-flex items-center gap-1 text-sm text-ink-2', className)} title={describeChange(change)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">{describeChange(change)}</span>
      <span aria-hidden>{text}</span>
    </span>
  );
}

/**
 * Signature element: the lab's reference range as a track, the value as a dot.
 * Shows the band only with a real lab range; one-sided ranges are drawn open-ended.
 */
export function RangeBar({ value, low, high, status, className }: { value: number | null; low: number | null; high: number | null; status: ResultStatus; className?: string }) {
  if (value === null || (low === null && high === null)) return null;
  const lo = low ?? 0;
  const hi = high ?? (low! * 2 || 1);
  const span = hi - lo || Math.abs(hi) || 1;
  const min = Math.min(lo - span * 0.5, value);
  const max = Math.max(hi + span * 0.5, value);
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const bandL = low === null ? 0 : pct(lo);
  const bandR = high === null ? 100 : pct(hi);
  const out = status === 'above' || status === 'below';
  return (
    <div className={clsx('relative h-2 w-full rounded-full bg-surface-3', className)} role="img" aria-label={`Стойност ${formatNumber(value)}, референтен диапазон ${formatRange(low, high)}`}>
      <div className="absolute inset-y-0 rounded-full bg-[var(--band-edge)] opacity-60" style={{ left: `${bandL}%`, width: `${Math.max(2, bandR - bandL)}%` }} />
      <div
        className={clsx('absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow-sm', out ? 'bg-attention' : 'bg-accent')}
        style={{ left: `${Math.min(98, Math.max(2, pct(value)))}%` }}
      />
    </div>
  );
}
