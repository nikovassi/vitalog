import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarClock, Dumbbell, FileText, FlaskConical, Pill, Plus, Salad, Stethoscope, Syringe, Trash2, type LucideIcon } from 'lucide-react';
import { formatDate, timelineEventSchema, type TimelineEventInput } from '@vitalog/shared';
import { ApiError, del, get, post } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Checkbox, Chip, Input, Select, Textarea } from '../components/ui/Form';
import { Alert, EmptyState, ErrorState, PageSkeleton, useToast } from '../components/ui/Feedback';
import { Dialog } from '../components/ui/Dialog';

interface Item { type: 'report' | 'event' | 'document'; date: string; id: string; title: string; subtitle: string | null; meta: string | null; kind: string }
const KIND: Record<string, { label: string; icon: LucideIcon }> = {
  lab_report: { label: 'Лабораторно изследване', icon: FlaskConical },
  appointment: { label: 'Преглед', icon: Stethoscope },
  medication_start: { label: 'Начало на медикамент', icon: Pill },
  medication_stop: { label: 'Край на медикамент', icon: Pill },
  diet_change: { label: 'Промяна в храненето', icon: Salad },
  exercise: { label: 'Спортна програма', icon: Dumbbell },
  vaccination: { label: 'Ваксина', icon: Syringe },
  imaging: { label: 'Образно изследване', icon: FileText },
  note: { label: 'Бележка', icon: CalendarClock },
  other: { label: 'Събитие', icon: CalendarClock },
};

export default function Timeline() {
  useTitle('Хронология');
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'all' | 'report' | 'event' | 'document'>('all');
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['timeline'], queryFn: () => get<{ items: Item[] }>('/api/timeline?limit=200') });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/events/${id}`), onSuccess: () => { void qc.invalidateQueries(); toast('Събитието е изтрито.', 'info'); } });
  const open = params.get('new') === '1';
  const items = (data?.items ?? []).filter((i) => filter === 'all' || i.type === filter);
  const byYear = items.reduce<Record<string, Item[]>>((acc, i) => { (acc[i.date.slice(0, 4)] ??= []).push(i); return acc; }, {});

  return (
    <div>
      <PageHeader title="Хронология" subtitle="Изследвания, прегледи и събития на едно място"
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setParams({ new: '1' })}>Добави събитие</Button>} />
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Филтър">
        {([['all', 'Всички'], ['report', 'Изследвания'], ['event', 'Събития и прегледи'], ['document', 'Документи']] as const).map(([v, l]) => <Chip key={v} active={filter === v} onClick={() => setFilter(v)}>{l}</Chip>)}
      </div>
      {isLoading ? <PageSkeleton /> : error ? <ErrorState error={error} onRetry={refetch} /> : !items.length ? (
        <EmptyState icon={<CalendarClock className="size-7" />} title="Хронологията е празна" text="Качи изследване или добави събитие – например нов режим на хранене." />
      ) : Object.entries(byYear).sort(([a], [b]) => b.localeCompare(a)).map(([year, list]) => (
        <section key={year} className="mb-8" aria-labelledby={`y${year}`}>
          <h2 id={`y${year}`} className="num mb-3 font-display text-xl font-bold text-ink-2">{year}</h2>
          <ol className="relative space-y-3 border-l-2 border-border pl-6">
            {list.map((i) => {
              const k = KIND[i.kind] ?? (i.type === 'document' ? { label: 'Документ', icon: FileText } : KIND.other!);
              const to = i.type === 'report' ? `/app/reports/${i.id}` : i.type === 'document' ? `/app/documents?highlight=${i.id}` : null;
              const body = (
                <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-border-strong">
                  <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${i.type === 'report' ? 'bg-accent-soft text-accent-soft-ink' : 'bg-surface-2 text-ink-2'}`}><k.icon className="size-5" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="num text-sm text-muted">{formatDate(i.date)} · {k.label}</p>
                    <p className="font-medium">{i.title}</p>
                    {(i.subtitle || i.meta) && <p className="text-sm text-ink-2">{[i.subtitle, i.meta].filter(Boolean).join(' · ')}</p>}
                  </div>
                  {i.type === 'event' && <button onClick={(e) => { e.preventDefault(); remove.mutate(i.id); }} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Изтрий ${i.title}`}><Trash2 className="size-4" /></button>}
                </div>
              );
              return (
                <li key={`${i.type}${i.id}`} className="relative">
                  <span className="absolute top-5 -left-[31px] size-3 rounded-full border-2 border-surface bg-border-strong" aria-hidden />
                  {to ? <Link to={to}>{body}</Link> : body}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <EventDialog open={open} onClose={() => setParams({}, { replace: true })} />
    </div>
  );
}

function EventDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<TimelineEventInput>({
    resolver: zodResolver(timelineEventSchema) as never,
    defaultValues: { kind: 'diet_change', title: '', date: new Date().toISOString().slice(0, 10), description: '', showOnCharts: true },
  });
  const m = useMutation({
    mutationFn: (v: TimelineEventInput) => post('/api/events', v),
    onSuccess: () => { void qc.invalidateQueries(); toast('Събитието е добавено.'); reset(); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Грешка'),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Добави събитие или бележка"
      footer={<><Button variant="secondary" onClick={onClose}>Отказ</Button><Button loading={m.isPending} onClick={handleSubmit((v) => m.mutate(v))}>Запази</Button></>}>
      <form className="space-y-4" onSubmit={handleSubmit((v) => m.mutate(v))}>
        {err && <Alert tone="error">{err}</Alert>}
        <Select label="Вид" {...register('kind')}>
          {Object.entries(KIND).filter(([k]) => k !== 'lab_report').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Input label="Заглавие" placeholder="Напр. „Нова диета“" {...register('title')} error={errors.title?.message} />
        <Input label="Дата" type="date" {...register('date')} error={errors.date?.message} />
        <Textarea label="Описание (по избор)" {...register('description')} />
        <Checkbox label="Показвай върху графиките на показателите" {...register('showOnCharts')} />
        <p className="text-sm text-muted">Събитията са само за контекст. Vitalog не прави заключения от тях.</p>
      </form>
    </Dialog>
  );
}
