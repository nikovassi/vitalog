import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { post } from '../../lib/api';
import { Alert } from '../ui/Feedback';
import { Button } from '../ui/Button';
import { STATIC_DEMO } from '../../lib/staticDemo';

export function DemoBanner() {
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-border bg-info-soft px-4 py-3 text-[15px] text-info-ink">
      <Sparkles className="mt-0.5 size-5 shrink-0" aria-hidden />
      {STATIC_DEMO
        ? <p><b>Статична демо версия.</b> Всички данни са синтетични и измислени. Промените не се запазват и нищо не се изпраща към сървър.</p>
        : <p><b>Демо режим.</b> Всички данни тук са синтетични и измислени. Демо профилът се изтрива автоматично след 24 часа.</p>}
    </div>
  );
}

export function VerifyBanner() {
  const [sent, setSent] = useState(false);
  return (
    <Alert tone="info" className="mb-5" title="Потвърди email адреса си"
      action={<Button size="sm" variant="secondary" disabled={sent} onClick={async () => { await post('/api/auth/resend-verification'); setSent(true); }}>{sent ? 'Изпратено' : 'Изпрати отново'}</Button>}>
      Изпратихме ти линк за потвърждение. Това защитава акаунта ти.
    </Alert>
  );
}
