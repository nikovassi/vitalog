import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, Eye, FileText, Search, Trash2, Upload } from 'lucide-react';
import { formatBytes, formatDate, formatDateTime, type Document, type DocumentCategory } from '@vitalog/shared';
import { ApiError, del, get, upload } from '../lib/api';
import { useDebounced, useTitle } from '../lib/hooks';
import { PageHeader } from '../components/ui/Card';
import { Button, IconButton } from '../components/ui/Button';
import { Chip, Input, Select } from '../components/ui/Form';
import { Alert, EmptyState, ErrorState, Skeleton, useToast } from '../components/ui/Feedback';
import { ConfirmDialog, Dialog } from '../components/ui/Dialog';
import { downloadDocument, PdfViewer } from '../components/documents/PdfViewer';

export const DOC_CATEGORIES: Record<DocumentCategory, string> = {
  lab_results: 'Лабораторни резултати',
  imaging: 'Образна диагностика',
  discharge_summary: 'Епикризи',
  outpatient_sheet: 'Амбулаторни листове',
  prescription: 'Рецепти',
  other: 'Други',
};
const SOURCE: Record<string, string> = { upload: 'Качен от теб', generated: 'Генериран', demo: 'Демо (синтетичен)' };

type Resp = { items: Array<Document & { reportId: string | null }>; total: number; counts: Array<{ category: DocumentCategory; n: number }> };

export default function Documents() {
  useTitle('Моите документи');
  const [params, setParams] = useSearchParams();
  const [cat, setCat] = useState<DocumentCategory | ''>('');
  const [search, setSearch] = useState('');
  const ds = useDebounced(search);
  const [viewing, setViewing] = useState<Document | null>(null);
  const [deleting, setDeleting] = useState<Document | null>(null);
  const highlight = params.get('highlight');
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['documents', cat, ds],
    queryFn: () => get<Resp>(`/api/documents?${new URLSearchParams({ pageSize: '100', ...(cat && { category: cat }), ...(ds && { search: ds }) })}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/documents/${id}`),
    onSuccess: () => { void qc.invalidateQueries(); toast('Документът е изтрит.', 'info'); setDeleting(null); },
  });
  const hlRef = useRef<HTMLLIElement>(null);
  useEffect(() => { hlRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [data, highlight]);
  const total = data?.counts.reduce((a, c) => a + c.n, 0) ?? 0;

  return (
    <div>
      <PageHeader title="Моите документи" subtitle="Оригиналните файлове – криптирани и достъпни само за теб"
        actions={<Button icon={<Upload className="size-4" />} onClick={() => setParams({ upload: '1' })}>Качи документ</Button>} />
      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Категория">
        <Chip active={!cat} onClick={() => setCat('')}>Всички ({total})</Chip>
        {(Object.keys(DOC_CATEGORIES) as DocumentCategory[]).map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{DOC_CATEGORIES[c]} ({data?.counts.find((x) => x.category === c)?.n ?? 0})</Chip>)}
      </div>
      <label className="relative mt-3 block sm:max-w-md">
        <span className="sr-only">Търси документ</span>
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Търси по име…" className="h-11 w-full rounded-xl border border-border-strong bg-surface pr-3 pl-10 text-[16px] focus:border-accent focus:outline-none" />
      </label>

      <div className="mt-5">
        {isLoading ? <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
          : error ? <ErrorState error={error} onRetry={refetch} />
          : !data?.items.length ? <EmptyState icon={<FileText className="size-7" />} title="Няма документи" text="Качи лабораторен резултат, епикриза или друг медицински документ." action={<Button onClick={() => setParams({ upload: '1' })}>Качи документ</Button>} />
          : (
            <ul className="space-y-2">
              {data.items.map((d) => (
                <li key={d.id} ref={d.id === highlight ? hlRef : undefined} className={clsx('rounded-2xl border bg-surface p-4 transition-shadow', d.id === highlight ? 'border-accent ring-4 ring-[var(--accent-soft)]' : 'border-border')}>
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2"><FileText className="size-5" aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words">{d.name}</p>
                      <p className="text-sm text-muted">{DOC_CATEGORIES[d.category]} · <span className="num">{formatDate(d.documentDate)}</span> · {formatBytes(d.sizeBytes)}{d.pageCount ? ` · ${d.pageCount} стр.` : ''}</p>
                      <p className="text-xs text-muted">{SOURCE[d.source]} · качен на <span className="num">{formatDateTime(d.uploadedAt)}</span>{d.reportId && <> · <Link to={`/app/reports/${d.reportId}`} className="font-medium text-accent hover:underline">виж резултатите</Link></>}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <IconButton label="Преглед" onClick={() => setViewing(d)}><Eye className="size-5" /></IconButton>
                      <IconButton label="Изтегли" onClick={() => downloadDocument(d.id).catch((e: ApiError) => toast(e.message, 'error'))}><Download className="size-5" /></IconButton>
                      <IconButton label="Изтрий" onClick={() => setDeleting(d)}><Trash2 className="size-5" /></IconButton>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>

      {viewing && <PdfViewer documentId={viewing.id} name={viewing.name} open onClose={() => setViewing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)} loading={remove.isPending}
        title="Сигурен ли си?" text={<>Изтриването на този документ няма да бъде обратимо.{deleting?.reportId && ' Извлечените от него резултати ще останат в историята ти, но без връзка към оригинала.'}</>} />
      <UploadDocDialog open={params.get('upload') === '1'} onClose={() => setParams({}, { replace: true })} />
    </div>
  );
}

function UploadDocDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory>('other');
  const [date, setDate] = useState('');
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const submit = async () => {
    if (!file) return;
    setErr(null);
    const f = new FormData();
    f.append('category', category);
    if (date) f.append('documentDate', date);
    f.append('file', file, file.name);
    try {
      setPct(0);
      await upload('/api/documents', f, setPct);
      void qc.invalidateQueries({ queryKey: ['documents'] });
      toast('Документът е качен.');
      setFile(null);
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Качването не успя.');
    } finally {
      setPct(null);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Качи документ"
      footer={<><Button variant="secondary" onClick={onClose}>Отказ</Button><Button onClick={submit} disabled={!file} loading={pct !== null}>{pct !== null ? `Качване ${pct}%` : 'Качи'}</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Alert tone="info">За лабораторни резултати, които искаш да видиш като графики, използвай <Link to="/app/upload" className="font-medium underline" onClick={onClose}>„Качи изследване“</Link>.</Alert>
        <Input label="PDF файл" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="pt-2.5" />
        <Select label="Категория" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
          {(Object.keys(DOC_CATEGORIES) as DocumentCategory[]).map((c) => <option key={c} value={c}>{DOC_CATEGORIES[c]}</option>)}
        </Select>
        <Input label="Дата на документа (по избор)" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
    </Dialog>
  );
}
