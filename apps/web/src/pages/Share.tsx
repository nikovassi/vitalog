import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, ShieldCheck } from 'lucide-react';
import { formatDateTime, type BiomarkerSummary, type ShareLink } from '@vitalog/shared';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/hooks';
import { Card, PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Checkbox, Input, Select } from '../components/ui/Form';
import { Alert, useToast } from '../components/ui/Feedback';

/** "Сподели с лекар": scoped, read-only, expiring, revocable link. No PDFs are shared. */
export default function Share() {
  useTitle('Сподели с лекар');
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: links } = useQuery({ queryKey: ['shares'], queryFn: () => get<Array<ShareLink & { active: boolean }>>('/api/shares') });
  const { data: all } = useQuery({ queryKey: ['biomarkers', 'sort=name'], queryFn: () => get<BiomarkerSummary[]>('/api/biomarkers?sort=name') });
  const [label, setLabel] = useState('За д-р …');
  const [scope, setScope] = useState<'all' | 'selected'>('selected');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState('');
  const [hours, setHours] = useState(72);
  const [specs, setSpecs] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => post<{ path: string }>('/api/shares', { label, biomarkerIds: scope === 'all' ? 'all' : [...picked], from: from || null, to: null, includeSpecialists: specs, expiresInHours: hours }),
    onSuccess: (r) => { setCreated(`${location.origin}${r.path}`); void qc.invalidateQueries({ queryKey: ['shares'] }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Грешка'),
  });
  const revoke = useMutation({ mutationFn: (id: string) => post(`/api/shares/${id}/revoke`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['shares'] }); toast('Достъпът е отнет.'); } });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Сподели с лекар" subtitle="Създай временен линк само за четене. Ти избираш какво и до кога." />
      {me?.profile.isDemo && <Alert tone="info" className="mb-4">Споделянето е изключено в демо режим.</Alert>}
      <Card className="space-y-4 p-5 sm:p-6">
        {err && <Alert tone="error">{err}</Alert>}
        <Input label="Име на линка (само за теб)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Select label="Кои данни" value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'selected')}>
          <option value="selected">Избрани показатели</option>
          <option value="all">Всички показатели</option>
        </Select>
        {scope === 'selected' && (
          <div className="grid max-h-60 gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
            {all?.map((s) => <Checkbox key={s.id} label={s.name} checked={picked.has(s.id)} onChange={() => { const n = new Set(picked); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); setPicked(n); }} />)}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Данни от дата (по избор)" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Select label="Линкът е активен" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            <option value={24}>24 часа</option><option value={72}>3 дни</option><option value={168}>7 дни</option><option value={720}>30 дни</option>
          </Select>
        </div>
        <Checkbox label="Включи списъка със специалисти" checked={specs} onChange={(e) => setSpecs(e.target.checked)} />
        <p className="flex gap-2 text-sm text-muted"><ShieldCheck className="size-4 shrink-0" aria-hidden />Линкът не дава достъп до PDF файловете, бележките или профила ти. Можеш да го отнемеш по всяко време. Всяко отваряне се записва.</p>
        <Button icon={<Link2 className="size-4" />} loading={create.isPending} disabled={me?.profile.isDemo || (scope === 'selected' && !picked.size)} onClick={() => create.mutate()}>Създай защитен линк</Button>
        {created && (
          <Alert tone="success" title="Линкът е създаден. Копирай го сега – няма да бъде показан отново.">
            <div className="mt-2 flex gap-2">
              <input readOnly value={created} className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-ink" onFocus={(e) => e.target.select()} aria-label="Линк" />
              <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={() => { void navigator.clipboard.writeText(created); toast('Копирано.'); }}>Копирай</Button>
            </div>
          </Alert>
        )}
      </Card>

      <h2 className="mt-8 mb-3 font-display text-lg font-semibold">Споделени линкове</h2>
      <Card className="divide-y divide-border">
        {!links?.length && <p className="p-5 text-[15px] text-muted">Нямаш споделени линкове.</p>}
        {links?.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{l.label}</p>
              <p className="text-sm text-muted">
                {l.active ? <>Активен до <span className="num">{formatDateTime(l.expiresAt)}</span></> : l.revokedAt ? 'Отнет' : 'Изтекъл'} · отворен {l.accessCount} пъти
                {l.lastAccessedAt && <> · последно <span className="num">{formatDateTime(l.lastAccessedAt)}</span></>}
              </p>
            </div>
            {l.active && <Button size="sm" variant="secondary" onClick={() => revoke.mutate(l.id)}>Отнеми достъпа</Button>}
          </div>
        ))}
      </Card>
    </div>
  );
}
