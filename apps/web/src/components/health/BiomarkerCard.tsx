import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { formatDate, formatRange, type BiomarkerSummary } from '@vitalog/shared';
import { ChangeBadge, RangeBar, StatusBadge } from '../ui/Status';
import { Sparkline } from '../ui/Sparkline';

/** Health overview card: value, unit, date, lab range, status, change vs previous. */
export function BiomarkerCard({ s }: { s: BiomarkerSummary }) {
  const l = s.latest;
  if (!l) return null;
  return (
    <Link to={`/app/biomarkers/${encodeURIComponent(s.id)}`}
      className="group flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-card transition-[border,transform] hover:-translate-y-0.5 hover:border-border-strong sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-[15px] font-semibold leading-snug text-ink">{s.name}</h3>
        {s.favorite && <Star className="size-4 shrink-0 fill-current text-attention" aria-label="Любим" />}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="num font-display text-[28px] leading-none font-bold text-ink">
          {l.valueText}
          <span className="ml-1.5 text-sm font-medium text-muted">{l.unit}</span>
        </p>
        <Sparkline values={s.sparkline} className="h-9 w-20 shrink-0" />
      </div>
      <div className="mt-2"><ChangeBadge change={s.change} unit={s.unit} /></div>
      {l.value !== null && (l.rangeLow !== null || l.rangeHigh !== null) && <RangeBar className="mt-4" value={l.value} low={l.rangeLow} high={l.rangeHigh} status={l.status} />}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <StatusBadge status={l.status} short />
        <span className="num text-[13px] text-muted">{formatDate(l.date)}</span>
      </div>
      {(l.rangeLow !== null || l.rangeHigh !== null) && <p className="num mt-1 text-[13px] text-muted">Диапазон: {formatRange(l.rangeLow, l.rangeHigh, l.rangeText)} {l.unit}</p>}
    </Link>
  );
}

export function BiomarkerRow({ s, right }: { s: BiomarkerSummary; right?: React.ReactNode }) {
  const l = s.latest;
  return (
    <Link to={`/app/biomarkers/${encodeURIComponent(s.id)}`} className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-surface-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">{s.name}</p>
        <p className="num text-sm text-muted">{l ? `${formatDate(l.date)}` : ''}</p>
      </div>
      <div className="text-right">
        <p className="num font-semibold">{l?.valueText} <span className="text-sm font-normal text-muted">{l?.unit}</span></p>
        {right ?? (l && <StatusBadge status={l.status} short className="mt-0.5" />)}
      </div>
    </Link>
  );
}
