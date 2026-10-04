import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TipProps } from './TrendChart';
import { formatDate, formatNumber, STATUS_SYMBOL, type SeriesPoint } from '@vitalog/shared';
import { useMediaQuery } from '../../lib/hooks';

export interface MultiSeries { key: string; name: string; points: SeriesPoint[] }
/** Validated categorical slots (light/dark) – max 3 series per shared axis (see docs/03-UX.md). */
export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
const DASH = ['', '6 3', '2 3'];

/** Several biomarkers with the SAME unit on ONE y-axis. Different units never share an axis. */
export function MultiLineChart({ series, unit }: { series: MultiSeries[]; unit: string }) {
  const small = useMediaQuery('(max-width: 640px)');
  const data = useMemo(() => {
    const byT = new Map<number, Record<string, number | null | SeriesPoint>>();
    series.forEach((s) => s.points.forEach((p) => {
      if (p.displayValue === null) return;
      const t = Date.parse(p.date);
      const row = byT.get(t) ?? { t };
      row[s.key] = p.displayValue;
      row[`${s.key}__p`] = p;
      byT.set(t, row);
    }));
    return [...byT.values()].sort((a, b) => (a.t as number) - (b.t as number));
  }, [series]);
  if (!data.length) return null;
  return (
    <figure aria-label={`Сравнение: ${series.map((s) => s.name).join(', ')} (${unit})`}>
      <div style={{ height: small ? 260 : 340 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 16, right: small ? 12 : 90, bottom: 4, left: small ? -12 : 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin - 864000000', 'dataMax + 864000000']} tickLine={false}
              tickFormatter={(t: number) => { const d = new Date(t); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCFullYear()).slice(2)}`; }}
              axisLine={{ stroke: 'var(--border-strong)' }} minTickGap={32} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} width={small ? 44 : 56} tickFormatter={(v: number) => formatNumber(v, 2)} domain={['auto', 'auto']} />
            <Tooltip isAnimationActive={false} cursor={{ stroke: 'var(--border-strong)' }} content={(p) => <Tip {...(p as unknown as TipProps)} series={series} unit={unit} />} />
            {series.map((s, i) => (
              <Line key={s.key} dataKey={s.key} name={s.name} stroke={SERIES_COLORS[i]} strokeWidth={2} strokeDasharray={DASH[i]} connectNulls
                dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: SERIES_COLORS[i] }} activeDot={{ r: 7, stroke: 'var(--surface)', strokeWidth: 2 }}
                isAnimationActive={!small}
                label={small ? undefined : (props: { x?: number | string; y?: number | string; index?: number }) => {
                  // direct label at the series' last point (identity is never color-alone)
                  const lastIdx = data.map((d) => d[s.key] != null).lastIndexOf(true);
                  return props.index === lastIdx ? <text key={`l${i}`} x={Number(props.x ?? 0) + 10} y={Number(props.y ?? 0) + 4} fontSize={12} fill="var(--ink-2)">{s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name}</text> : <g key={`e${props.index}`} />;
                }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
        {series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden><line x1="1" y1="4" x2="21" y2="4" stroke={SERIES_COLORS[i]} strokeWidth="2.5" strokeDasharray={DASH[i]} /></svg>
            {s.name}
          </span>
        ))}
        <span className="text-muted">· {unit}</span>
      </figcaption>
    </figure>
  );
}

function Tip({ active, payload, series, unit }: TipProps & { series: MultiSeries[]; unit: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as Record<string, unknown>;
  return (
    <div className="rounded-xl border border-border bg-surface px-3.5 py-3 text-sm shadow-pop">
      <p className="num mb-1 text-muted">{formatDate(new Date(row.t as number).toISOString())}</p>
      {series.map((s, i) => {
        const p = row[`${s.key}__p`] as SeriesPoint | undefined;
        if (!p) return null;
        return (
          <p key={s.key} className="num flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-full" style={{ background: SERIES_COLORS[i] }} aria-hidden />
            <span className="text-ink-2">{s.name}:</span> <b>{formatNumber(p.displayValue)}</b> {unit} <span className="text-muted">{STATUS_SYMBOL[p.status]}</span>
          </p>
        );
      })}
    </div>
  );
}
