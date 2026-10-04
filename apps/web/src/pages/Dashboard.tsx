import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, CalendarPlus, ChevronRight, ClipboardCheck, FileText, FlaskConical, LineChart, NotebookPen, PenLine, Stethoscope, Upload,
} from 'lucide-react';
import {
  CATEGORY_LABELS, CATEGORY_ORDER, formatBytes, formatDate, plural, type BiomarkerDetail, type DashboardResponse,
} from '@vitalog/shared';
import { get } from '../lib/api';
import { initials } from '../lib/util';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/hooks';
import { Card, SectionHeader } from '../components/ui/Card';
import { LinkButton } from '../components/ui/Button';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/Feedback';
import { ChangeBadge } from '../components/ui/Status';
import { BiomarkerCard, BiomarkerRow } from '../components/health/BiomarkerCard';
import { Onboarding } from '../components/health/Onboarding';
import { TrendChart } from '../components/charts/TrendChart';

const QUICK = [
  { to: '/app/upload', label: 'Качи изследване', icon: Upload },
  { to: '/app/results/new', label: 'Добави резултат', icon: PenLine },
  { to: '/app/specialists?new=1', label: 'Добави специалист', icon: Stethoscope },
  { to: '/app/timeline?new=1', label: 'Добави бележка', icon: NotebookPen },
  { to: '/app/trends', label: 'Виж графики', icon: LineChart },
];

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Добро утро' : h < 18 ? 'Здравей' : 'Добър вечер';
}

export default function Dashboard() {
  useTitle('Начало');
  const { me } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => get<DashboardResponse>('/api/dashboard') });
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;

  const name = data.displayName || me?.profile.displayName || '';
  const hasData = data.stats.results > 0;

  return (
    <div className="space-y-8">
      <Onboarding />
      <header className="fade-up">
        <h1 className="font-display text-[28px] font-bold tracking-tight sm:text-3xl">{greeting()}, {name}</h1>
        <p className="mt-1 text-[15px] text-muted">
          {hasData
            ? <>Последно изследване: <span className="num font-medium text-ink-2">{formatDate(data.stats.lastReportAt)}</span> · {plural(data.stats.reports, 'изследване', 'изследвания')} · {plural(data.stats.biomarkers, 'показател', 'показателя')}</>
            : 'Тук ще виждаш как се променят лабораторните ти показатели във времето.'}
        </p>
      </header>

      {/* Quick actions */}
      <nav aria-label="Бързи действия" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {QUICK.map((q, i) => (
          <Link key={q.to} to={q.to} className={`flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-[15px] font-medium transition-colors ${i === 0 ? 'bg-accent text-accent-ink hover:bg-accent-strong' : 'border border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink'}`}>
            <q.icon className="size-4" aria-hidden />{q.label}
          </Link>
        ))}
      </nav>

      {data.pendingReviews.length > 0 && (
        <section aria-label="Чакащи прегледи" className="space-y-2">
          {data.pendingReviews.map((j) => (
            <Link key={j.id} to={j.stage === 'review_required' ? `/app/review/${j.id}` : `/app/upload?job=${j.id}`}
              className="flex items-center gap-3 rounded-2xl border border-[var(--band-edge)] bg-accent-soft px-4 py-3.5 text-accent-soft-ink transition-colors hover:brightness-[0.98]">
              <ClipboardCheck className="size-5 shrink-0" aria-hidden />
              <span className="flex-1 text-[15px]">
                <b>{j.stage === 'review_required' ? 'Имаш непроверени данни.' : j.stage === 'failed' ? 'Документ не беше обработен.' : 'Обработваме документ…'}</b>{' '}
                {j.stage === 'review_required' ? 'Провери и потвърди извлечените резултати.' : j.stage === 'failed' ? 'Виж какво се случи.' : 'Ще те уведомим, когато е готов.'}
              </span>
              <ChevronRight className="size-5 shrink-0" aria-hidden />
            </Link>
          ))}
        </section>
      )}

      {!hasData ? (
        <EmptyState icon={<FlaskConical className="size-7" />} title="Все още нямаш качени изследвания."
          text="Качи PDF с резултати от лаборатория. Ще извлечем показателите, ще ги провериш и ще започнеш да следиш промените им."
          action={<LinkButton to="/app/upload" size="lg" icon={<Upload className="size-4" />}>Качи първото си изследване</LinkButton>} />
      ) : (
        <>
          <section aria-labelledby="h-health">
            <SectionHeader id="h-health" title="Моето здраве" subtitle="Любимите и най-често проследяваните показатели" action={{ to: '/app/biomarkers', label: 'Всички' }} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.overview.map((s) => <BiomarkerCard key={s.id} s={s} />)}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="h-out">
              <SectionHeader id="h-out" title="Извън референтния диапазон" subtitle="Според последното измерване и диапазона на лабораторията" action={{ to: '/app/biomarkers?status=out_of_range', label: 'Виж' }} />
              <Card className="p-1.5">
                {data.outOfRange.length ? data.outOfRange.map((s) => <BiomarkerRow key={s.id} s={s} />) : <p className="px-3 py-6 text-center text-[15px] text-muted">✓ Всички последни стойности са в референтните диапазони на лабораториите.</p>}
              </Card>
            </section>
            <section aria-labelledby="h-chg">
              <SectionHeader id="h-chg" title="Показатели с промяна" subtitle="Спрямо предишното измерване" />
              <Card className="p-1.5">
                {data.changed.length ? data.changed.map((s) => <BiomarkerRow key={s.id} s={s} right={<ChangeBadge change={s.change} unit={s.unit} className="justify-end" />} />) : <p className="px-3 py-6 text-center text-[15px] text-muted">Няма промени над 3% спрямо предишните измервания.</p>}
              </Card>
            </section>
          </div>

          <DashboardTrends keys={(data.favorites.length ? data.favorites : data.overview).slice(0, 2).map((s) => s.id)} />

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="h-reports">
              <SectionHeader id="h-reports" title="Последни изследвания" action={{ to: '/app/reports', label: 'Всички' }} />
              <Card className="divide-y divide-border">
                {data.recentReports.map((r) => (
                  <Link key={r.id} to={`/app/reports/${r.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-ink"><FlaskConical className="size-5" aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.title}</span>
                      <span className="block truncate text-sm text-muted">{r.laboratory?.name ?? 'Без лаборатория'} · {plural(r.resultCount, 'показател', 'показателя')}</span>
                    </span>
                    <span className="num shrink-0 text-sm text-ink-2">{formatDate(r.collectedAt)}</span>
                  </Link>
                ))}
              </Card>
            </section>
            <section aria-labelledby="h-docs">
              <SectionHeader id="h-docs" title="Последни документи" action={{ to: '/app/documents', label: 'Всички' }} />
              <Card className="divide-y divide-border">
                {data.recentDocuments.map((d) => (
                  <Link key={d.id} to={`/app/documents?highlight=${d.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2"><FileText className="size-5" aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.name}</span>
                      <span className="num block text-sm text-muted">{formatDate(d.documentDate ?? d.uploadedAt)} · {formatBytes(d.sizeBytes)}</span>
                    </span>
                  </Link>
                ))}
              </Card>
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="h-spec">
              <SectionHeader id="h-spec" title="Специалисти" action={{ to: '/app/specialists', label: 'Всички' }} />
              {data.specialists.length ? (
                <Card className="divide-y divide-border">
                  {data.specialists.map((s) => (
                    <Link key={s.id} to={`/app/specialists/${s.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display font-semibold text-accent-soft-ink">{initials(s.name)}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.name}</span><span className="block truncate text-sm text-muted">{s.specialty}</span></span>
                      {s.nextVisitAt && <span className="flex shrink-0 items-center gap-1 text-sm text-ink-2"><CalendarPlus className="size-4" aria-hidden /><span className="num">{formatDate(s.nextVisitAt)}</span></span>}
                    </Link>
                  ))}
                </Card>
              ) : <EmptyState title="Добави специалист" text="Пази контактите на лекарите си и свързвай изследванията с тях." action={<LinkButton to="/app/specialists?new=1" variant="secondary">Добави специалист</LinkButton>} />}
            </section>
            <section aria-labelledby="h-sum">
              <SectionHeader id="h-sum" title="Обобщение" subtitle="Само факти от твоите данни" action={{ to: '/app/summary', label: 'PDF обобщение' }} />
              <Card className="p-5">
                <ul className="space-y-2 text-[15px] text-ink-2">
                  {data.summaryFacts.map((f) => <li key={f} className="flex gap-2"><Activity className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />{f}</li>)}
                </ul>
                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {CATEGORY_ORDER.map((c) => data.categories.find((x) => x.category === c)).filter(Boolean).map((c) => (
                    <Link key={c!.category} to={`/app/biomarkers?category=${c!.category}`} className="rounded-xl bg-surface-2 px-3 py-2.5 hover:bg-surface-3">
                      <span className="block truncate text-[13px] text-muted">{CATEGORY_LABELS[c!.category]}</span>
                      <span className="num block text-sm font-semibold">{c!.total} {c!.outOfRange > 0 && <span className="font-normal text-attention-ink">· {c!.outOfRange} извън</span>}</span>
                    </Link>
                  ))}
                </div>
              </Card>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function DashboardTrends({ keys }: { keys: string[] }) {
  return (
    <section aria-labelledby="h-trends">
      <SectionHeader id="h-trends" title="Тенденции" subtitle="Любимите ти показатели във времето" action={{ to: '/app/trends', label: 'Сравни' }} />
      <div className="grid gap-4 lg:grid-cols-2">
        {keys.map((k) => <MiniTrend key={k} id={k} />)}
      </div>
    </section>
  );
}

function MiniTrend({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ['biomarker', id, 'all'], queryFn: () => get<BiomarkerDetail>(`/api/biomarkers/${encodeURIComponent(id)}`) });
  if (!data) return <Card className="h-72 skeleton" />;
  return (
    <Card className="p-4 sm:p-5">
      <Link to={`/app/biomarkers/${encodeURIComponent(id)}`} className="flex items-baseline justify-between gap-2 hover:underline">
        <h3 className="font-semibold">{data.summary.name}</h3>
        <span className="text-sm text-muted">{data.summary.unit}</span>
      </Link>
      <TrendChart series={data.series} unit={data.summary.unit} label={data.summary.name} height={200} />
    </Card>
  );
}


