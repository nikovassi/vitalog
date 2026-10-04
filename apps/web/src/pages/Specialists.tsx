import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Mail, Phone, Plus, Stethoscope } from 'lucide-react';
import { formatDate, plural, type Specialist } from '@vitalog/shared';
import { get } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/Feedback';
import { SpecialistForm } from '../components/health/SpecialistForm';
import { Avatar } from '../components/health/Avatar';

export default function Specialists() {
  useTitle('Моите специалисти');
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['specialists'], queryFn: () => get<Array<Specialist & { reportCount: number }>>('/api/specialists') });
  return (
    <div>
      <PageHeader title="Моите специалисти" subtitle="Лекарите, които те проследяват" actions={<Button icon={<Plus className="size-4" />} onClick={() => setParams({ new: '1' })}>Добави специалист</Button>} />
      {isLoading ? <PageSkeleton /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data?.length ? (
        <EmptyState icon={<Stethoscope className="size-7" />} title="Добави специалист" text="Пази контактите на лекарите си и свързвай изследванията с тях." action={<Button onClick={() => setParams({ new: '1' })}>Добави специалист</Button>} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => (
            <li key={s.id} className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-card">
              <Link to={`/app/specialists/${s.id}`} className="flex items-center gap-3 hover:underline">
                <Avatar s={s} />
                <span className="min-w-0"><span className="block truncate font-semibold">{s.name}</span><span className="block truncate text-sm text-muted">{s.specialty}</span></span>
              </Link>
              {s.clinic && <p className="mt-3 truncate text-sm text-ink-2">{s.clinic}</p>}
              <p className="mt-1 text-sm text-muted">{plural(s.reportCount, 'свързано изследване', 'свързани изследвания')}</p>
              {s.nextVisitAt && <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2"><CalendarClock className="size-4" aria-hidden />Следващ преглед: <span className="num">{formatDate(s.nextVisitAt)}</span></p>}
              <div className="mt-4 flex gap-2 pt-1">
                {s.phone && <a href={`tel:${s.phone.replace(/\s/g, '')}`} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent-soft text-sm font-medium text-accent-soft-ink"><Phone className="size-4" />Обади се</a>}
                {s.email && <a href={`mailto:${s.email}`} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-medium"><Mail className="size-4" />Email</a>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <SpecialistForm open={params.get('new') === '1'} onClose={() => setParams({}, { replace: true })} />
    </div>
  );
}
