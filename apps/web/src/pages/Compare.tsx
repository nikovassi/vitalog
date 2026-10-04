import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { formatDate, formatSigned, type CompareRow, type LabReport, type Paginated } from '@vitalog/shared';
import { get } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { Card, PageHeader } from '../components/ui/Card';
import { Chip, Select } from '../components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { ChangeBadge, StatusBadge } from '../components/ui/Status';

/** Compare two reports side by side: values, change, percent, status. */
export default function Compare() {
  useTitle('Сравни резултати');
  const [params, setParams] = useSearchParams();
  const { data: list } = useQuery({ queryKey: ['reports', 'all-for-compare'], queryFn: () => get<Paginated<LabReport>>('/api/reports?pageSize=100&sort=newest') });
  const reports = list?.items ?? [];
  const [a, setA] = useState(params.get('a') ?? '');
  const [b, setB] = useState(params.get('b') ?? '');
  const [onlyBoth, setOnlyBoth] = useState(true);

  useEffect(() => {
    if (!reports.length) return;
    const bb = b || reports[0]!.id;
    const idx = reports.findIndex((r) => r.id === bb);
    const aa = a || reports[idx + 1]?.id || '';
    if (bb !== b) setB(bb);
    if (aa !== a) setA(aa);
  }, [reports]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (a && b) setParams({ a, b }, { replace: true }); }, [a, b]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always show older → newer, so the change reads forward in time
  const [older, newer] = useMemo(() => {
    const ra = reports.find((r) => r.id === a);
    const rb = reports.find((r) => r.id === b);
    if (!ra || !rb) return [a, b];
    return ra.collectedAt <= rb.collectedAt ? [a, b] : [b, a];
  }, [a, b, reports]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['compare', older, newer],
    queryFn: () => get<{ a: LabReport; b: LabReport; rows: CompareRow[] }>(`/api/reports/compare?a=${older}&b=${newer}`),
    enabled: !!older && !!newer && older !== newer,
  });
  const rows = (data?.rows ?? []).filter((r) => !onlyBoth || (r.a && r.b));

  return (
    <div>
      <PageHeader title="Сравни резултати" subtitle="Избери две изследвания. Промяната се изчислява от по-старото към по-новото." />
      {reports.length < 2 ? <EmptyState title="Нужни са поне две изследвания" text="Качи още едно изследване, за да ги сравниш." /> : (
        <>
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <Select label="Резултат 1" value={a} onChange={(e) => setA(e.target.value)}>
              {reports.map((r) => <option key={r.id} value={r.id} disabled={r.id === b}>{formatDate(r.collectedAt)} · {r.title} · {r.laboratory?.name ?? ''}</option>)}
            </Select>
            <ArrowRight className="mx-auto mb-3 hidden size-5 text-muted sm:block" aria-hidden />
            <Select label="Резултат 2" value={b} onChange={(e) => setB(e.target.value)}>
              {reports.map((r) => <option key={r.id} value={r.id} disabled={r.id === a}>{formatDate(r.collectedAt)} · {r.title} · {r.laboratory?.name ?? ''}</option>)}
            </Select>
          </div>
          <div className="mt-4 flex gap-2">
            <Chip active={onlyBoth} onClick={() => setOnlyBoth(true)}>Общи показатели</Chip>
            <Chip active={!onlyBoth} onClick={() => setOnlyBoth(false)}>Всички</Chip>
          </div>
          <Card className="mt-4 overflow-hidden">
            {isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
              : error ? <div className="p-4"><ErrorState error={error} /></div>
              : data && (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-[15px]">
                      <thead className="bg-surface-2 text-sm text-muted">
                        <tr>
                          <th className="px-4 py-2.5 font-medium">Показател</th>
                          <th className="px-4 py-2.5 font-medium num">{formatDate(data.a.collectedAt)}</th>
                          <th className="px-4 py-2.5 font-medium num">{formatDate(data.b.collectedAt)}</th>
                          <th className="px-4 py-2.5 font-medium">Промяна</th>
                          <th className="px-4 py-2.5 font-medium">%</th>
                          <th className="px-4 py-2.5 font-medium">Статус (последен)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {rows.map((r) => (
                          <tr key={r.biomarkerId}>
                            <th scope="row" className="px-4 py-3 font-medium">{r.name}</th>
                            <td className="num px-4 py-3">{r.a ? `${r.a.valueText} ${r.a.unit ?? ''}` : '—'}</td>
                            <td className="num px-4 py-3 font-semibold">{r.b ? `${r.b.valueText} ${r.b.unit ?? ''}` : '—'}</td>
                            <td className="px-4 py-3">{r.comparable ? <ChangeBadge change={r.change} showPercent={false} /> : <span className="text-sm text-muted">{r.a && r.b ? 'различни единици' : '—'}</span>}</td>
                            <td className="num px-4 py-3 text-ink-2">{r.change?.percent != null ? `${formatSigned(r.change.percent, 1)}%` : '—'}</td>
                            <td className="px-4 py-3">{(r.b ?? r.a) && <StatusBadge status={(r.b ?? r.a)!.status} short />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="divide-y divide-border md:hidden">
                    {rows.map((r) => (
                      <li key={r.biomarkerId} className="p-4">
                        <p className="font-medium">{r.name}</p>
                        <div className="num mt-1 flex items-center gap-2 text-[15px]">
                          <span className="text-ink-2">{r.a ? `${r.a.valueText}` : '—'}</span>
                          <ArrowRight className="size-4 text-muted" aria-label="до" />
                          <span className="font-semibold">{r.b ? `${r.b.valueText} ${r.b.unit ?? ''}` : '—'}</span>
                          {r.change?.percent != null && <span className="ml-auto text-sm text-ink-2">{formatSigned(r.change.percent, 1)}%</span>}
                        </div>
                        {(r.b ?? r.a) && <StatusBadge status={(r.b ?? r.a)!.status} short className="mt-1.5" />}
                      </li>
                    ))}
                  </ul>
                  {!rows.length && <p className="p-6 text-center text-muted">Няма общи показатели.</p>}
                </>
              )}
          </Card>
        </>
      )}
    </div>
  );
}
