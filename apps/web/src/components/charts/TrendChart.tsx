import { useMemo } from 'react';
import {
  Brush, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { formatDate, formatNumber, formatRange, STATUS_LABELS, STATUS_SYMBOL, type SeriesPoint, type TimelineEvent } from '@vitalog/shared';
import { useMediaQuery } from '../../lib/hooks';

interface Props {
  series: SeriesPoint[];
  unit: string | null;
  events?: TimelineEvent[];
  onEventClick?: (e: TimelineEvent) => void;
  onPointClick?: (p: SeriesPoint) => void;
  height?: number;
  /** Plot raw values (all same unit) instead of display-unit values. */
  label: string;
}

interface Datum { t: number; v: number; p: SeriesPoint; low: number | null; high: number | null }

const shortDate = (t: number) => {
  const d = new Date(t);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCFullYear()).slice(2)}`;
};

/**
 * Trend of ONE biomarker on ONE y-axis in ONE unit. Values that cannot be safely converted to
 * the display unit are excluded by the caller (shown in the table instead).
 * The band is the laboratory's own reference range; when it changes between labs/dates the
 * band steps accordingly instead of being averaged.
 */
export function TrendChart({ series, unit, events = [], onEventClick, onPointClick, height, label }: Props) {
  const small = useMediaQuery('(max-width: 640px)');
  const h = height ?? (small ? 240 : 320);

  const { data, domain, bands, sameRange } = useMemo(() => {
    // Lab range in display units (converted with the same exact rule as the value, or null)
    const data: Datum[] = series
      .filter((p) => p.displayValue !== null)
      .map((p) => ({ t: Date.parse(p.date), v: p.displayValue!, p, low: p.displayRangeLow, high: p.displayRangeHigh }));
    const vals = data.flatMap((d) => [d.v, d.low, d.high]).filter((x): x is number => x !== null);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    const pad = (max - min || Math.abs(max) || 1) * 0.18;
    min = Math.max(min - pad, Math.min(...data.map((d) => d.v)) >= 0 ? 0 : -Infinity);
    max += pad;
    const bands = data.map((d, i) => ({ x1: i === 0 ? d.t : (data[i - 1]!.t + d.t) / 2, x2: i === data.length - 1 ? d.t : (d.t + data[i + 1]!.t) / 2, low: d.low, high: d.high }));
    const first = data[0];
    const sameRange = data.every((d) => d.low === first?.low && d.high === first?.high);
    return { data, domain: [niceFloor(min), niceCeil(max)] as [number, number], bands, sameRange };
  }, [series]);

  if (data.length === 0) return null;
  const t0 = data[0]!.t;
  const t1 = data[data.length - 1]!.t;
  const xPad = Math.max((t1 - t0) * 0.04, 86400_000 * 10);
  const xDomain: [number, number] = [t0 - xPad, t1 + xPad];
  const visibleEvents = events.filter((e) => {
    const t = Date.parse(e.date);
    return t >= xDomain[0] && t <= xDomain[1];
  });
  const latestBand = bands[bands.length - 1];

  return (
    <figure aria-label={`Графика: ${label}${unit ? `, ${unit}` : ''}`} className="w-full">
      <div style={{ height: h }} className="w-full select-none">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: small ? 8 : 24, bottom: 4, left: small ? -12 : 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            {/* reference band(s) – the lab's range */}
            {sameRange && latestBand && (latestBand.low !== null || latestBand.high !== null) ? (
              <>
                <ReferenceArea x1={xDomain[0]} x2={xDomain[1]} y1={latestBand.low ?? domain[0]} y2={latestBand.high ?? domain[1]} fill="var(--band)" stroke="none" ifOverflow="hidden"
                  label={small ? undefined : { value: 'Референтен диапазон', position: 'insideTopRight', fill: 'var(--muted)', fontSize: 11 }} />
                {latestBand.high !== null && <ReferenceLine y={latestBand.high} stroke="var(--band-edge)" strokeDasharray="4 4" ifOverflow="hidden" />}
                {latestBand.low !== null && <ReferenceLine y={latestBand.low} stroke="var(--band-edge)" strokeDasharray="4 4" ifOverflow="hidden" />}
              </>
            ) : (
              bands.map((b, i) => (b.low !== null || b.high !== null) && (
                <ReferenceArea key={i} x1={i === 0 ? xDomain[0] : b.x1} x2={i === bands.length - 1 ? xDomain[1] : b.x2} y1={b.low ?? domain[0]} y2={b.high ?? domain[1]} fill="var(--band)" stroke="none" ifOverflow="hidden" />
              ))
            )}
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={xDomain}
              tickFormatter={shortDate}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-strong)' }}
              minTickGap={small ? 28 : 40}
              tickMargin={8}
            />
            <YAxis
              domain={domain}
              tickLine={false}
              axisLine={false}
              width={small ? 44 : 56}
              tickFormatter={(v: number) => formatNumber(v, 2)}
              tickCount={small ? 4 : 5}
            />
            {visibleEvents.map((e) => (
              <ReferenceLine
                key={e.id}
                x={Date.parse(e.date)}
                stroke="var(--border-strong)"
                strokeDasharray="2 4"
                ifOverflow="hidden"
                label={(props: { viewBox?: { x: number; y: number } }) => (
                  <g
                    transform={`translate(${props.viewBox?.x ?? 0}, ${(props.viewBox?.y ?? 0) + 2})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Събитие: ${e.title}, ${formatDate(e.date)}`}
                    onClick={() => onEventClick?.(e)}
                    onKeyDown={(k) => { if (k.key === 'Enter' || k.key === ' ') onEventClick?.(e); }}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle r="9" fill="transparent" />
                    <rect x="-5" y="-5" width="10" height="10" rx="2" transform="rotate(45)" fill="var(--surface)" stroke="var(--ink-2)" strokeWidth="1.5" />
                  </g>
                )}
              />
            ))}
            <Tooltip
              content={(p) => <ChartTooltip {...(p as unknown as TipProps)} unit={unit} />}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="v"
              stroke="var(--accent)"
              strokeWidth={2}
              isAnimationActive={!small}
              animationDuration={500}
              dot={(props: { cx?: number; cy?: number; payload?: Datum; index?: number }) => {
                const out = props.payload?.p.status === 'above' || props.payload?.p.status === 'below';
                return (
                  <circle
                    key={props.index}
                    cx={props.cx}
                    cy={props.cy}
                    r={5}
                    fill={out ? 'var(--attention)' : 'var(--accent)'}
                    stroke="var(--surface)"
                    strokeWidth={2}
                    onClick={() => props.payload && onPointClick?.(props.payload.p)}
                    style={{ cursor: onPointClick ? 'pointer' : undefined }}
                  />
                );
              }}
              activeDot={{ r: 8, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--accent)' }}
            />
            {data.length > 12 && !small && <Brush dataKey="t" height={24} stroke="var(--border-strong)" fill="var(--surface-2)" tickFormatter={shortDate} travellerWidth={10} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm bg-[var(--band)] ring-1 ring-[var(--band-edge)] ring-inset" />Референтен диапазон на лабораторията</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full bg-accent" />В диапазона</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full bg-attention" />Извън диапазона (↑/↓)</span>
        {visibleEvents.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2 rotate-45 border-[1.5px] border-ink-2" />Събитие</span>}
      </figcaption>
    </figure>
  );
}

export interface TipProps { active?: boolean; payload?: Array<{ payload: unknown }> }

function ChartTooltip({ active, payload, unit }: TipProps & { unit: string | null }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload as Datum;
  const p = d.p;
  const converted = p.value !== null && p.displayValue !== null && Math.abs(p.displayValue - p.value) > 1e-9;
  return (
    <div className="max-w-64 rounded-xl border border-border bg-surface px-3.5 py-3 text-sm shadow-pop">
      <p className="text-muted">{formatDate(p.date)}</p>
      <p className="num mt-0.5 font-display text-lg font-semibold text-ink">
        {p.valueText} <span className="text-sm font-normal text-ink-2">{p.unit}</span>
      </p>
      {converted && <p className="num text-xs text-muted">≈ {formatNumber(p.displayValue)} {unit} (преобразувано)</p>}
      <p className="mt-1 text-ink-2">{STATUS_SYMBOL[p.status]} {STATUS_LABELS[p.status]}</p>
      {(p.rangeLow !== null || p.rangeHigh !== null) && <p className="num text-ink-2">Диапазон: {formatRange(p.rangeLow, p.rangeHigh, p.rangeText)} {p.unit}</p>}
      <p className="mt-1 text-xs text-muted">{p.laboratoryName ?? (p.source === 'manual' ? 'Ръчно въведен' : 'Източник: документ')}{p.edited ? ' · коригиран' : ''}</p>
    </div>
  );
}

function step(span: number) {
  const raw = span / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
}
function niceFloor(v: number) {
  if (!Number.isFinite(v)) return 0;
  const s = step(Math.abs(v) || 1) / 2;
  return Math.floor(v / s) * s;
}
function niceCeil(v: number) {
  const s = step(Math.abs(v) || 1) / 2;
  return Math.ceil(v / s) * s;
}
