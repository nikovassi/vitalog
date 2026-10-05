import { useEffect, useState } from 'react';
import { onRecoveryCode, peekRecoveryCode } from '../../lib/cloud/notice';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, LineChart, Upload } from 'lucide-react';
import { DISCLAIMER, type MeResponse } from '@vitalog/shared';
import { patch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';

const STEPS = [
  { icon: Upload, title: 'Качи изследване', text: 'PDF от лабораторията – от телефона или компютъра.' },
  { icon: CheckCircle2, title: 'Провери извлечените данни', text: 'Нищо не се записва, преди да го потвърдиш.' },
  { icon: LineChart, title: 'Следи показателите във времето', text: 'Графики, промени и референтните граници на лабораторията.' },
];

/** Short first-run onboarding (one screen, three steps). */
export function Onboarding() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(!me?.profile.onboardingCompletedAt);
  // the recovery code dialog (cloud sign-up) must be handled first – never two modals at once
  const [blocked, setBlocked] = useState(!!peekRecoveryCode());
  useEffect(() => onRecoveryCode(() => setBlocked(!!peekRecoveryCode())), []);
  const finish = async (go?: string) => {
    setOpen(false);
    try { setMe(await patch<MeResponse>('/api/profile', { onboardingCompleted: true })); } catch { /* non-critical */ }
    if (go) navigate(go);
  };
  return (
    <Dialog open={open && !blocked} onClose={() => finish()} title={`Добре дошъл${me ? `, ${me.profile.displayName}` : ''}!`}
      footer={<>
        <Button variant="ghost" onClick={() => finish()}>По-късно</Button>
        <Button onClick={() => finish('/app/upload')} icon={<Upload className="size-4" />}>Качи първото си изследване</Button>
      </>}>
      <p className="text-[15px] text-ink-2">Как работи платформата:</p>
      <ol className="mt-4 space-y-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-ink"><s.icon className="size-5" aria-hidden /></span>
            <span><b className="block">{i + 1}. {s.title}</b><span className="text-[15px] text-muted">{s.text}</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-xs text-muted">{DISCLAIMER}</p>
    </Dialog>
  );
}
