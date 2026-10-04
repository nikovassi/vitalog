import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown } from 'lucide-react';
import { CATEGORY_LABELS, type BiomarkerSummary } from '@vitalog/shared';
import { ApiError, downloadBlob, get } from '../lib/api';
import { presetFrom, RANGE_LABELS, useTitle, type RangePreset } from '../lib/hooks';
import { Card, PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Checkbox, Segmented } from '../components/ui/Form';
import { Alert, useToast } from '../components/ui/Feedback';

/** "Генерирай медицинско обобщение" – only selected data goes into the PDF. */
export default function Summary() {
  useTitle('Медицинско обобщение');
  const toast = useToast();
  const { data: all } = useQuery({ queryKey: ['biomarkers', 'sort=name'], queryFn: () => get<BiomarkerSummary[]>('/api/biomarkers?sort=name') });
  const [preset, setPreset] = useState<RangePreset>('1y');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [opts, setOpts] = useState({ includePatientName: true, includeCharts: true, includeHistory: true, includeSpecialists: false, includeDocuments: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const selected = picked ?? new Set((all ?? []).filter((s) => s.favorite).map((s) => s.id));
  const toggle = (id: string) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      await downloadBlob('POST', '/api/export/summary', 'vitalog-obobshtenie.pdf', { from: presetFrom(preset), to: null, biomarkerIds: [...selected], ...opts });
      toast('Обобщението е генерирано.');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Неуспешно генериране.');
    } finally {
      setBusy(false);
    }
  };

  const byCat = (all ?? []).reduce<Record<string, BiomarkerSummary[]>>((a, s) => { (a[s.category] ??= []).push(s); return a; }, {});

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Генерирай медицинско обобщение" subtitle="PDF за теб или за лекар. Включва само това, което избереш." />
      <Card className="space-y-6 p-5 sm:p-6">
        <div>
          <h2 className="mb-2 font-semibold">Период</h2>
          <Segmented label="Период" value={preset} onChange={setPreset} options={(['3m', '6m', '1y', '3y', 'all'] as RangePreset[]).map((v) => ({ value: v, label: RANGE_LABELS[v] }))} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Показатели ({selected.size})</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set((all ?? []).map((s) => s.id)))}>Всички</Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Нито един</Button>
            </div>
          </div>
          <div className="max-h-80 space-y-4 overflow-y-auto rounded-xl border border-border p-4">
            {Object.entries(byCat).map(([cat, list]) => (
              <fieldset key={cat}>
                <legend className="mb-1.5 text-sm font-semibold text-muted">{CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS]}</legend>
                <div className="grid gap-2 sm:grid-cols-2">{list.map((s) => <Checkbox key={s.id} label={s.name} checked={selected.has(s.id)} onChange={() => toggle(s.id)} />)}</div>
              </fieldset>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <h2 className="font-semibold">Съдържание</h2>
          <Checkbox label="Име на пациента" checked={opts.includePatientName} onChange={(e) => setOpts({ ...opts, includePatientName: e.target.checked })} />
          <Checkbox label="Графики" checked={opts.includeCharts} onChange={(e) => setOpts({ ...opts, includeCharts: e.target.checked })} />
          <Checkbox label="История на резултатите" checked={opts.includeHistory} onChange={(e) => setOpts({ ...opts, includeHistory: e.target.checked })} />
          <Checkbox label="Специалисти" checked={opts.includeSpecialists} onChange={(e) => setOpts({ ...opts, includeSpecialists: e.target.checked })} />
          <Checkbox label="Списък с документи" checked={opts.includeDocuments} onChange={(e) => setOpts({ ...opts, includeDocuments: e.target.checked })} />
        </div>
        {err && <Alert tone="error">{err}</Alert>}
        <Alert tone="warning" title="Изпращане на лекар">
          PDF файлът съдържа здравни данни. Обикновеният email не е криптиран – предпочети да го предадеш лично, през защитен канал или чрез „Сподели с лекар“ (временен линк, който можеш да отнемеш).
        </Alert>
        <Button size="lg" className="w-full sm:w-auto" icon={<FileDown className="size-5" />} loading={busy} disabled={!selected.size} onClick={generate}>Генерирай PDF</Button>
      </Card>
    </div>
  );
}
