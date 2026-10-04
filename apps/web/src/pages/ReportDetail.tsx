import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowLeftRight, Eye, FileText, History, Pencil, Stethoscope, Trash2 } from 'lucide-react';
import {
  formatDate, formatRange, normalizeAliasKey, plural, type ReportDetail as Detail, type ReportResultRow, type Specialist,
} from '@vitalog/shared';
import { del, get, patch } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { Card, PageHeader } from '../components/ui/Card';
import { Button, IconButton } from '../components/ui/Button';
import { Chip, Select } from '../components/ui/Form';
import { Alert, ErrorState, PageSkeleton, useToast } from '../components/ui/Feedback';
import { ConfirmDialog } from '../components/ui/Dialog';
import { ChangeBadge, StatusBadge } from '../components/ui/Status';
import { PdfViewer } from '../components/documents/PdfViewer';
import { EditResultDialog, HistoryDialog, type EditableResult } from '../components/health/ResultDialogs';
import { Notes } from '../components/health/Notes';

const TYPE_LABEL: Record<string, string> = { blood: 'Кръвни изследвания', hormones: 'Хормонални изследвания', urine: 'Изследване на урина', biochemistry: 'Биохимични изследвания', mixed: 'Смесени', other: 'Друго' };
const SOURCE: Record<string, string> = { pdf: 'Лабораторен PDF', manual: 'Ръчно въведен', import: 'Импортирани данни', device: 'Устройство' };

export default function ReportDetail() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'out' | 'in'>('all');
  const [pdf, setPdf] = useState<number | null | false>(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [edit, setEdit] = useState<EditableResult | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report', id], queryFn: () => get<Detail>(`/api/reports/${id}`) });
  const { data: specialists } = useQuery({ queryKey: ['specialists'], queryFn: () => get<Specialist[]>('/api/specialists') });
  useTitle(data ? `${data.report.title} ${formatDate(data.report.collectedAt)}` : 'Изследване');

  const link = useMutation({
    mutationFn: (specialistId: string | null) => patch(`/api/reports/${id}`, { specialistId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['report', id] }); toast('Специалистът е свързан с изследването.'); },
  });
  const remove = useMutation({
    mutationFn: () => del(`/api/reports/${id}`),
    onSuccess: () => { void qc.invalidateQueries(); toast('Изследването е изтрито.', 'info'); navigate('/app/reports', { replace: true }); },
  });

  const rows = useMemo(() => (data?.results ?? []).filter((r) => filter === 'all' || (filter === 'out' ? r.status === 'above' || r.status === 'below' : r.status === 'in_range')), [data, filter]);
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const { report: r } = data;
  const out = data.results.filter((x) => x.status === 'above' || x.status === 'below').length;
  const editRow = (x: ReportResultRow) => setEdit({ id: x.id, name: x.biomarkerName, valueText: x.valueText, unit: x.unit, rangeLow: x.referenceRange?.low ?? null, rangeHigh: x.referenceRange?.high ?? null });

  return (
    <div>
      {params.get('added') && <Alert tone="success" className="mb-5" title="Изследването е добавено към твоята здравна история.">Можеш да отвориш всеки показател, за да видиш графиката му във времето.</Alert>}
      <PageHeader
        back={<Link to="/app/reports" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="size-4" />Моите изследвания</Link>}
        title={r.title}
        subtitle={<span className="num">{formatDate(r.collectedAt)} · {r.laboratory?.name ?? 'Без лаборатория'} · {TYPE_LABEL[r.reportType] ?? r.reportType}</span>}
        actions={<>
          {data.document && <Button variant="secondary" icon={<Eye className="size-4" />} onClick={() => setPdf(null)}>Виж оригиналния PDF</Button>}
          <Button variant="secondary" icon={<ArrowLeftRight className="size-4" />} onClick={() => navigate(`/app/compare?b=${r.id}`)}>Сравни</Button>
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-sm text-muted">Показатели</p><p className="num font-display text-2xl font-bold">{r.resultCount}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Извън референтния диапазон</p><p className="num font-display text-2xl font-bold">{out}</p></Card>
        <Card className="p-4">
          <Select label={<span className="inline-flex items-center gap-1.5"><Stethoscope className="size-4" />Свързан специалист</span>} value={r.specialistId ?? ''} onChange={(e) => link.mutate(e.target.value || null)}>
            <option value="">— Няма —</option>
            {specialists?.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.specialty}</option>)}
          </Select>
        </Card>
      </div>

      {r.labComment && <Alert tone="info" className="mt-4" title="Коментар от лабораторията">{r.labComment}</Alert>}

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="font-display text-lg font-semibold">Всички показатели</h2>
          <div className="flex gap-2" role="group" aria-label="Филтър">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>Всички</Chip>
            <Chip active={filter === 'in'} onClick={() => setFilter('in')}>✓ В диапазона</Chip>
            <Chip active={filter === 'out'} onClick={() => setFilter('out')}>Извън ({out})</Chip>
          </div>
        </div>
        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-[15px]">
            <caption className="sr-only">Резултати от {formatDate(r.collectedAt)}</caption>
            <thead className="bg-surface-2 text-sm text-muted">
              <tr>{['Показател', 'Резултат', 'Единица', 'Реф. диапазон', 'Статус', 'Предишна', 'Промяна', ''].map((h, i) => <th key={i} scope="col" className="px-4 py-2.5 font-medium">{h || <span className="sr-only">Действия</span>}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((x) => (
                <tr key={x.id} className="hover:bg-surface-2/60">
                  <th scope="row" className="px-4 py-3 font-medium">
                    <Link to={`/app/biomarkers/${encodeURIComponent(x.biomarkerId ?? `custom:${normalizeAliasKey(x.originalName).slice(0, 80)}`)}`} className="hover:text-accent hover:underline">{x.biomarkerName}</Link>
                    {x.originalName !== x.biomarkerName && <span className="block text-xs font-normal text-muted">{x.originalName}</span>}
                  </th>
                  <td className="num px-4 py-3 font-semibold">{x.valueText}{x.edited && <span className="ml-1 text-xs font-normal text-muted" title="Коригиран от теб">*</span>}</td>
                  <td className="px-4 py-3 text-ink-2">{x.unit ?? '—'}</td>
                  <td className="num px-4 py-3 text-ink-2">{x.referenceRange ? formatRange(x.referenceRange.low, x.referenceRange.high, x.referenceRange.text) : '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={x.status} short /></td>
                  <td className="num px-4 py-3 text-ink-2">{x.previous ? <>{x.previous.valueText} <span className="text-xs text-muted">({formatDate(x.previous.date)})</span></> : '—'}</td>
                  <td className="px-4 py-3"><ChangeBadge change={x.change} showPercent /></td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <IconButton label="Редактирай" className="size-9" onClick={() => editRow(x)}><Pencil className="size-4" /></IconButton>
                    <IconButton label="История" className="size-9" onClick={() => setHistoryId(x.id)}><History className="size-4" /></IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <ul className="divide-y divide-border md:hidden">
          {rows.map((x) => (
            <li key={x.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <Link to={`/app/biomarkers/${encodeURIComponent(x.biomarkerId ?? `custom:${normalizeAliasKey(x.originalName).slice(0, 80)}`)}`} className="min-w-0 font-medium hover:underline">{x.biomarkerName}</Link>
                <p className="num shrink-0 text-right font-semibold">{x.valueText} <span className="text-sm font-normal text-muted">{x.unit}</span></p>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <StatusBadge status={x.status} short />
                {x.referenceRange && <span className="num text-muted">Диапазон {formatRange(x.referenceRange.low, x.referenceRange.high, x.referenceRange.text)}</span>}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-sm text-muted">
                <span className="num">{x.previous ? `Преди: ${x.previous.valueText} (${formatDate(x.previous.date)})` : 'Първо измерване'}</span>
                <ChangeBadge change={x.change} showPercent={false} />
              </div>
              <div className="mt-1 flex gap-1">
                <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => editRow(x)}>Редактирай</Button>
                <Button size="sm" variant="ghost" icon={<History className="size-4" />} onClick={() => setHistoryId(x.id)}>История</Button>
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-4 py-3 text-sm text-muted">
          Статусът е спрямо референтния диапазон на лабораторията. * – коригирано от теб.
          {' '}Източник: {SOURCE[data.results[0]?.source ?? 'pdf']}{data.document && <> · <FileText className="inline size-3.5" aria-hidden /> {data.document.name}</>}
        </p>
      </Card>

      <Card className="mt-5 p-4 sm:p-6">
        <h2 className="mb-3 font-display text-lg font-semibold">Бележки</h2>
        <Notes notes={data.notes} targetType="report" targetId={id} invalidate={['report', id]} />
      </Card>

      <div className="mt-8 flex justify-end">
        <Button variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Изтрий изследването</Button>
      </div>

      {data.document && <PdfViewer documentId={data.document.id} name={data.document.name} open={pdf !== false} page={pdf || null} onClose={() => setPdf(false)} />}
      <EditResultDialog result={edit} onClose={() => setEdit(null)} />
      <HistoryDialog id={historyId} onClose={() => setHistoryId(null)} />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => remove.mutate()} loading={remove.isPending}
        title="Сигурен ли си?" text={<>Изследването и {plural(r.resultCount, 'показателят', 'показателите')} в него ще бъдат изтрити необратимо. Оригиналният PDF остава в „Документи“, докато не го изтриеш.</>} />
    </div>
  );
}
