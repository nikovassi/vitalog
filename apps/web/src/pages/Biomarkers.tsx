import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Activity, ClipboardCheck, PenLine, Search, Star } from 'lucide-react';
import clsx from 'clsx';
import { CATEGORY_LABELS, CATEGORY_ORDER, formatDate, plural, type BiomarkerSummary, type ProcessingJob } from '@vitalog/shared';
import { get } from '../lib/api';
import { useDebounced, useTitle } from '../lib/hooks';
import { PageHeader } from '../components/ui/Card';
import { LinkButton } from '../components/ui/Button';
import { Chip, Select } from '../components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { ChangeBadge, StatusBadge } from '../components/ui/Status';
import { Sparkline } from '../components/ui/Sparkline';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Всички' },
  { value: 'in_range', label: '✓ В диапазона' },
  { value: 'above', label: '↑ Над диапазона' },
  { value: 'below', label: '↓ Под диапазона' },
  { value: 'unconfirmed', label: 'Непотвърдени' },
] as const;

export default function Biomarkers() {
  useTitle('Показатели');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const ds = useDebounced(search);
  const status = params.get('status') ?? 'all';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'newest';
  const favorites = params.get('favorites') === '1';
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  const qs = new URLSearchParams({ sort, status: status === 'unconfirmed' ? 'all' : status, ...(ds && { search: ds }), ...(category && { category }), ...(favorites && { favorites: '1' }) });
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['biomarkers', qs.toString()], queryFn: () => get<BiomarkerSummary[]>(`/api/biomarkers?${qs}`), placeholderData: (p) => p, enabled: status !== 'unconfirmed' });
  const { data: jobs } = useQuery({ queryKey: ['jobs'], queryFn: () => get<Array<ProcessingJob & { documentName: string | null }>>('/api/jobs'), enabled: status === 'unconfirmed' });

  const listRef = useRef<HTMLUListElement>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(listRef.current?.offsetTop ?? 0); }, [data]);
  const items = data ?? [];
  const virtualizer = useWindowVirtualizer({ count: items.length, estimateSize: () => 84, overscan: 8, scrollMargin: offset });

  return (
    <div>
      <PageHeader title="Показатели" subtitle="Всички проследявани показатели и последните им стойности"
        actions={<LinkButton to="/app/results/new" variant="secondary" icon={<PenLine className="size-4" />}>Добави резултат</LinkButton>} />

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Търси показател</span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input value={search} onChange={(e) => { setSearch(e.target.value); set('search', e.target.value || null); }} placeholder="Търси: пикочна, TSH, LDL…"
              className="h-11 w-full rounded-xl border border-border-strong bg-surface pr-3 pl-10 text-[16px] focus:border-accent focus:ring-4 focus:ring-[var(--accent-soft)] focus:outline-none" />
          </label>
          <Select aria-label="Подреди" value={sort} onChange={(e) => set('sort', e.target.value)} className="sm:w-56">
            <option value="newest">Най-нови</option>
            <option value="oldest">Най-стари</option>
            <option value="name">Име (А–Я)</option>
            <option value="latest_value">Последна стойност</option>
            <option value="most_measured">Най-много измервания</option>
          </Select>
        </div>
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Статус">
          {STATUS_OPTIONS.map((o) => <Chip key={o.value} active={status === o.value} onClick={() => set('status', o.value === 'all' ? null : o.value)}>{o.label}</Chip>)}
          <Chip active={favorites} onClick={() => set('favorites', favorites ? null : '1')}><Star className="mr-1 inline size-3.5" aria-hidden />Любими</Chip>
        </div>
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Категория">
          <Chip active={!category} onClick={() => set('category', null)}>Всички категории</Chip>
          {CATEGORY_ORDER.map((c) => <Chip key={c} active={category === c} onClick={() => set('category', category === c ? null : c)}>{CATEGORY_LABELS[c]}</Chip>)}
        </div>
      </div>

      <div className="mt-5">
        {status === 'unconfirmed' ? (
          jobs?.filter((j) => j.stage === 'review_required').length ? (
            <ul className="space-y-2">
              {jobs.filter((j) => j.stage === 'review_required').map((j) => (
                <li key={j.id}><Link to={`/app/review/${j.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 hover:border-border-strong">
                  <ClipboardCheck className="size-5 text-accent" aria-hidden /><span className="flex-1"><b className="block">{j.documentName}</b><span className="text-sm text-muted">Чака проверка</span></span>
                </Link></li>
              ))}
            </ul>
          ) : <EmptyState title="Няма непотвърдени резултати" text="Всички извлечени данни са прегледани." />
        ) : isLoading ? (
          <div className="space-y-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : error ? <ErrorState error={error} onRetry={refetch} /> : !items.length ? (
          <EmptyState icon={<Activity className="size-7" />} title={ds || category || status !== 'all' || favorites ? 'Няма показатели по тези критерии' : 'Все още нямаш показатели'}
            text={ds ? `Не открихме „${ds}“.` : 'Качи изследване или добави резултат ръчно.'} action={!ds && <LinkButton to="/app/upload">Качи изследване</LinkButton>} />
        ) : (
          <>
            <p className="mb-2 text-sm text-muted" aria-live="polite">{plural(items.length, 'показател', 'показателя')}</p>
            <ul ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((v) => {
                const s = items[v.index]!;
                return (
                  <li key={s.id} data-index={v.index} ref={virtualizer.measureElement} className="absolute inset-x-0 pb-2" style={{ transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}>
                    <Row s={s} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ s }: { s: BiomarkerSummary }) {
  const l = s.latest;
  return (
    <Link to={`/app/biomarkers/${encodeURIComponent(s.id)}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong sm:gap-5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate font-medium">{s.name}{s.favorite && <Star className="size-3.5 shrink-0 fill-current text-attention" aria-label="Любим" />}</p>
        <p className="truncate text-sm text-muted">{CATEGORY_LABELS[s.category]} · {plural(s.count, 'измерване', 'измервания')}{l && <> · <span className="num">{formatDate(l.date)}</span></>}</p>
      </div>
      <Sparkline values={s.sparkline} className="hidden h-8 w-24 sm:block" />
      <div className="hidden w-36 sm:block"><ChangeBadge change={s.change} unit={s.unit} showPercent={false} /></div>
      <div className="text-right">
        <p className="num font-semibold whitespace-nowrap">{l?.valueText} <span className="text-sm font-normal text-muted">{l?.unit}</span></p>
        {l && <StatusBadge status={l.status} short className={clsx('mt-0.5')} />}
      </div>
    </Link>
  );
}
