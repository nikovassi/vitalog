import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, FileText, FlaskConical, Loader2, Search, Stethoscope, X } from 'lucide-react';
import { formatDate, type SearchResponse } from '@vitalog/shared';
import { get } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { StatusBadge } from '../ui/Status';

/** Global search: biomarkers (any alias, BG/EN), reports, documents, specialists. */
export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const navigate = useNavigate();
  const { data, isFetching } = useQuery({ queryKey: ['search', dq], queryFn: () => get<SearchResponse>(`/api/search?q=${encodeURIComponent(dq)}`), enabled: open && dq.length > 0 });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) setQ('');
  }, [open]);

  const go = (to: string) => { onClose(); navigate(to); };
  const empty = data && !data.biomarkers.length && !data.reports.length && !data.documents.length && !data.specialists.length;

  return (
    <dialog ref={ref} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-label="Търсене"
      className="mx-auto mt-[8vh] w-[calc(100%-1.5rem)] max-w-xl rounded-2xl border border-border bg-surface p-0 text-ink shadow-pop backdrop:bg-black/40">
      {open && (
        <div className="flex max-h-[75dvh] flex-col">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-5 text-muted" aria-hidden />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Напр. „пикочна“, TSH, LDL…" aria-label="Търсене"
              className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted" />
            {isFetching && <Loader2 className="size-4 animate-spin text-muted" aria-hidden />}
            <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Затвори"><X className="size-5" /></button>
          </div>
          <div className="overflow-y-auto p-2" aria-live="polite">
            {!dq && <p className="px-3 py-6 text-center text-[15px] text-muted">Търси по име на показател (на български или английски), съкращение, лаборатория или лекар.</p>}
            {empty && <p className="px-3 py-6 text-center text-[15px] text-muted">Няма резултати за „{dq}“.</p>}
            {data && data.biomarkers.length > 0 && (
              <Group title="Показатели">
                {data.biomarkers.map((b) => (
                  <Item key={b.id} icon={<Activity className="size-4" />} onClick={() => go(`/app/biomarkers/${encodeURIComponent(b.id)}`)}
                    title={b.name} meta={b.latest ? `${b.latest.valueText} ${b.latest.unit ?? ''} · ${formatDate(b.latest.date)} · ${b.count} измервания` : ''}
                    right={b.latest && <StatusBadge status={b.latest.status} short />} />
                ))}
              </Group>
            )}
            {data && data.reports.length > 0 && (
              <Group title="Изследвания">
                {data.reports.map((r) => <Item key={r.id} icon={<FlaskConical className="size-4" />} onClick={() => go(`/app/reports/${r.id}`)} title={`${r.title} · ${formatDate(r.collectedAt)}`} meta={r.laboratory?.name ?? ''} />)}
              </Group>
            )}
            {data && data.documents.length > 0 && (
              <Group title="Документи">
                {data.documents.map((d) => <Item key={d.id} icon={<FileText className="size-4" />} onClick={() => go(`/app/documents?highlight=${d.id}`)} title={d.name} meta={formatDate(d.documentDate ?? d.uploadedAt)} />)}
              </Group>
            )}
            {data && data.specialists.length > 0 && (
              <Group title="Специалисти">
                {data.specialists.map((s) => <Item key={s.id} icon={<Stethoscope className="size-4" />} onClick={() => go(`/app/specialists/${s.id}`)} title={s.name} meta={s.specialty} />)}
              </Group>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</p>
      <ul>{children}</ul>
    </div>
  );
}

function Item({ icon, title, meta, right, onClick }: { icon: React.ReactNode; title: string; meta: string; right?: React.ReactNode; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2 focus:bg-surface-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{title}</span>
          {meta && <span className="num block truncate text-sm text-muted">{meta}</span>}
        </span>
        {right}
      </button>
    </li>
  );
}
