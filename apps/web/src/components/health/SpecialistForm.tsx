import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { specialistSchema, type Specialist, type SpecialistInput } from '@vitalog/shared';
import { ApiError, patch, post, upload } from '../../lib/api';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Form';
import { Alert, useToast } from '../ui/Feedback';

const SPECIALTIES = ['Общопрактикуващ лекар', 'Ендокринолог', 'Кардиолог', 'Гастроентеролог', 'Нефролог', 'Уролог', 'Диетолог', 'Гинеколог', 'Невролог', 'Дерматолог', 'Хематолог', 'Ревматолог'];

export function SpecialistForm({ open, onClose, specialist }: { open: boolean; onClose: () => void; specialist?: Specialist | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const empty = { name: '', specialty: '', phone: '', email: '', address: '', clinic: '', website: '', note: '', lastVisitAt: '', nextVisitAt: '' };
  const { register, handleSubmit, reset, formState: { errors } } = useForm<SpecialistInput>({ resolver: zodResolver(specialistSchema) as never, defaultValues: empty as never });
  useEffect(() => {
    if (open) reset(specialist ? Object.fromEntries(Object.entries({ ...empty, ...specialist }).map(([k, v]) => [k, v ?? ''])) as never : (empty as never));
    setErr(null);
    setPhoto(null);
  }, [open, specialist]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async (v: SpecialistInput) => {
      const s = specialist ? await patch<Specialist>(`/api/specialists/${specialist.id}`, v) : await post<Specialist>('/api/specialists', v);
      if (photo) {
        const f = new FormData();
        f.append('file', photo, photo.name);
        await upload(`/api/specialists/${s.id}/photo`, f, () => {}, 'PUT');
      }
      return s;
    },
    onSuccess: () => { void qc.invalidateQueries(); toast(specialist ? 'Промените са запазени.' : 'Специалистът е добавен.'); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Грешка при записване.'),
  });
  return (
    <Dialog open={open} onClose={onClose} title={specialist ? 'Редактирай специалист' : 'Добави специалист'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Отказ</Button><Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>Запази</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        {err && <Alert tone="error" className="sm:col-span-2">{err}</Alert>}
        <Input label="Име *" {...register('name')} error={errors.name?.message} placeholder="Д-р …" />
        <Input label="Специалност *" list="specialties" {...register('specialty')} error={errors.specialty?.message} />
        <datalist id="specialties">{SPECIALTIES.map((s) => <option key={s} value={s} />)}</datalist>
        <Input label="Телефон" type="tel" autoComplete="off" {...register('phone')} error={errors.phone?.message} />
        <Input label="Email" type="email" autoComplete="off" {...register('email')} error={errors.email?.message} />
        <Input label="Болница / клиника" {...register('clinic')} />
        <Input label="Уебсайт" type="url" placeholder="https://" {...register('website')} error={errors.website?.message} />
        <Input label="Адрес" wrapperClassName="sm:col-span-2" {...register('address')} />
        <Input label="Последен преглед" type="date" {...register('lastVisitAt')} />
        <Input label="Следващ преглед" type="date" {...register('nextVisitAt')} />
        <Input label="Снимка (по избор)" type="file" accept="image/jpeg,image/png,image/webp" className="pt-2.5" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} wrapperClassName="sm:col-span-2" hint="JPEG, PNG или WebP, до 2 MB. Съхранява се криптирана." />
        <div className="sm:col-span-2"><Textarea label="Бележка" {...register('note')} /></div>
      </form>
    </Dialog>
  );
}
