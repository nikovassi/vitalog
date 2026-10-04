import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, CloudUpload, FileText, Loader2, Lock, PenLine, RotateCcw, X } from 'lucide-react';
import type { JobStage, ProcessingJob } from '@vitalog/shared';
import { ApiError, get, post, upload } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { JOB_ERRORS } from '../lib/util';
import { STATIC_DEMO } from '../lib/staticDemo';
import { PageHeader } from '../components/ui/Card';
import { Button, LinkButton } from '../components/ui/Button';
import { Alert } from '../components/ui/Feedback';

const MAX_MB = 15;

interface StepDef { key: string; label: string; stages: JobStage[] }
const STEPS: StepDef[] = [
  { key: 'read', label: 'Четене на документа', stages: ['extracting_text'] },
  { key: 'ocr', label: 'Разпознаване на сканиран текст', stages: ['ocr'] },
  { key: 'extract', label: 'Извличане на показатели', stages: ['parsing', 'ai_structuring'] },
  { key: 'check', label: 'Проверка на стойностите', stages: ['normalizing', 'validating'] },
];
const ORDER: JobStage[] = ['queued', 'extracting_text', 'ocr', 'parsing', 'ai_structuring', 'normalizing', 'validating', 'review_required'];

export default function Upload() {
  useTitle('Качи изследване');
  const [params, setParams] = useSearchParams();
  const jobId = params.get('job');
  const [file, setFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<{ title: string; text: string; reportId?: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: job } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => get<ProcessingJob>(`/api/jobs/${jobId}`),
    enabled: !!jobId,
    // Poll the REAL server-side state; no simulated progress
    refetchInterval: (q) => (q.state.data && ['review_required', 'failed', 'completed'].includes(q.state.data.stage) ? false : 1200),
  });

  useEffect(() => {
    if (job?.stage === 'review_required') {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      const t = setTimeout(() => navigate(`/app/review/${job.id}`, { replace: true }), 700);
      return () => clearTimeout(t);
    }
  }, [job?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (f: File | undefined | null) => {
    setError(null);
    if (!f) return;
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return setError({ title: 'Неподдържан формат', text: 'Поддържат се само PDF файлове.' });
    if (f.size > MAX_MB * 1024 * 1024) return setError({ title: 'Файлът е твърде голям', text: `Максималният размер е ${MAX_MB} MB.` });
    if (f.size === 0) return setError({ title: 'Файлът е празен', text: 'Избери друг файл.' });
    setFile(f);
    void start(f);
  };

  const start = async (f: File) => {
    const form = new FormData();
    form.append('file', f, f.name);
    setUploadPct(0);
    try {
      const res = await upload<{ jobId: string }>('/api/uploads', form, setUploadPct);
      setUploadPct(100);
      setParams({ job: res.jobId }, { replace: true });
    } catch (e) {
      setUploadPct(null);
      const err = e as ApiError;
      setError({ title: err.code === 'duplicate' ? 'Този файл вече е качен' : 'Качването не успя', text: err.message, reportId: err.details?.reportId as string | undefined });
    }
  };

  const reset = () => { setFile(null); setUploadPct(null); setError(null); setParams({}, { replace: true }); };
  const retry = async () => { if (jobId) { await post(`/api/jobs/${jobId}/retry`); void qc.invalidateQueries({ queryKey: ['job', jobId] }); } };

  const processing = uploadPct !== null || !!jobId;
  const failed = job?.stage === 'failed';
  const jobErr = failed ? JOB_ERRORS[job.errorCode ?? 'internal'] ?? JOB_ERRORS.internal! : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Качи изследване" subtitle="PDF файл с резултати от лаборатория. Ще извлечем показателите и ще ги провериш преди записване." />

      {STATIC_DEMO && <StaticUploadNotice />}
      {!processing && !STATIC_DEMO && (
        <>
          {error && <Alert tone="error" title={error.title} className="mb-4" action={error.reportId ? <Link className="font-medium underline" to={`/app/reports/${error.reportId}`}>Отвори изследването</Link> : undefined}>{error.text}</Alert>}
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
            className={clsx('flex flex-col items-center rounded-3xl border-2 border-dashed px-6 py-12 text-center transition-colors sm:py-16', drag ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface')}
          >
            <div className="flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-ink"><CloudUpload className="size-8" aria-hidden /></div>
            <p className="mt-5 font-display text-xl font-semibold">Пусни PDF файла тук</p>
            <p className="mt-1 text-[15px] text-muted">или</p>
            <Button size="lg" className="mt-3" onClick={() => input.current?.click()} icon={<FileText className="size-5" />}>Избери файл</Button>
            <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="Избери PDF файл" onChange={(e) => pick(e.target.files?.[0])} />
            <p className="mt-4 text-sm text-muted">PDF · до {MAX_MB} MB · от Files, Downloads, Google Drive, iCloud и др.</p>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link to="/app/results/new" className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 hover:border-border-strong">
              <PenLine className="size-5 text-ink-2" aria-hidden /><span><b className="block text-[15px]">Въведи ръчно</b><span className="text-sm text-muted">Когато нямаш PDF</span></span>
            </Link>
            <Link to="/app/documents?upload=1" className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 hover:border-border-strong">
              <FileText className="size-5 text-ink-2" aria-hidden /><span><b className="block text-[15px]">Друг документ</b><span className="text-sm text-muted">Епикриза, рецепта, образна диагностика</span></span>
            </Link>
          </div>
          <p className="mt-6 flex items-start gap-2 text-sm text-muted"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden />Файлът се криптира и се съхранява частно. Достъп имаш само ти.</p>
        </>
      )}

      {processing && (
        <div className="rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-7" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2"><FileText className="size-5 text-ink-2" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{file?.name ?? 'Документ'}</p>
              <p className="text-sm text-muted">{failed ? 'Обработката спря' : job?.stage === 'review_required' ? 'Готово – отваряме прегледа…' : 'Обработваме документа…'}</p>
            </div>
          </div>

          <ol className="mt-6 space-y-4">
            <Step label="Качване" state={uploadPct === null && jobId ? 'done' : uploadPct === 100 ? 'done' : 'active'} pct={uploadPct ?? 100} />
            {STEPS.filter((s) => s.key !== 'ocr' || job?.usedOcr || job?.stage === 'ocr').map((s) => {
              const st = stepState(s, job);
              const real = job && s.stages.includes(job.stage) && job.pagesTotal ? job.stageProgress : undefined;
              const pages = job && s.stages.includes(job.stage) && job.pagesTotal ? `страница ${job.pagesDone ?? 0} от ${job.pagesTotal}` : undefined;
              return <Step key={s.key} label={s.label} state={failed && st === 'active' ? 'failed' : st} pct={real} detail={pages} />;
            })}
          </ol>

          {jobErr && (
            <Alert tone="error" title={jobErr.title} className="mt-6" action={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} onClick={retry}>Опитай отново</Button>
                <LinkButton size="sm" variant="secondary" to="/app/results/new">Въведи ръчно</LinkButton>
                <Button size="sm" variant="ghost" onClick={reset}>Качи друг файл</Button>
              </div>
            }>{jobErr.text}</Alert>
          )}
        </div>
      )}
    </div>
  );
}

/** GitHub Pages demo has no server: show the recorded review instead of uploading. */
function StaticUploadNotice() {
  const { data } = useQuery({ queryKey: ['jobs'], queryFn: () => get<ProcessingJob[]>('/api/jobs') });
  const pending = data?.find((j) => j.stage === 'review_required');
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Статична демо версия">
        Тук няма сървър, затова качването на файлове е изключено – никакви медицински данни не се изпращат никъде.
        Пълната версия извлича показателите от PDF на защитен сървър в ЕС. Можеш да разгледаш как изглежда
        прегледът на извлечените резултати с примерен синтетичен документ.
      </Alert>
      {pending && <LinkButton to={`/app/review/${pending.id}`} size="lg" icon={<FileText className="size-5" />}>Отвори примерен преглед на резултати</LinkButton>}
    </div>
  );
}

function stepState(s: StepDef, job?: ProcessingJob): 'pending' | 'active' | 'done' {
  if (!job) return 'pending';
  if (job.stage === 'review_required' || job.stage === 'completed') return 'done';
  if (job.stage === 'failed') return 'pending';
  const cur = ORDER.indexOf(job.stage);
  const first = Math.min(...s.stages.map((x) => ORDER.indexOf(x)));
  const last = Math.max(...s.stages.map((x) => ORDER.indexOf(x)));
  if (cur > last) return 'done';
  if (cur >= first) return 'active';
  return 'pending';
}

function Step({ label, state, pct, detail }: { label: string; state: 'pending' | 'active' | 'done' | 'failed'; pct?: number; detail?: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className={clsx('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', state === 'done' ? 'bg-accent text-accent-ink' : state === 'active' ? 'bg-accent-soft text-accent-soft-ink' : state === 'failed' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted')}>
        {state === 'done' ? <Check className="pop size-4" strokeWidth={3} aria-hidden /> : state === 'active' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : state === 'failed' ? <X className="size-4" aria-hidden /> : <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={clsx('text-[15px]', state === 'pending' ? 'text-muted' : 'font-medium text-ink')}>{label}</span>
          {state === 'active' && pct !== undefined && <span className="num text-sm text-ink-2">{pct}%</span>}
        </div>
        {state === 'active' && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            {pct !== undefined
              ? <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
              : <div className="indeterminate h-full w-1/3 rounded-full bg-accent/70" />}
          </div>
        )}
        {state === 'active' && detail && <p className="num mt-1 text-sm text-muted">{detail}</p>}
      </div>
    </li>
  );
}
