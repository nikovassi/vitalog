import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ChevronRight, FlaskConical, Search, Upload } from 'lucide-react';
import { formatDate, plural, type LabReport, type Paginated } from '@vitalog/shared';
import { get } from '../lib/api';
import { useDebounced, useTitle } from '../lib/hooks';
import { PageHeader } from '../components/ui/Card';
import { Button, LinkButton } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';

type Page = Paginated<LabReport> & { laboratories: Array<{ id: string; name: string }> };

export default function Reports() {
  useTitle('Моите изследвания');
  const [search, setSearch] = useState('');
  const [lab, setLab] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const ds = useDebounced(search);
  const q = useInfiniteQuery({
    queryKey: ['reports', ds, lab, from, to, sort],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => get<Page>(`/api/reports?${new URLSearchParams({ page: String(pageParam), pageSize: '20', sort, ...(ds && { search: ds }), ...(lab && { laboratoryId: lab }), ...(from && { from }), ...(to && { to }) })}`),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const labs = q.data?.pages[0]?.laboratories ?? [];
  const total = q.data?.pages[0]?.total ?? 0;
  const filtered = !!(ds || lab || from || to);

  return (
    <div>
      <PageHeader title="Моите изследвания" subtitle={total ? plural(total, 'изследване', 'изследвания') : undefined}
        actions={<>
          {total > 1 && <LinkButton to="/app/compare" variant="secondary" icon={<ArrowLeftRight className="size-4" />}>Сравни резултати</LinkButton>}
          <LinkButton to="/app/upload" icon={<Upload className="size-4" />}>Качи изследване</LinkButton>
        </>} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="relative sm:col-span-2">
          <span className="sr-only">Търси</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Търси по показател, лаборатория…" className="h-11 w-full rounded-xl border border-border-strong bg-surface pr-3 pl-10 text-[16px] focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--accent-soft)]" />
        </label>
        <Select aria-label="Лаборатория" value={lab} onChange={(e) => setLab(e.target.value)}>
          <option value="">Всички лаборатории</option>
          {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Input type="date" aria-label="От дата" value={from} onChange={(e) => setFrom(e.target.value)} />
        <div className="flex gap-2">
          <Input type="date" aria-label="До дата" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select aria-label="Подреди" value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'oldest')} className="w-auto">
            <option value="newest">Най-нови</option>
            <option value="oldest">Най-стари</option>
          </Select>
        </div>
      </div>

      <div className="mt-6">
        {q.isLoading ? <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
          : q.error ? <ErrorState error={q.error} onRetry={q.refetch} />
          : !items.length ? (
            <EmptyState icon={<FlaskConical className="size-7" />} title={filtered ? 'Няма изследвания по тези критерии' : 'Все още нямаш качени изследвания.'}
              action={!filtered && <LinkButton to="/app/upload">Качи първото си изследване</LinkButton>} />
          ) : (
            <ol className="relative space-y-3 border-l-2 border-border pl-5 sm:ml-24 sm:pl-6">
              {items.map((r) => (
                <li key={r.id} className="relative">
                  <span className="absolute top-6 -left-[27px] size-3 rounded-full border-2 border-surface bg-accent sm:-left-[31px]" aria-hidden />
                  <time className="num mb-1 block text-sm font-semibold text-ink-2 sm:absolute sm:top-5 sm:-left-32 sm:w-24 sm:text-right" dateTime={r.collectedAt}>{formatDate(r.collectedAt)}</time>
                  <Link to={`/app/reports/${r.id}`} className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong">
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-[17px] font-semibold">{r.title}</p>
                      <p className="truncate text-[15px] text-muted">{r.laboratory?.name ?? 'Без лаборатория'}</p>
                      <p className="mt-1.5 flex flex-wrap gap-x-3 text-sm">
                        <span className="text-ink-2">{plural(r.resultCount, 'показател', 'показателя')}</span>
                        {r.outOfRangeCount > 0 && <span className="text-attention-ink">{r.outOfRangeCount} извън диапазона</span>}
                      </p>
                    </div>
                    <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        {q.hasNextPage && <div className="mt-6 text-center"><Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Зареди още</Button></div>}
      </div>
    </div>
  );
}
