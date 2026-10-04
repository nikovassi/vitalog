import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, CalendarClock, ExternalLink, Globe, Mail, MapPin, Pencil, Phone, Trash2 } from 'lucide-react';
import { formatDate, plural, type LabReport, type Note, type Specialist } from '@vitalog/shared';
import { del, get } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { Card, PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ErrorState, PageSkeleton, useToast } from '../components/ui/Feedback';
import { ConfirmDialog } from '../components/ui/Dialog';
import { SpecialistForm } from '../components/health/SpecialistForm';
import { Avatar } from '../components/health/Avatar';
import { Notes } from '../components/health/Notes';

export default function SpecialistDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['specialist', id], queryFn: () => get<{ specialist: Specialist; reports: LabReport[]; notes: Note[] }>(`/api/specialists/${id}`) });
  useTitle(data?.specialist.name ?? 'Специалист');
  const remove = useMutation({ mutationFn: () => del(`/api/specialists/${id}`), onSuccess: () => { void qc.invalidateQueries(); toast('Специалистът е изтрит.', 'info'); navigate('/app/specialists', { replace: true }); } });
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error} />;
  const s = data.specialist;
  const action = 'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium';
  return (
    <div>
      <PageHeader back={<Link to="/app/specialists" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="size-4" />Специалисти</Link>}
        title={<span className="flex items-center gap-3"><Avatar s={s} size="size-14" />{s.name}</span>} subtitle={s.specialty}
        actions={<Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Редактирай</Button>} />
      <div className="flex flex-wrap gap-2">
        {s.phone && <a className={`${action} bg-accent text-accent-ink`} href={`tel:${s.phone.replace(/\s/g, '')}`}><Phone className="size-4" />Обади се</a>}
        {s.email && <a className={`${action} border border-border bg-surface`} href={`mailto:${s.email}`}><Mail className="size-4" />Email</a>}
        {s.address && <a className={`${action} border border-border bg-surface`} href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(s.address)}`} target="_blank" rel="noopener noreferrer"><MapPin className="size-4" />Отвори карта</a>}
        {s.website && <a className={`${action} border border-border bg-surface`} href={s.website} target="_blank" rel="noopener noreferrer nofollow"><Globe className="size-4" />Уебсайт<ExternalLink className="size-3.5" /></a>}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold">Информация</h2>
          <dl className="mt-3 space-y-2 text-[15px]">
            {s.clinic && <div className="flex gap-2"><Building2 className="mt-0.5 size-4 text-muted" aria-hidden /><dt className="sr-only">Клиника</dt><dd>{s.clinic}</dd></div>}
            {s.address && <div className="flex gap-2"><MapPin className="mt-0.5 size-4 text-muted" aria-hidden /><dt className="sr-only">Адрес</dt><dd>{s.address}</dd></div>}
            {s.phone && <div className="flex gap-2"><Phone className="mt-0.5 size-4 text-muted" aria-hidden /><dt className="sr-only">Телефон</dt><dd className="num">{s.phone}</dd></div>}
            {s.email && <div className="flex gap-2"><Mail className="mt-0.5 size-4 text-muted" aria-hidden /><dt className="sr-only">Email</dt><dd className="break-all">{s.email}</dd></div>}
            <div className="flex gap-2"><CalendarClock className="mt-0.5 size-4 text-muted" aria-hidden /><dt>Последен преглед:</dt><dd className="num">{formatDate(s.lastVisitAt)}</dd></div>
            <div className="flex gap-2"><CalendarClock className="mt-0.5 size-4 text-muted" aria-hidden /><dt>Следващ преглед:</dt><dd className="num">{formatDate(s.nextVisitAt)}</dd></div>
          </dl>
          {s.note && <p className="mt-4 rounded-xl bg-surface-2 p-3 text-[15px] whitespace-pre-wrap">{s.note}</p>}
        </Card>
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold">Свързани изследвания</h2>
          <p className="text-sm text-muted">{plural(data.reports.length, 'изследване', 'изследвания')}, проследявани от {s.name}</p>
          <ul className="mt-3 divide-y divide-border">
            {data.reports.map((r) => (
              <li key={r.id}><Link to={`/app/reports/${r.id}`} className="flex justify-between gap-3 py-2.5 hover:text-accent"><span>{r.title}</span><span className="num text-ink-2">{formatDate(r.collectedAt)}</span></Link></li>
            ))}
            {!data.reports.length && <li className="py-3 text-[15px] text-muted">Свържи изследване от страницата му („Свързан специалист“).</li>}
          </ul>
        </Card>
      </div>
      <Card className="mt-5 p-5">
        <h2 className="mb-3 font-display text-lg font-semibold">Бележки</h2>
        <Notes notes={data.notes} targetType="specialist" targetId={id} invalidate={['specialist', id]} />
      </Card>
      <div className="mt-8 flex justify-end"><Button variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>Изтрий специалиста</Button></div>
      <SpecialistForm open={editing} onClose={() => setEditing(false)} specialist={s} />
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => remove.mutate()} loading={remove.isPending} title="Сигурен ли си?" text="Специалистът ще бъде изтрит. Изследванията остават, но без връзка към него." />
    </div>
  );
}
