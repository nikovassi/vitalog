import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, History, ImageDown, Pencil, Star, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import {
  CATEGORY_LABELS, describeChange, DIRECTION_LABELS, formatDate, formatRange, formatSigned, plural,
  type BiomarkerDetail as Detail, type SeriesPoint, type TimelineEvent,
} from '@vitalog/shared';
import { del, downloadBlob, get, put } from '../lib/api';
import { presetFrom, RANGE_LABELS, useTitle, type RangePreset } from '../lib/hooks';
import { Card, PageHeader } from '../components/ui/Card';
import { Button, IconButton } from '../components/ui/Button';
import { Input, Segmented } from '../components/ui/Form';
import { Alert, EmptyState, ErrorState, PageSkeleton } from '../components/ui/Feedback';
import { Dialog } from '../components/ui/Dialog';
import { StatusBadge } from '../components/ui/Status';
import { TrendChart } from '../components/charts/TrendChart';
import { exportChartPng } from '../components/charts/exportChart';
import { DeleteResultDialog, EditResultDialog, HistoryDialog, type EditableResult } from '../components/health/ResultDialogs';
import { Notes } from '../components/health/Notes';
import { PdfViewer } from '../components/documents/PdfViewer';

const EVENT_LABELS: Record<string, string> = {
  appointment: 'Преглед', medication_start: 'Начало на медикамент', medication_stop: 'Край на медикамент', diet_change: 'Промяна в храненето',
  exercise: 'Спортна програма', vaccination: 'Ваксина', imaging: 'Образно изследване', note: 'Бележка', other: 'Събитие', lab_report: 'Кръвно изследване',
};

export default function BiomarkerDetail() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [preset, setPreset] = useState<RangePreset>('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [event, setEvent] = useState<TimelineEvent | null>(null);
  const [edit, setEdit] = useState<EditableResult | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ id: string; page: number | null } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['biomarker', key, 'all'], queryFn: () => get<Detail>(`/api/biomarkers/${encodeURIComponent(key)}`) });
  useTitle(data?.summary.name ?? 'Показател');
  const fav = useMutation({
    mutationFn: (on: boolean) => (on ? put(`/api/biomarkers/${encodeURIComponent(key)}/favorite`) : del(`/api/biomarkers/${encodeURIComponent(key)}/favorite`)),
    onSuccess: () => qc.invalidateQueries(),
  });

  const from = preset === 'custom' ? custom.from || null : presetFrom(preset);
  const to = preset === 'custom' ? custom.to || null : null;
  const series = useMemo(() => (data?.series ?? []).filter((p) => (!from || p.date >= from) && (!to || p.date <= to)), [data, from, to]);

  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const { summary: s, biomarker: bm } = data;
  const l = s.latest;
  const chartable = series.filter((p) => p.displayValue !== null);
  const excluded = series.length - chartable.length;
  const ranges = [...new Map(data.series.filter((p) => p.rangeLow !== null || p.rangeHigh !== null).map((p) => [`${p.laboratoryName}|${p.rangeLow}|${p.rangeHigh}|${p.unit}`, p])).values()];
  const sources = [...new Map(data.series.filter((p) => p.sourceDocumentId).map((p) => [p.sourceDocumentId, p])).values()];

  return (
    <div>
      <PageHeader
        back={<Link to="/app/biomarkers" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="size-4" />Всички показатели</Link>}
        title={<span className="flex items-center gap-2">{s.name}
          <IconButton label={s.favorite ? 'Премахни от любими' : 'Добави в любими'} onClick={() => fav.mutate(!s.favorite)} aria-pressed={s.favorite}>
            <Star className={clsx('size-5', s.favorite && 'fill-current text-attention')} />
          </IconButton></span>}
        subtitle={<>{CATEGORY_LABELS[s.category]}{bm && bm.canonicalName !== s.name && <> · {bm.canonicalName}</>} · {plural(s.count, 'измерване', 'измервания')}</>}
        actions={<Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={() => downloadBlob('GET', `/api/export/csv?biomarkers=${encodeURIComponent(key)}`, `${s.name}.csv`)}>CSV</Button>}
      />

      {/* Key facts */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="col-span-2 p-4 sm:p-5 lg:col-span-1">
          <p className="text-sm text-muted">Последна стойност</p>
          <p className="num mt-1 font-display text-3xl font-bold">{l?.valueText}<span className="ml-1.5 text-base font-medium text-muted">{l?.unit}</span></p>
          {l && <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={l.status} short /><span className="num text-sm text-muted">{formatDate(l.date)}</span></div>}
        </Card>
        <Card className="p-4 sm:p-5">
          <p className="text-sm text-muted">Предишна стойност</p>
          <p className="num mt-1 font-display text-2xl font-semibold">{s.previous ? <>{s.previous.valueText} <span className="text-sm font-normal text-muted">{s.previous.unit}</span></> : '—'}</p>
          {s.previous && <p className="num text-sm text-muted">{formatDate(s.previous.date)}</p>}
        </Card>
        <Card className="p-4 sm:p-5">
          <p className="text-sm text-muted">Промяна</p>
          <p className="num mt-1 font-display text-2xl font-semibold">{s.change?.percent != null ? `${formatSigned(s.change.percent, 1)}%` : '—'}</p>
          {s.change && <p className="num text-sm text-muted">{formatSigned(s.change.absolute)} {s.unit}</p>}
        </Card>
        <Card className="col-span-2 p-4 sm:p-5 lg:col-span-1">
          <p className="text-sm text-muted">Тенденция</p>
          <p className="mt-1 font-display text-xl font-semibold">{s.change ? DIRECTION_LABELS[s.change.direction] : '—'}</p>
          <p className="text-sm text-muted">{s.change ? describeChange(s.change) : 'Нужни са поне две измервания.'}</p>
        </Card>
      </div>

      {/* Chart / table */}
      <Card className="mt-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Segmented label="Период" value={preset} onChange={setPreset} options={(Object.keys(RANGE_LABELS) as RangePreset[]).map((v) => ({ value: v, label: RANGE_LABELS[v] }))} />
          <div className="flex items-center gap-2">
            <Segmented label="Изглед" value={view} onChange={setView} options={[{ value: 'chart', label: 'Графика' }, { value: 'table', label: 'Таблица' }]} />
            {view === 'chart' && chartable.length >= 2 && <IconButton label="Изтегли графиката като PNG" onClick={() => exportChartPng(chartRef.current, `${s.name}.png`)}><ImageDown className="size-5" /></IconButton>}
          </div>
        </div>
        {preset === 'custom' && (
          <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
            <Input type="date" label="От" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <Input type="date" label="До" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        {s.mixedUnits && <Alert tone="info" className="mt-4">Някои измервания са в мерни единици, които не могат да бъдат безопасно преобразувани в {s.unit}. Те са показани само в таблицата.</Alert>}

        <div className="mt-5" ref={chartRef}>
          {view === 'chart' ? (
            chartable.length >= 2
              ? <TrendChart series={series} unit={s.unit} label={s.name} events={data.events} onEventClick={setEvent} onPointClick={(p) => p.reportId && navigate(`/app/reports/${p.reportId}`)} />
              : <EmptyState title={series.length ? 'Качи поне две изследвания, за да видиш тенденцията.' : 'Няма измервания в избрания период.'} text={chartable.length === 1 ? `Единствено измерване: ${chartable[0]!.valueText} ${chartable[0]!.unit ?? ''} на ${formatDate(chartable[0]!.date)}.` : undefined} />
          ) : <SeriesTable series={[...series].reverse()} onEdit={(p) => setEdit({ id: p.resultId, name: s.name, valueText: p.valueText, unit: p.unit, rangeLow: p.rangeLow, rangeHigh: p.rangeHigh })} onHistory={setHistoryId} onDelete={setDeleteId} />}
          {view === 'chart' && excluded > 0 && <p className="mt-2 text-sm text-muted">{plural(excluded, 'измерване не е', 'измервания не са')} на графиката (непреобразувана единица или стойност „&lt;/&gt;“) – виж таблицата.</p>}
        </div>
      </Card>

      {view === 'chart' && (
        <Card className="mt-5 p-4 sm:p-6">
          <h2 className="font-display text-lg font-semibold">Всички измервания</h2>
          <div className="mt-3"><SeriesTable series={[...data.series].reverse()} onEdit={(p) => setEdit({ id: p.resultId, name: s.name, valueText: p.valueText, unit: p.unit, rangeLow: p.rangeLow, rangeHigh: p.rangeHigh })} onHistory={setHistoryId} onDelete={setDeleteId} /></div>
        </Card>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="p-4 sm:p-6">
          <h2 className="font-display text-lg font-semibold">Референтен диапазон</h2>
          <p className="mt-1 text-sm text-muted">Диапазоните идват от лабораториите и могат да се различават между тях. Vitalog не ги заменя с общи стойности.</p>
          <ul className="mt-3 space-y-2">
            {ranges.length ? ranges.map((p) => (
              <li key={`${p.laboratoryName}${p.rangeLow}${p.rangeHigh}${p.unit}`} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[15px]">
                <span className="min-w-0 truncate">{p.laboratoryName ?? (p.source === 'manual' ? 'Въведен ръчно' : 'Документ')}</span>
                <span className="num shrink-0 font-medium">{formatRange(p.rangeLow, p.rangeHigh, p.rangeText)} {p.unit}</span>
              </li>
            )) : <li className="text-[15px] text-muted">Няма референтен диапазон в документите.</li>}
          </ul>
          {bm && <p className="mt-4 text-[15px] text-ink-2">{bm.description}</p>}
          {bm?.loinc && <p className="mt-1 text-xs text-muted">LOINC {bm.loinc}</p>}
        </Card>
        <Card className="p-4 sm:p-6">
          <h2 className="font-display text-lg font-semibold">Източници</h2>
          <ul className="mt-3 space-y-1">
            {sources.map((p) => (
              <li key={p.sourceDocumentId}>
                <button onClick={() => setPdf({ id: p.sourceDocumentId!, page: p.sourcePage })} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2">
                  <FileText className="size-5 shrink-0 text-ink-2" aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{p.laboratoryName ?? 'Документ'}</span><span className="num block text-sm text-muted">{formatDate(p.date)}{p.sourcePage ? ` · стр. ${p.sourcePage}` : ''}</span></span>
                  <span className="text-sm font-medium text-accent">Виж PDF</span>
                </button>
              </li>
            ))}
            {data.series.some((p) => p.source === 'manual') && <li className="px-2 py-2 text-[15px] text-muted">+ ръчно въведени стойности</li>}
          </ul>
        </Card>
      </div>

      <Card className="mt-5 p-4 sm:p-6">
        <h2 className="font-display text-lg font-semibold">Бележки</h2>
        <p className="mt-1 mb-3 text-sm text-muted">Контекст за теб – например промяна в храненето. Събитията от хронологията се показват на графиката.</p>
        <Notes notes={data.notes} targetType="biomarker" targetId={key} invalidate={['biomarker', key]} />
      </Card>

      <Dialog open={!!event} onClose={() => setEvent(null)} title={event?.title ?? ''}>
        {event && <div className="space-y-1 text-[15px]"><p className="text-muted">{EVENT_LABELS[event.kind] ?? 'Събитие'} · <span className="num">{formatDate(event.date)}</span></p>{event.description && <p>{event.description}</p>}</div>}
      </Dialog>
      <EditResultDialog result={edit} onClose={() => setEdit(null)} />
      <HistoryDialog id={historyId} onClose={() => setHistoryId(null)} />
      <DeleteResultDialog id={deleteId} onClose={() => setDeleteId(null)} />
      {pdf && <PdfViewer documentId={pdf.id} page={pdf.page} name="Оригинален документ" open onClose={() => setPdf(null)} />}
    </div>
  );
}

/** Accessible tabular view of the same data as the chart (mobile: stacked rows). */
function SeriesTable({ series, onEdit, onHistory, onDelete }: { series: SeriesPoint[]; onEdit: (p: SeriesPoint) => void; onHistory: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <div>
      <table className="w-full text-left text-[15px]">
        <caption className="sr-only">Всички измервания: дата, стойност, единица, референтен диапазон, статус, източник</caption>
        <thead className="hidden border-b border-border text-sm text-muted sm:table-header-group">
          <tr><th className="py-2 pr-3 font-medium">Дата</th><th className="py-2 pr-3 font-medium">Стойност</th><th className="py-2 pr-3 font-medium">Реф. диапазон</th><th className="py-2 pr-3 font-medium">Статус</th><th className="py-2 pr-3 font-medium">Източник</th><th className="py-2"><span className="sr-only">Действия</span></th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {series.map((p) => (
            <tr key={p.resultId} className="grid grid-cols-[1fr_auto] gap-x-3 py-3 sm:table-row sm:py-0">
              <td className="num text-muted sm:py-3 sm:pr-3 sm:text-ink">{formatDate(p.date)}</td>
              <td className="num row-span-2 text-right font-semibold sm:py-3 sm:pr-3 sm:text-left">{p.valueText} <span className="font-normal text-muted">{p.unit}</span>{p.edited && <span className="ml-1 text-xs font-normal text-muted">(коригиран)</span>}</td>
              <td className="num text-sm text-ink-2 sm:py-3 sm:pr-3 sm:text-[15px]">{(p.rangeLow !== null || p.rangeHigh !== null || p.rangeText) ? `${formatRange(p.rangeLow, p.rangeHigh, p.rangeText)} ${p.unit ?? ''}` : '—'}</td>
              <td className="sm:py-3 sm:pr-3"><StatusBadge status={p.status} short /></td>
              <td className="text-sm text-muted sm:py-3 sm:pr-3">{p.laboratoryName ?? (p.source === 'manual' ? 'Ръчно' : '—')}</td>
              <td className="col-span-2 flex gap-1 sm:table-cell sm:py-2 sm:text-right">
                <IconButton label="Редактирай" className="size-9" onClick={() => onEdit(p)}><Pencil className="size-4" /></IconButton>
                <IconButton label="История на промените" className="size-9" onClick={() => onHistory(p.resultId)}><History className="size-4" /></IconButton>
                <IconButton label="Изтрий" className="size-9" onClick={() => onDelete(p.resultId)}><Trash2 className="size-4" /></IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">Числата са показани с десетична запетая и с толкова знаци, колкото са в документа.</p>
    </div>
  );
}
