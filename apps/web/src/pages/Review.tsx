import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, CheckCheck, CircleHelp, Eye, Trash2, TriangleAlert, X } from 'lucide-react';
import {
  parseLabNumber, plural, type CandidateIssue, type ExtractionCandidate, type ReviewResponse, type Specialist,
} from '@vitalog/shared';
import { ApiError, get, post } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { PageHeader, Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Form';
import { Alert, ErrorState, PageSkeleton, useToast } from '../components/ui/Feedback';
import { ConfirmDialog } from '../components/ui/Dialog';
import { PdfViewer } from '../components/documents/PdfViewer';

export const REVIEW_THRESHOLD = 0.85;

const ISSUE_TEXT: Record<CandidateIssue, string> = {
  unreadable_value: 'Не успяхме да разчетем стойността.',
  unknown_biomarker: 'Не разпознахме показателя. Избери го от списъка или го запази с името от документа.',
  missing_unit: 'Липсва мерна единица.',
  unknown_unit: 'Непозната мерна единица – провери я.',
  missing_range: 'Няма референтен диапазон в документа.',
  duplicate: 'Показателят се среща повече от веднъж в документа.',
  value_range_mismatch: 'Стойността е далеч от диапазона – провери дали не липсва десетична запетая.',
  ocr_low_confidence: 'Текстът е разчетен от сканирано изображение – сравни с оригинала.',
  not_found_in_source: 'Тази стойност не беше открита в текста на документа.',
};

interface Row {
  id: string;
  decision: 'accepted' | 'rejected' | 'pending';
  biomarkerId: string | null;
  originalName: string;
  valueText: string;
  unit: string;
  low: string;
  high: string;
  c: ExtractionCandidate;
}

const numOrNull = (s: string) => {
  const p = parseLabNumber(s);
  return s.trim() === '' || !p ? null : p.value;
};

export default function Review() {
  useTitle('Провери резултатите');
  const { jobId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['review', jobId], queryFn: () => get<ReviewResponse & { patientNameMismatch: boolean }>(`/api/jobs/${jobId}/review`) });
  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: () => get<Array<{ id: string; name: string; unit: string; categoryLabel: string }>>('/api/catalog'), staleTime: Infinity });
  const { data: specialists } = useQuery({ queryKey: ['specialists'], queryFn: () => get<Specialist[]>('/api/specialists') });
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState({ collectedAt: '', title: '', reportType: 'blood', laboratoryName: '', specialistId: '' });
  const [pdfOpen, setPdfOpen] = useState<number | null | false>(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setMeta({ collectedAt: data.meta.collectedAt ?? '', title: data.meta.title ?? 'Лабораторни изследвания', reportType: data.meta.reportType ?? 'blood', laboratoryName: data.meta.laboratoryName ?? '', specialistId: '' });
    setRows(data.candidates.map((c) => ({
      id: c.id,
      decision: c.confidence >= REVIEW_THRESHOLD ? 'accepted' : 'pending',
      biomarkerId: c.biomarkerId,
      originalName: c.originalName,
      valueText: c.valueText,
      unit: c.unit ?? '',
      low: c.referenceRange?.low != null ? String(c.referenceRange.low).replace('.', ',') : '',
      high: c.referenceRange?.high != null ? String(c.referenceRange.high).replace('.', ',') : '',
      c,
    })));
  }, [data]);

  const uncertain = rows.filter((r) => r.c.confidence < REVIEW_THRESHOLD);
  const certain = rows.filter((r) => r.c.confidence >= REVIEW_THRESHOLD);
  const pending = rows.filter((r) => r.decision === 'pending').length;
  const accepted = rows.filter((r) => r.decision === 'accepted').length;
  const invalid = rows.filter((r) => r.decision === 'accepted' && (/\?/.test(r.valueText) || !r.valueText.trim()));
  const update = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const confirm = useMutation({
    mutationFn: () => post<{ reportId: string; saved: number }>(`/api/jobs/${jobId}/confirm`, {
      meta: { collectedAt: meta.collectedAt, title: meta.title.trim() || 'Лабораторни изследвания', reportType: meta.reportType, laboratoryName: meta.laboratoryName.trim() || null, specialistId: meta.specialistId || null },
      candidates: rows.filter((r) => r.decision !== 'pending').map((r) => ({
        id: r.id, decision: r.decision, biomarkerId: r.biomarkerId, originalName: r.originalName.trim(), valueText: r.valueText.trim(),
        unit: r.unit.trim() || null,
        referenceRange: numOrNull(r.low) === null && numOrNull(r.high) === null ? null : { low: numOrNull(r.low), high: numOrNull(r.high) },
      })),
    }),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      toast(`Изследването е добавено към твоята здравна история. Записани: ${plural(r.saved, 'показател', 'показателя')}.`);
      navigate(`/app/reports/${r.reportId}?added=1`, { replace: true });
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : 'Записването не успя.'),
  });

  const discard = useMutation({
    mutationFn: () => post(`/api/jobs/${jobId}/discard`),
    onSuccess: () => { void qc.invalidateQueries(); toast('Документът беше отказан и изтрит.', 'info'); navigate('/app', { replace: true }); },
  });

  const canSave = !!meta.collectedAt && pending === 0 && accepted > 0 && invalid.length === 0;
  const blocker = !meta.collectedAt ? 'Въведи дата на изследването.' : pending > 0 ? `Остават ${plural(pending, 'резултат', 'резултата')} за проверка.` : invalid.length ? 'Поправи нечетливите стойности или ги изключи.' : accepted === 0 ? 'Потвърди поне един резултат.' : null;

  const groupedCatalog = useMemo(() => {
    const m = new Map<string, Array<{ id: string; name: string; unit: string }>>();
    for (const b of catalog ?? []) m.set(b.categoryLabel, [...(m.get(b.categoryLabel) ?? []), b]);
    return [...m.entries()];
  }, [catalog]);

  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error} />;

  return (
    <div className="mx-auto max-w-4xl pb-24">
      <PageHeader
        title="Провери резултатите"
        subtitle={<>Открихме <b className="text-ink">{plural(rows.length, 'показател', 'показателя')}</b> в „{data.document.name}“. Нищо не е записано, докато не потвърдиш.</>}
        actions={<Button variant="secondary" icon={<Eye className="size-4" />} onClick={() => setPdfOpen(null)}>Виж оригиналния PDF</Button>}
      />

      <div className="space-y-3">
        {data.patientNameMismatch && <Alert tone="warning" title="Името в документа е различно от името в профила ти">В документа пише „{data.meta.patientName}“. Увери се, че това е твое изследване.</Alert>}
        {data.suspectedDuplicateReportId && <Alert tone="info" title="Вече имаш изследване от тази дата">Провери дали не качваш същите резултати повторно.</Alert>}
        {data.job.usedOcr && <Alert tone="info">Документът е сканиран и текстът е разпознат автоматично. Сравни стойностите с оригинала.</Alert>}
      </div>

      <Card className="mt-5 p-5">
        <h2 className="font-display text-lg font-semibold">За изследването</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Input label="Дата на вземане *" type="date" required value={meta.collectedAt} max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setMeta({ ...meta, collectedAt: e.target.value })}
            error={!meta.collectedAt ? 'Не открихме дата в документа. Въведи я от оригинала.' : undefined} />
          <Input label="Лаборатория" value={meta.laboratoryName} onChange={(e) => setMeta({ ...meta, laboratoryName: e.target.value })} placeholder="Както е в документа" />
          <Input label="Заглавие" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          <Select label="Тип" value={meta.reportType} onChange={(e) => setMeta({ ...meta, reportType: e.target.value })}>
            <option value="blood">Кръвни изследвания</option>
            <option value="biochemistry">Биохимични изследвания</option>
            <option value="hormones">Хормонални изследвания</option>
            <option value="urine">Изследване на урина</option>
            <option value="mixed">Смесени</option>
            <option value="other">Друго</option>
          </Select>
          <Select label="Свържи със специалист (по избор)" value={meta.specialistId} onChange={(e) => setMeta({ ...meta, specialistId: e.target.value })} wrapperClassName="sm:col-span-2">
            <option value="">— Без специалист —</option>
            {specialists?.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.specialty}</option>)}
          </Select>
        </div>
      </Card>

      {uncertain.length > 0 && (
        <section className="mt-8" aria-labelledby="h-unc">
          <h2 id="h-unc" className="flex items-center gap-2 font-display text-lg font-semibold"><TriangleAlert className="size-5 text-attention" aria-hidden />Нужна е твоята проверка ({uncertain.length})</h2>
          <p className="mt-1 text-[15px] text-muted">Не сме сигурни в тези резултати. Сравни ги с оригиналния документ, поправи ако е нужно и потвърди или изключи всеки.</p>
          <div className="mt-4 space-y-3">
            {uncertain.map((r) => <CandidateCard key={r.id} r={r} update={update} groupedCatalog={groupedCatalog} onShowPdf={() => setPdfOpen(r.c.page)} />)}
          </div>
        </section>
      )}

      <section className="mt-8" aria-labelledby="h-cert">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="h-cert" className="flex items-center gap-2 font-display text-lg font-semibold"><Check className="size-5 text-accent" aria-hidden />Разпознати ({certain.length})</h2>
            <p className="mt-1 text-[15px] text-muted">Прегледай ги набързо. Можеш да редактираш или изключиш всеки ред.</p>
          </div>
          {certain.some((r) => r.decision !== 'accepted') && <Button size="sm" variant="soft" icon={<CheckCheck className="size-4" />} onClick={() => setRows((rs) => rs.map((r) => (r.c.confidence >= REVIEW_THRESHOLD ? { ...r, decision: 'accepted' } : r)))}>Потвърди всички</Button>}
        </div>
        <div className="mt-4 space-y-2">
          {certain.map((r) => <CandidateCard key={r.id} r={r} update={update} groupedCatalog={groupedCatalog} compact onShowPdf={() => setPdfOpen(r.c.page)} />)}
        </div>
      </section>

      {formError && <Alert tone="error" className="mt-6">{formError}</Alert>}

      {/* sticky action bar */}
      <div className="pb-safe fixed inset-x-0 bottom-[68px] z-20 border-t border-border bg-surface/95 backdrop-blur lg:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-6">
          <p className="flex-1 text-sm text-ink-2" aria-live="polite">{blocker ?? `Ще бъдат записани ${plural(accepted, 'показател', 'показателя')}.`}</p>
          <div className="flex gap-2">
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDiscardOpen(true)}>Откажи</Button>
            <Button className="flex-1 sm:flex-none" disabled={!canSave} loading={confirm.isPending} onClick={() => confirm.mutate()} icon={<Check className="size-4" />}>Потвърди и запази</Button>
          </div>
        </div>
      </div>

      <PdfViewer documentId={data.document.id} name={data.document.name} open={pdfOpen !== false} page={pdfOpen || null} onClose={() => setPdfOpen(false)} />
      <ConfirmDialog open={discardOpen} onClose={() => setDiscardOpen(false)} onConfirm={() => discard.mutate()} loading={discard.isPending}
        title="Да откажем ли документа?" text="Документът и извлечените данни ще бъдат изтрити. Това действие не може да бъде отменено." confirmLabel="Откажи и изтрий" />
    </div>
  );
}

function CandidateCard({ r, update, groupedCatalog, compact, onShowPdf }: {
  r: Row; update: (id: string, p: Partial<Row>) => void; groupedCatalog: Array<[string, Array<{ id: string; name: string; unit: string }>]>; compact?: boolean; onShowPdf: () => void;
}) {
  const [editing, setEditing] = useState(!compact);
  const unreadable = r.c.issues.includes('unreadable_value') || r.c.valueNumeric === null;
  const issues = r.c.issues.filter((i) => !(compact && i === 'missing_range'));
  const rejected = r.decision === 'rejected';
  return (
    <article className={clsx('rounded-2xl border bg-surface p-4 transition-opacity', rejected ? 'border-border opacity-60' : r.decision === 'pending' ? 'border-[var(--attention)]/50' : 'border-border')} aria-label={r.originalName}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{r.originalName}</p>
          {!editing && <p className="num text-[15px] text-ink-2">{r.valueText} {r.unit} {(r.low || r.high) && <span className="text-muted">· диапазон {r.low && r.high ? `${r.low} – ${r.high}` : r.high ? `< ${r.high}` : `> ${r.low}`}</span>}</p>}
          {r.c.page && <button className="text-xs text-muted underline-offset-2 hover:underline" onClick={onShowPdf}>страница {r.c.page}</button>}
        </div>
        <div className="flex gap-1.5">
          {compact && !editing && !rejected && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Редактирай</Button>}
          <Button size="sm" variant={r.decision === 'accepted' ? 'soft' : 'secondary'} aria-pressed={r.decision === 'accepted'} icon={<Check className="size-4" />} onClick={() => update(r.id, { decision: 'accepted' })}>
            {r.decision === 'accepted' ? 'Потвърден' : 'Потвърди'}
          </Button>
          <Button size="sm" variant="ghost" aria-pressed={rejected} icon={<X className="size-4" />} onClick={() => update(r.id, { decision: rejected ? 'pending' : 'rejected' })}>
            {rejected ? 'Изключен' : 'Изключи'}
          </Button>
        </div>
      </div>

      {issues.length > 0 && !rejected && (
        <ul className="mt-3 space-y-1">
          {unreadable && <li className="text-[15px] font-medium text-attention-ink">Не успяхме да разчетем този резултат.</li>}
          {issues.filter((i) => i !== 'unreadable_value').map((i) => <li key={i} className="flex gap-1.5 text-sm text-ink-2"><CircleHelp className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />{ISSUE_TEXT[i]}</li>)}
        </ul>
      )}
      {!compact && !rejected && (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm"><span className="text-muted">Извлечен текст: </span><code className="break-words">{r.c.rawLine}</code></p>
      )}

      {editing && !rejected && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Select label="Показател" wrapperClassName="col-span-2 sm:col-span-6" value={r.biomarkerId ?? ''} onChange={(e) => update(r.id, { biomarkerId: e.target.value || null })}>
            <option value="">„{r.originalName}“ (както е в документа)</option>
            {groupedCatalog.map(([cat, list]) => <optgroup key={cat} label={cat}>{list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>)}
          </Select>
          <Input label="Стойност" wrapperClassName="col-span-1 sm:col-span-2" inputMode="decimal" value={r.valueText} onChange={(e) => update(r.id, { valueText: e.target.value })}
            error={/\?/.test(r.valueText) ? 'Нечетлив символ' : undefined} />
          <Input label="Единица" wrapperClassName="col-span-1 sm:col-span-2" value={r.unit} onChange={(e) => update(r.id, { unit: e.target.value })} />
          <Input label="Реф. мин." wrapperClassName="col-span-1" inputMode="decimal" value={r.low} onChange={(e) => update(r.id, { low: e.target.value })} />
          <Input label="Реф. макс." wrapperClassName="col-span-1" inputMode="decimal" value={r.high} onChange={(e) => update(r.id, { high: e.target.value })} />
        </div>
      )}
    </article>
  );
}
