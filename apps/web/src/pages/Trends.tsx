import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Info, Search, X } from 'lucide-react';
import { formatDate, formatNumber, type BiomarkerDetail, type BiomarkerSummary } from '@vitalog/shared';
import { get } from '../lib/api';
import { presetFrom, RANGE_LABELS, useTitle, type RangePreset } from '../lib/hooks';
import { Card, PageHeader } from '../components/ui/Card';
import { Chip, Segmented } from '../components/ui/Form';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { MultiLineChart } from '../components/charts/MultiLineChart';
import { TrendChart } from '../components/charts/TrendChart';

const MAX_PER_AXIS = 3;
const DEFAULT = ['hdl', 'ldl', 'triglycerides'];

export default function Trends() {
  useTitle('Графики');
  const [params, setParams] = useSearchParams();
  const { data: all } = useQuery({ queryKey: ['biomarkers', 'sort=most_measured'], queryFn: () => get<BiomarkerSummary[]>('/api/biomarkers?sort=most_measured') });
  const [preset, setPreset] = useState<RangePreset>('all');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [filter, setFilter] = useState('');
  const available = (all ?? []).filter((s) => s.count >= 1);
  const selected = useMemo(() => {
    const fromUrl = params.get('keys')?.split(',').filter(Boolean);
    if (fromUrl?.length) return fromUrl;
    const d = DEFAULT.filter((k) => available.some((s) => s.id === k));
    return d.length ? d : available.slice(0, 2).map((s) => s.id);
  }, [params, available]);
  const toggle = (k: string) => {
    const next = selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k].slice(-6);
    setParams({ keys: next.join(',') }, { replace: true });
  };

  const details = useQueries({ queries: selected.map((k) => ({ queryKey: ['biomarker', k, 'all'], queryFn: () => get<BiomarkerDetail>(`/api/biomarkers/${encodeURIComponent(k)}`) })) });
  const from = presetFrom(preset);
  const loaded = details.map((d) => d.data).filter((d): d is BiomarkerDetail => !!d).map((d) => ({ ...d, series: d.series.filter((p) => !from || p.date >= from) }));

  // Group by display unit; never put different units on one axis; max 3 lines per chart
  const groups = useMemo(() => {
    const byUnit = new Map<string, typeof loaded>();
    for (const d of loaded) {
      const u = d.summary.unit ?? '—';
      byUnit.set(u, [...(byUnit.get(u) ?? []), d]);
    }
    const out: Array<{ unit: string; items: typeof loaded }> = [];
    for (const [unit, items] of byUnit) for (let i = 0; i < items.length; i += MAX_PER_AXIS) out.push({ unit, items: items.slice(i, i + MAX_PER_AXIS) });
    return out;
  }, [loaded]);

  const tableDates = [...new Set(loaded.flatMap((d) => d.series.map((p) => p.date)))].sort().reverse();

  return (
    <div>
      <PageHeader title="Графики" subtitle="Сравни няколко показателя във времето" />
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Избрани:</span>
          {selected.map((k) => {
            const s = available.find((x) => x.id === k);
            return <button key={k} onClick={() => toggle(k)} className="inline-flex h-9 items-center gap-1 rounded-full bg-accent-soft pr-2 pl-3.5 text-sm font-medium text-accent-soft-ink" aria-label={`Премахни ${s?.name ?? k}`}>{s?.name ?? k}<X className="size-4" aria-hidden /></button>;
          })}
        </div>
        <label className="relative mt-3 block">
          <span className="sr-only">Добави показател</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Добави показател…" className="h-10 w-full rounded-xl border border-border bg-surface pr-3 pl-9 text-[15px] focus:border-accent focus:outline-none" />
        </label>
        <div className="scrollbar-none mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto">
          {available.filter((s) => !selected.includes(s.id) && s.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 30).map((s) => (
            <Chip key={s.id} onClick={() => toggle(s.id)}>+ {s.name}</Chip>
          ))}
        </div>
      </Card>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented label="Период" value={preset} onChange={setPreset} options={(['3m', '6m', '1y', '3y', 'all'] as RangePreset[]).map((v) => ({ value: v, label: RANGE_LABELS[v] }))} />
        <Segmented label="Изглед" value={view} onChange={setView} options={[{ value: 'chart', label: 'Графика' }, { value: 'table', label: 'Таблица' }]} />
      </div>

      {groups.length > 1 && (
        <p className="mt-4 flex items-start gap-2 text-sm text-muted"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />Показателите с различни мерни единици са в отделни графики, за да не се сравняват несъпоставими стойности на една ос.</p>
      )}

      <div className="mt-4 space-y-4">
        {!selected.length ? <EmptyState title="Избери показатели" text="Добави един или повече показатели, за да ги видиш във времето." />
          : details.some((d) => d.isLoading) ? <Skeleton className="h-80" />
          : view === 'table' ? (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-[15px]">
                <thead className="bg-surface-2 text-sm text-muted"><tr><th className="px-4 py-2.5 font-medium">Дата</th>{loaded.map((d) => <th key={d.summary.id} className="px-4 py-2.5 font-medium">{d.summary.name} <span className="font-normal">({d.summary.unit})</span></th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {tableDates.map((date) => (
                    <tr key={date}><td className="num px-4 py-2.5">{formatDate(date)}</td>
                      {loaded.map((d) => { const p = d.series.find((x) => x.date === date); return <td key={d.summary.id} className="num px-4 py-2.5">{p ? `${p.valueText} ${p.unit ?? ''}` : '—'}</td>; })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : groups.map((g) => (
            <Card key={g.unit + g.items.map((i) => i.summary.id).join()} className="p-4 sm:p-6">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-lg font-semibold">{g.items.map((i) => <Link key={i.summary.id} to={`/app/biomarkers/${encodeURIComponent(i.summary.id)}`} className="hover:underline">{i.summary.name}</Link>).reduce<React.ReactNode[]>((a, el, idx) => (idx ? [...a, ', ', el] : [el]), [])}</h2>
                <span className="text-sm text-muted">{g.unit}</span>
              </div>
              {g.items.length === 1
                ? (g.items[0]!.series.filter((p) => p.displayValue !== null).length >= 2
                  ? <TrendChart series={g.items[0]!.series} unit={g.items[0]!.summary.unit} label={g.items[0]!.summary.name} events={g.items[0]!.events} />
                  : <p className="py-8 text-center text-muted">Качи поне две изследвания, за да видиш тенденцията. {g.items[0]!.summary.latest && `Последно: ${g.items[0]!.summary.latest.valueText} ${g.items[0]!.summary.unit ?? ''}`}</p>)
                : <MultiLineChart unit={g.unit} series={g.items.map((i) => ({ key: i.summary.id, name: i.summary.name, points: i.series }))} />}
              {g.items.length > 1 && <p className="mt-2 text-xs text-muted">Референтните диапазони са показани в графиката на всеки показател поотделно (те се различават между показателите). Последни стойности: {g.items.map((i) => `${i.summary.name} ${formatNumber(i.summary.latest?.displayValue)}`).join(' · ')}.</p>}
            </Card>
          ))}
      </div>
    </div>
  );
}
