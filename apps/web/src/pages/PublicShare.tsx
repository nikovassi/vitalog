import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { DISCLAIMER, formatDate, formatDateTime, formatRange, type BiomarkerSummary, type SeriesPoint, type Specialist } from '@vitalog/shared';
import { get } from '../lib/api';
import { useNoIndex, useTitle } from '../lib/hooks';
import { Card } from '../components/ui/Card';
import { Logo } from '../components/ui/Logo';
import { ErrorState, PageSkeleton } from '../components/ui/Feedback';
import { StatusBadge } from '../components/ui/Status';
import { TrendChart } from '../components/charts/TrendChart';

interface Shared { label: string; sharedBy: string; expiresAt: string; from: string | null; biomarkers: Array<{ summary: BiomarkerSummary; series: SeriesPoint[] }>; specialists: Specialist[] }

/** Read-only view for a doctor. No login, no documents, noindex, expires. */
export default function PublicShare() {
  useNoIndex();
  useTitle('Споделени резултати');
  const { token = '' } = useParams();
  const { data, isLoading, error } = useQuery({ queryKey: ['public-share', token], queryFn: () => get<Shared>(`/api/public/share/${encodeURIComponent(token)}`), retry: false });
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface"><div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4"><Logo /><span className="flex items-center gap-1.5 text-sm text-muted"><Lock className="size-4" />Само за четене</span></div></header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {isLoading ? <PageSkeleton /> : error || !data ? <ErrorState error={error} /> : (
          <>
            <h1 className="font-display text-2xl font-bold">Лабораторни резултати, споделени от {data.sharedBy}</h1>
            <p className="mt-1 text-muted">Линкът е валиден до <span className="num">{formatDateTime(data.expiresAt)}</span>{data.from && <> · данни от <span className="num">{formatDate(data.from)}</span></>}</p>
            <p className="mt-3 text-sm text-muted">{DISCLAIMER} Стойностите са извлечени от документи на лабораториите и потвърдени от пациента.</p>
            <div className="mt-6 space-y-4">
              {data.biomarkers.map(({ summary: s, series }) => (
                <Card key={s.id} className="p-4 sm:p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-display text-lg font-semibold">{s.name}</h2><span className="text-sm text-muted">{s.unit}</span></div>
                  {series.filter((p) => p.displayValue !== null).length >= 2 && <TrendChart series={series} unit={s.unit} label={s.name} height={220} />}
                  <table className="mt-3 w-full text-left text-sm">
                    <thead className="text-muted"><tr><th className="py-1 font-medium">Дата</th><th className="py-1 font-medium">Стойност</th><th className="py-1 font-medium">Реф. диапазон</th><th className="py-1 font-medium">Статус</th></tr></thead>
                    <tbody className="divide-y divide-border">{[...series].reverse().map((p, i) => (
                      <tr key={i}><td className="num py-1.5">{formatDate(p.date)}</td><td className="num py-1.5 font-medium">{p.valueText} {p.unit}</td><td className="num py-1.5">{formatRange(p.rangeLow, p.rangeHigh, p.rangeText)}</td><td className="py-1.5"><StatusBadge status={p.status} short /></td></tr>
                    ))}</tbody>
                  </table>
                </Card>
              ))}
              {data.specialists.length > 0 && (
                <Card className="p-4 sm:p-6"><h2 className="font-display text-lg font-semibold">Специалисти</h2><ul className="mt-2 space-y-1 text-[15px]">{data.specialists.map((s) => <li key={s.id}>{s.name} · {s.specialty}{s.clinic && ` · ${s.clinic}`}</li>)}</ul></Card>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
