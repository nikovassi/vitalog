import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeAliasKey, parseLabNumber, type LabResult } from '@vitalog/shared';
import { ApiError, get, post } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { Card, PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Select, Textarea } from '../components/ui/Form';
import { Alert, useToast } from '../components/ui/Feedback';

interface CatalogItem { id: string; name: string; unit: string; supportedUnits: string[]; categoryLabel: string }

/** Manual entry for results that can't be extracted from a PDF. Marked as source "manual". */
export default function ManualEntry() {
  useTitle('Добави резултат');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: () => get<CatalogItem[]>('/api/catalog'), staleTime: Infinity });
  const [v, setV] = useState({ biomarkerId: '', customName: '', collectedAt: new Date().toISOString().slice(0, 10), valueText: '', unit: '', low: '', high: '', sourceLabel: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiErr, setApiErr] = useState<string | null>(null);
  const bm = catalog?.find((b) => b.id === v.biomarkerId);
  const grouped = useMemo(() => {
    const m = new Map<string, CatalogItem[]>();
    for (const b of catalog ?? []) m.set(b.categoryLabel, [...(m.get(b.categoryLabel) ?? []), b]);
    return [...m.entries()];
  }, [catalog]);
  const num = (s: string) => (s.trim() ? parseLabNumber(s)?.value ?? NaN : null);

  const save = useMutation({
    mutationFn: () => post<LabResult>('/api/results', {
      biomarkerId: v.biomarkerId && v.biomarkerId !== '__custom' ? v.biomarkerId : null,
      originalName: bm ? bm.name : v.customName.trim(),
      collectedAt: v.collectedAt,
      valueText: v.valueText.trim(),
      unit: v.unit.trim() || null,
      referenceRange: num(v.low) === null && num(v.high) === null ? null : { low: num(v.low), high: num(v.high) },
      sourceLabel: v.sourceLabel || null,
      note: v.note || null,
    }),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      toast('Резултатът е добавен.');
      navigate(`/app/biomarkers/${encodeURIComponent(r.biomarkerId ?? `custom:${normalizeAliasKey(r.originalName).slice(0, 80)}`)}`);
    },
    onError: (e) => setApiErr(e instanceof ApiError ? e.message : 'Грешка при записване.'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!v.biomarkerId) er.biomarkerId = 'Избери показател';
    if (v.biomarkerId === '__custom' && !v.customName.trim()) er.customName = 'Въведи име на показателя';
    if (!v.valueText.trim()) er.valueText = 'Въведи стойност';
    else if (!parseLabNumber(v.valueText) && !/^[\p{L}\s-]+$/u.test(v.valueText)) er.valueText = 'Въведи число (напр. 5,4) или текстов резултат';
    if (Number.isNaN(num(v.low))) er.low = 'Невалидно число';
    if (Number.isNaN(num(v.high))) er.high = 'Невалидно число';
    if (num(v.low) !== null && num(v.high) !== null && num(v.low)! > num(v.high)!) er.high = 'Максимумът е по-малък от минимума';
    if (!v.collectedAt) er.collectedAt = 'Въведи дата';
    setErrors(er);
    if (!Object.keys(er).length) save.mutate();
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Добави резултат" subtitle="За резултати, които не могат да бъдат извлечени от PDF. Ще бъдат отбелязани като „ръчно въведени“." />
      <Card className="p-5 sm:p-6">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          {apiErr && <Alert tone="error" className="sm:col-span-2">{apiErr}</Alert>}
          <Select label="Показател *" wrapperClassName="sm:col-span-2" value={v.biomarkerId} error={errors.biomarkerId}
            onChange={(e) => { const b = catalog?.find((x) => x.id === e.target.value); setV({ ...v, biomarkerId: e.target.value, unit: b ? b.unit : v.unit }); }}>
            <option value="">Избери…</option>
            {grouped.map(([cat, list]) => <optgroup key={cat} label={cat}>{list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>)}
            <option value="__custom">Друг показател (въведи име)</option>
          </Select>
          {v.biomarkerId === '__custom' && <Input label="Име на показателя *" wrapperClassName="sm:col-span-2" value={v.customName} onChange={(e) => setV({ ...v, customName: e.target.value })} error={errors.customName} />}
          <Input label="Дата *" type="date" value={v.collectedAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setV({ ...v, collectedAt: e.target.value })} error={errors.collectedAt} />
          <Input label="Стойност *" inputMode="decimal" placeholder="напр. 42 или 5,4" value={v.valueText} onChange={(e) => setV({ ...v, valueText: e.target.value })} error={errors.valueText} />
          <Input label="Единица" list="units" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} hint={bm && bm.supportedUnits.length > 1 ? `Поддържани: ${bm.supportedUnits.join(', ')}` : undefined} />
          <datalist id="units">{(bm?.supportedUnits ?? []).map((u) => <option key={u} value={u} />)}</datalist>
          <Input label="Източник" placeholder="напр. лаборатория, домашен уред" value={v.sourceLabel} onChange={(e) => setV({ ...v, sourceLabel: e.target.value })} />
          <Input label="Референтен минимум" inputMode="decimal" value={v.low} onChange={(e) => setV({ ...v, low: e.target.value })} error={errors.low} />
          <Input label="Референтен максимум" inputMode="decimal" value={v.high} onChange={(e) => setV({ ...v, high: e.target.value })} error={errors.high} />
          <p className="text-sm text-muted sm:col-span-2">Попълни диапазона само ако е посочен в документа. Vitalog не добавя общи „нормални стойности“.</p>
          <div className="sm:col-span-2"><Textarea label="Бележка" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" onClick={() => navigate(-1)}>Отказ</Button>
            <Button type="submit" loading={save.isPending}>Запази резултата</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
