import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, parseLabNumber, type LabResult } from '@vitalog/shared';
import { ApiError, del, get, patch } from '../../lib/api';
import { Dialog, ConfirmDialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Form';
import { Alert, useToast } from '../ui/Feedback';

export interface EditableResult { id: string; valueText: string; unit: string | null; rangeLow: number | null; rangeHigh: number | null; name: string }

const n = (s: string) => (s.trim() === '' ? null : parseLabNumber(s)?.value ?? NaN);

/** Correct a stored result. Every change is kept in the audit trail (result_edits). */
export function EditResultDialog({ result, onClose }: { result: EditableResult | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ valueText: '', unit: '', low: '', high: '' });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (result) setV({ valueText: result.valueText, unit: result.unit ?? '', low: result.rangeLow?.toString().replace('.', ',') ?? '', high: result.rangeHigh?.toString().replace('.', ',') ?? '' });
    setErr(null);
  }, [result]);
  const save = useMutation({
    mutationFn: () => {
      const low = n(v.low), high = n(v.high);
      if (Number.isNaN(low) || Number.isNaN(high)) throw new ApiError(400, 'bad', 'Диапазонът трябва да е число.');
      return patch<LabResult>(`/api/results/${result!.id}`, { valueText: v.valueText, unit: v.unit || null, referenceRange: low === null && high === null ? null : { low, high } });
    },
    onSuccess: () => { void qc.invalidateQueries(); toast('Резултатът е коригиран. Оригиналната стойност е запазена в историята.'); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Неуспешно записване.'),
  });
  return (
    <Dialog open={!!result} onClose={onClose} title={`Редактирай: ${result?.name ?? ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Отказ</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Запази</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        {err && <Alert tone="error" className="col-span-2">{err}</Alert>}
        <Input label="Стойност" inputMode="decimal" value={v.valueText} onChange={(e) => setV({ ...v, valueText: e.target.value })} />
        <Input label="Единица" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} />
        <Input label="Реф. минимум" inputMode="decimal" value={v.low} onChange={(e) => setV({ ...v, low: e.target.value })} />
        <Input label="Реф. максимум" inputMode="decimal" value={v.high} onChange={(e) => setV({ ...v, high: e.target.value })} />
        <p className="col-span-2 text-sm text-muted">Промени диапазона само ако е грешно разчетен. Използвай диапазона от документа на лабораторията.</p>
      </div>
    </Dialog>
  );
}

interface History { result: LabResult; source: string; extractedAt: string | null; createdAt: string; updatedAt: string; edits: Array<{ field: string; originalValue: string | null; newValue: string | null; context: string; editedAt: string; editedBy: string }> }
const FIELD: Record<string, string> = { value: 'Стойност', unit: 'Единица', range: 'Диапазон', biomarker: 'Показател', name: 'Име', date: 'Дата' };
const SRC: Record<string, string> = { pdf: 'Лабораторен PDF', manual: 'Ръчно въведен', import: 'Импортирани данни', device: 'Устройство' };

export function HistoryDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['history', id], queryFn: () => get<History>(`/api/results/${id}/history`), enabled: !!id });
  return (
    <Dialog open={!!id} onClose={onClose} title="История на резултата">
      {!data ? <p className="text-muted">Зареждане…</p> : (
        <div className="space-y-4 text-[15px]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Източник</dt><dd>{SRC[data.source] ?? data.source}{data.result.sourcePage ? `, страница ${data.result.sourcePage}` : ''}</dd>
            {data.extractedAt && <><dt className="text-muted">Извлечен</dt><dd className="num">{formatDateTime(data.extractedAt)}</dd></>}
            <dt className="text-muted">Записан</dt><dd className="num">{formatDateTime(data.createdAt)}</dd>
            <dt className="text-muted">Последна промяна</dt><dd className="num">{formatDateTime(data.updatedAt)}</dd>
          </dl>
          {data.edits.length === 0 ? <p className="text-muted">Резултатът не е редактиран.</p> : (
            <ol className="space-y-2">
              {data.edits.map((e, i) => (
                <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="text-sm text-muted">{formatDateTime(e.editedAt)} · {e.context === 'review' ? 'при прегледа след извличане' : 'по-късна корекция'} · {e.editedBy}</p>
                  <p><b>{FIELD[e.field] ?? e.field}:</b> <span className="num">{e.context === 'review' ? 'Извлечено автоматично' : 'Беше'}: {e.originalValue ?? '—'}</span> → <span className="num">Променено: {e.newValue ?? '—'}</span></p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function DeleteResultDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({ mutationFn: () => del(`/api/results/${id}`), onSuccess: () => { void qc.invalidateQueries(); toast('Резултатът е изтрит.', 'info'); onClose(); } });
  return <ConfirmDialog open={!!id} onClose={onClose} onConfirm={() => m.mutate()} loading={m.isPending} title="Сигурен ли си?" text="Резултатът ще бъде изтрит необратимо." />;
}
