import { useEffect, useState } from 'react';
import { Cloud, CloudOff, Copy, Loader2 } from 'lucide-react';
import { clearRecoveryCode, onRecoveryCode, peekRecoveryCode } from '../../lib/cloud/notice';
import { onSync } from '../../lib/local/store';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Alert, useToast } from '../ui/Feedback';
import { Checkbox } from '../ui/Form';

/** Shown once after sign-up / password change: the code that can unlock the encrypted data. */
export function RecoveryCodeDialog() {
  const [code, setCode] = useState(peekRecoveryCode());
  const [saved, setSaved] = useState(false);
  const toast = useToast();
  useEffect(() => onRecoveryCode(() => setCode(peekRecoveryCode())), []);
  return (
    <Dialog open={!!code} onClose={() => { if (saved) { clearRecoveryCode(); setSaved(false); } }} title="Запази кода за възстановяване"
      footer={<Button disabled={!saved} onClick={() => { clearRecoveryCode(); setSaved(false); }}>Запазих го</Button>}>
      <div className="space-y-4 text-[15px]">
        <p className="text-ink-2">Данните ти са криптирани с ключ от паролата. Ако я забравиш и я смениш през имейл, само този код може да ги отключи. Никой друг – и ние – не може да ги възстанови.</p>
        <p className="num rounded-xl bg-surface-2 px-4 py-3 text-center font-mono text-lg font-semibold tracking-wider break-all">{code}</p>
        <Button variant="secondary" size="sm" icon={<Copy className="size-4" />} onClick={() => { void navigator.clipboard.writeText(code ?? ''); toast('Копирано.'); }}>Копирай</Button>
        <Alert tone="warning">Запиши го на хартия или в мениджър за пароли. Няма да бъде показан отново.</Alert>
        <Checkbox checked={saved} onChange={(e) => setSaved(e.target.checked)} label="Запазих кода на сигурно място" />
      </div>
    </Dialog>
  );
}

/** Small header indicator for encrypted cloud sync. */
export function SyncIndicator() {
  const [state, setState] = useState<{ s: 'idle' | 'saving' | 'saved' | 'error'; m?: string }>({ s: 'idle' });
  useEffect(() => onSync((s, m) => setState({ s, m })), []);
  if (state.s === 'idle') return null;
  const label = state.s === 'saving' ? 'Записва се криптирано…' : state.s === 'saved' ? 'Запазено в облака (криптирано)' : `Неуспешна синхронизация: ${state.m ?? ''}`;
  return (
    <span className={`flex items-center gap-1.5 text-xs ${state.s === 'error' ? 'text-danger' : 'text-muted'}`} role="status" title={label}>
      {state.s === 'saving' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : state.s === 'error' ? <CloudOff className="size-4" aria-hidden /> : <Cloud className="size-4" aria-hidden />}
      <span className="sr-only sm:not-sr-only">{state.s === 'saved' ? 'Запазено' : state.s === 'saving' ? 'Записва се…' : 'Грешка при синхронизация'}</span>
    </span>
  );
}
