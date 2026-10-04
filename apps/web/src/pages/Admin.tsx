import { useQuery } from '@tanstack/react-query';
import { formatBytes, formatDateTime } from '@vitalog/shared';
import { get } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { Card, PageHeader } from '../components/ui/Card';
import { Alert, ErrorState, PageSkeleton } from '../components/ui/Feedback';
import { JOB_ERRORS } from '../lib/util';

/** Operational metadata only. Medical values are deliberately not available here. */
export default function Admin() {
  useTitle('Администрация');
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => get<Record<string, number> & { jobs: Array<{ stage: string; n: number }> }>('/api/admin/stats') });
  const failed = useQuery({ queryKey: ['admin', 'failed'], queryFn: () => get<Array<{ id: string; errorCode: string; usedOcr: boolean; pagesTotal: number | null; createdAt: string }>>('/api/admin/jobs/failed') });
  const sec = useQuery({ queryKey: ['admin', 'sec'], queryFn: () => get<Array<{ action: string; at: string; ipPrefix: string }>>('/api/admin/security-events') });
  if (stats.isLoading) return <PageSkeleton />;
  if (stats.error) return <ErrorState error={stats.error} />;
  const s = stats.data!;
  const tiles = [['Потребители', s.users], ['Демо профили', s.demo_users], ['Документи', s.documents], ['Хранилище', formatBytes(s.storage_bytes ?? 0)], ['Резултати', s.results], ['Обработени (месец)', s.processed_month], ['AI заявки (месец)', s.ai_calls_month]];
  return (
    <div className="space-y-5">
      <PageHeader title="Администрация" subtitle="Само оперативни метаданни" />
      <Alert tone="info">По дизайн администраторите нямат достъп до медицински стойности, документи или бележки на потребителите.</Alert>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{tiles.map(([l, v]) => <Card key={l as string} className="p-4"><p className="text-sm text-muted">{l}</p><p className="num font-display text-2xl font-bold">{v ?? 0}</p></Card>)}</div>
      <Card className="p-5"><h2 className="mb-2 font-semibold">Задачи по етап</h2><ul className="num flex flex-wrap gap-3 text-sm">{s.jobs.map((j) => <li key={j.stage} className="rounded-lg bg-surface-2 px-3 py-1.5">{j.stage}: {j.n}</li>)}</ul></Card>
      <Card className="p-5"><h2 className="mb-2 font-semibold">Неуспешни обработки</h2>
        <ul className="divide-y divide-border text-sm">{failed.data?.map((f) => <li key={f.id} className="flex justify-between gap-3 py-2"><span>{JOB_ERRORS[f.errorCode]?.title ?? f.errorCode}{f.usedOcr ? ' · OCR' : ''}</span><span className="num text-muted">{formatDateTime(f.createdAt)}</span></li>)}</ul>
        {!failed.data?.length && <p className="text-sm text-muted">Няма.</p>}
      </Card>
      <Card className="p-5"><h2 className="mb-2 font-semibold">Събития по сигурността (7 дни)</h2>
        <ul className="max-h-80 divide-y divide-border overflow-y-auto text-sm">{sec.data?.map((e, i) => <li key={i} className="flex justify-between gap-3 py-2"><span>{e.action}</span><span className="num text-muted">{e.ipPrefix} · {formatDateTime(e.at)}</span></li>)}</ul>
      </Card>
    </div>
  );
}
