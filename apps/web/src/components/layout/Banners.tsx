import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { post } from '../../lib/api';
import { Alert } from '../ui/Feedback';
import { Button } from '../ui/Button';
import { LOCAL_MODE } from '../../lib/mode';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

export function DemoBanner() {
  const navigate = useNavigate();
  const { setMe } = useAuth();
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-border bg-info-soft px-4 py-3 text-[15px] text-info-ink">
      <Sparkles className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="flex-1">
        {LOCAL_MODE
          ? <p><b>Демо режим.</b> Всички данни тук са синтетични и измислени. Можеш да качваш и редактираш – всичко остава само в този браузър.</p>
          : <p><b>Демо режим.</b> Всички данни тук са синтетични и измислени. Демо профилът се изтрива автоматично след 24 часа.</p>}
        {LOCAL_MODE && (
          <button className="mt-1 font-semibold underline underline-offset-2" onClick={async () => { await post('/api/account/delete'); setMe(null); navigate('/register'); }}>
            Изчисти демото и започни със собствени данни
          </button>
        )}
      </div>
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
