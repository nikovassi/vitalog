import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, ChevronRight, Database, FileDown, FileText, KeyRound, LogOut, Monitor, Moon, Share2, ShieldCheck, Smartphone,
  Stethoscope, Sun, Trash2, UserCog,
} from 'lucide-react';
import { DISCLAIMER, formatDateTime, type MeResponse, type ThemePreference } from '@vitalog/shared';
import { ApiError, del, downloadBlob, get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { applyTheme } from '../lib/theme';
import { useTitle } from '../lib/hooks';
import { LOCAL_MODE } from '../lib/mode';
import { Card, PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Checkbox, Input, Segmented } from '../components/ui/Form';
import { Alert, useToast } from '../components/ui/Feedback';
import { ConfirmDialog, Dialog } from '../components/ui/Dialog';

const ACTIONS: Record<string, string> = {
  'auth.login': 'Вход', 'auth.login_failed': 'Неуспешен опит за вход', 'auth.logout': 'Изход', 'auth.password_changed': 'Смяна на парола',
  'auth.password_reset': 'Възстановяване на парола', 'auth.mfa_enabled': 'Включена 2FA', 'auth.mfa_disabled': 'Изключена 2FA', 'auth.session_revoked': 'Прекратена сесия',
  'document.upload': 'Качен документ', 'document.view': 'Преглед на документ', 'document.download': 'Изтеглен документ', 'document.delete': 'Изтрит документ',
  'report.delete': 'Изтрито изследване', 'share.create': 'Създаден линк за споделяне', 'share.revoke': 'Отнет линк', 'share.access': 'Отворен споделен линк', 'export.create': 'Експорт на данни',
};

function Section({ title, icon, children, id }: { title: string; icon: ReactNode; children: ReactNode; id: string }) {
  return (
    <Card className="p-5 sm:p-6" aria-labelledby={id}>
      <h2 id={id} className="mb-4 flex items-center gap-2 font-display text-lg font-semibold"><span className="text-accent">{icon}</span>{title}</h2>
      {children}
    </Card>
  );
}

/** Password confirmation for sensitive actions (server enforces it too). */
function useReauth() {
  const [pending, setPending] = useState<null | (() => Promise<void>)>(null);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    try { await action(); } catch (e) {
      if (e instanceof ApiError && e.code === 'reauth_required') { setPending(() => action); setPw(''); setErr(null); } else throw e;
    }
  };
  const dialog = (
    <Dialog open={!!pending} onClose={() => setPending(null)} title="Потвърди паролата си"
      footer={<><Button variant="secondary" onClick={() => setPending(null)}>Отказ</Button><Button loading={busy} onClick={async () => {
        setBusy(true);
        try { await post('/api/auth/reauth', { password: pw }); const a = pending!; setPending(null); await a(); }
        catch (e) { setErr(e instanceof ApiError ? e.message : 'Грешка'); }
        finally { setBusy(false); }
      }}>Потвърди</Button></>}>
      <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
        <p className="text-[15px] text-ink-2">От съображения за сигурност потвърди паролата си за това действие.</p>
        {err && <Alert tone="error">{err}</Alert>}
        <Input label="Парола" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      </form>
    </Dialog>
  );
  return { run, dialog };
}

export default function Settings() {
  useTitle('Профил и настройки');
  const { me, setMe, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const reauth = useReauth();
  const [name, setName] = useState(me?.profile.displayName ?? '');
  const [fullName, setFullName] = useState(me?.profile.fullName ?? '');
  const demo = !!me?.profile.isDemo;

  const saveProfile = useMutation({ mutationFn: (body: Record<string, unknown>) => patch<MeResponse>('/api/profile', body), onSuccess: (m) => { setMe(m); toast('Запазено.'); } });
  const setTheme = (t: ThemePreference) => { applyTheme(t); saveProfile.mutate({ theme: t }); };

  const { data: privacy } = useQuery({ queryKey: ['privacy'], queryFn: () => get<{ aiAvailable: boolean; consents: Array<{ kind: string; version: string; granted: boolean; at: string }>; usage: { documentsProcessed: number; documentsLimit: number; aiCalls: number } }>('/api/account/privacy') });
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: () => get<Array<{ id: string; userAgent: string | null; ipPrefix: string | null; lastSeenAt: string; createdAt: string; current: boolean }>>('/api/auth/sessions') });
  const { data: activity } = useQuery({ queryKey: ['activity'], queryFn: () => get<Array<{ action: string; at: string; ipPrefix: string | null; byOwner: boolean }>>('/api/account/activity') });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/api/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  const revokeOthers = useMutation({ mutationFn: () => post('/api/auth/sessions/revoke-others'), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['sessions'] }); toast('Излезе от всички други устройства.'); } });

  const [pwOpen, setPwOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [localWipe, setLocalWipe] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Профил и настройки" subtitle={LOCAL_MODE ? 'Данните се пазят само в този браузър' : me?.user.email} />

      {/* Mobile-only shortcuts to sections not in the bottom nav */}
      <Card className="divide-y divide-border lg:hidden">
        {[
          { to: '/app/documents', label: 'Моите документи', icon: FileText },
          { to: '/app/specialists', label: 'Моите специалисти', icon: Stethoscope },
          { to: '/app/timeline', label: 'Хронология', icon: CalendarClock },
          { to: '/app/trends', label: 'Графики', icon: Database },
          ...(LOCAL_MODE ? [] : [{ to: '/app/summary', label: 'Медицинско обобщение (PDF)', icon: FileDown }, { to: '/app/share', label: 'Сподели с лекар', icon: Share2 }]),
        ].map((l) => (
          <Link key={l.to} to={l.to} className="flex h-14 items-center gap-3 px-4 text-[15px] font-medium hover:bg-surface-2">
            <l.icon className="size-5 text-ink-2" aria-hidden /><span className="flex-1">{l.label}</span><ChevronRight className="size-5 text-muted" aria-hidden />
          </Link>
        ))}
      </Card>

      <Section id="s-profile" title="Профил" icon={<UserCog className="size-5" />}>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); saveProfile.mutate({ displayName: name, fullName: fullName || null }); }}>
          <Input label="Име за обръщение" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Пълно име (по избор)" value={fullName} onChange={(e) => setFullName(e.target.value)} hint="Използва се само за да те предупредим, ако качиш документ на друг човек." />
          <div className="sm:col-span-2"><Button type="submit" variant="secondary" loading={saveProfile.isPending}>Запази</Button></div>
        </form>
      </Section>

      <Section id="s-theme" title="Външен вид" icon={<Sun className="size-5" />}>
        <Segmented label="Тема" value={me?.profile.theme ?? 'system'} onChange={setTheme} options={[{ value: 'system', label: 'Като системата' }, { value: 'light', label: 'Светла' }, { value: 'dark', label: 'Тъмна' }]} />
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted"><Monitor className="size-4" /><Sun className="size-4" /><Moon className="size-4" />Предпочитанието се запазва в профила ти.</p>
      </Section>

      {LOCAL_MODE && (
        <Section id="s-local" title="Къде са данните ми" icon={<ShieldCheck className="size-5" />}>
          <ul className="space-y-2 text-[15px] text-ink-2">
            <li>✓ PDF файловете се обработват на това устройство. Нищо не се изпраща към сървър.</li>
            <li>✓ Всички данни са записани само в този браузър (IndexedDB).</li>
            <li>⚠️ Ако изчистиш данните на сайта, ползваш режим „инкогнито“ или смениш устройството, данните няма да са налични. Изтегляй редовно копие (JSON) по-долу.</li>
            <li>⚠️ Всеки с достъп до това устройство и браузър може да ги види. Не ползвай споделен компютър.</li>
            <li>ℹ️ Споделянето с лекар чрез линк, двуфакторната защита и PDF обобщението са в сървърната версия.</li>
          </ul>
        </Section>
      )}

      {!LOCAL_MODE && <Section id="s-sec" title="Сигурност" icon={<ShieldCheck className="size-5" />}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setPwOpen(true)} disabled={demo}>Смени паролата</Button>
          {me?.user.mfaEnabled
            ? <Button variant="secondary" onClick={() => reauth.run(async () => { await post('/api/auth/mfa/disable'); setMe(await get<MeResponse>('/api/auth/me')); toast('Двуфакторната защита е изключена.', 'info'); })}>Изключи 2FA</Button>
            : <Button variant="secondary" icon={<Smartphone className="size-4" />} onClick={() => setMfaOpen(true)} disabled={demo}>Включи двуфакторна защита</Button>}
        </div>
        <p className="mt-2 text-sm text-muted">{me?.user.mfaEnabled ? '✓ Двуфакторната защита е включена.' : 'Препоръчваме двуфакторна защита за здравни данни.'}</p>

        <h3 className="mt-6 mb-2 font-semibold">Активни сесии</h3>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {sessions?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <Monitor className="size-5 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px]">{describeUA(s.userAgent)} {s.current && <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-soft-ink">това устройство</span>}</p>
                <p className="num text-xs text-muted">Последна активност {formatDateTime(s.lastSeenAt)} · {s.ipPrefix}</p>
              </div>
              {!s.current && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Излез</Button>}
            </li>
          ))}
        </ul>
        {(sessions?.length ?? 0) > 1 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => revokeOthers.mutate()}>Излез от всички други устройства</Button>}
      </Section>}

      {!LOCAL_MODE && <Section id="s-privacy" title="Поверителност" icon={<ShieldCheck className="size-5" />}>
        <ul className="space-y-2 text-[15px] text-ink-2">
          <li>✓ Данните ти са частни по подразбиране. Няма публичен профил.</li>
          <li>✓ Файловете се криптират с отделен ключ за твоя профил.</li>
          <li>✓ Администраторите не виждат медицинските ти резултати.</li>
        </ul>
        {privacy?.aiAvailable && (
          <div className="mt-4 rounded-xl border border-border p-4">
            <Checkbox label="Разреши AI помощ при структуриране на трудни документи" checked={!!me?.profile.aiProcessingConsent}
              description="Изключено по подразбиране. Използва се само когато автоматичното разпознаване не успее. Името ти и личните идентификатори се премахват преди изпращане. AI не интерпретира резултатите."
              onChange={(e) => { if (e.target.checked) setAiOpen(true); else saveProfile.mutate({ aiProcessingConsent: false }); }} />
          </div>
        )}
        <h3 className="mt-5 mb-2 font-semibold">Дадени съгласия</h3>
        <ul className="space-y-1 text-sm text-ink-2">
          {privacy?.consents.map((c, i) => <li key={i} className="num">{c.kind === 'health_data' ? 'Обработка на здравни данни' : 'AI обработка'} · {c.granted ? 'дадено' : 'оттеглено'} · {formatDateTime(c.at)} · версия {c.version}</li>)}
        </ul>
        {privacy && <p className="mt-3 text-sm text-muted">Обработени документи този месец: {privacy.usage.documentsProcessed} от {privacy.usage.documentsLimit}.</p>}
        <details className="mt-5">
          <summary className="cursor-pointer font-semibold">Достъп до данните ми (последни 100 действия)</summary>
          <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto text-sm">
            {activity?.map((a, i) => <li key={i} className="flex justify-between gap-3 py-2"><span>{ACTIONS[a.action] ?? a.action}{!a.byOwner && a.action === 'share.access' ? ' (чрез линк)' : ''}</span><span className="num shrink-0 text-muted">{formatDateTime(a.at)}</span></li>)}
          </ul>
        </details>
      </Section>}

      <Section id="s-data" title="Моите данни" icon={<Database className="size-5" />}>
        <p className="mb-3 text-[15px] text-ink-2">Изтегли копие на всичките си данни по всяко време.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => downloadBlob('GET', '/api/export/csv', 'vitalog-results.csv')}>Резултати (CSV)</Button>
          <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => reauth.run(() => downloadBlob('GET', '/api/export/json', 'vitalog-export.json'))}>Всички данни (JSON)</Button>
          <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => reauth.run(() => downloadBlob('GET', '/api/export/fhir', 'vitalog-fhir.json'))}>FHIR R4 Bundle</Button>
          {!LOCAL_MODE && <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => navigate('/app/summary')}>PDF обобщение</Button>}
        </div>
      </Section>

      <Card className="border-[var(--danger)]/30 p-5 sm:p-6">
        <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-danger"><Trash2 className="size-5" />{LOCAL_MODE ? 'Изтриване на всички данни' : 'Изтриване на акаунта'}</h2>
        <p className="text-[15px] text-ink-2">{LOCAL_MODE ? 'Ще бъдат изтрити всички резултати, документи, специалисти и бележки от този браузър. Действието е необратимо.' : 'Изтриването на акаунта ще премахне всички свързани данни – резултати, документи, специалисти, бележки и линкове. Действието е необратимо.'}</p>
        <Button variant="danger" className="mt-4" onClick={() => (LOCAL_MODE ? setLocalWipe(true) : demo ? logout() : setDeleteOpen(true))}>{LOCAL_MODE ? 'Изтрий всички данни' : demo ? 'Изход от демото' : 'Изтрий акаунта'}</Button>
      </Card>

      {me && ['admin', 'superadmin', 'support'].includes(me.user.role) && <Link to="/app/admin" className="block text-sm font-medium text-accent hover:underline">Административен панел →</Link>}
      <Button variant="ghost" icon={<LogOut className="size-4" />} onClick={async () => { await logout(); navigate('/login'); }}>Изход</Button>
      <p className="text-xs text-muted">{DISCLAIMER}</p>

      {reauth.dialog}
      <ConfirmDialog open={localWipe} onClose={() => setLocalWipe(false)} requireText="ИЗТРИЙ" title="Изтриване на всички данни"
        text="Изтриването ще премахне всички данни от този браузър. Препоръчваме първо да изтеглиш копие (JSON)."
        onConfirm={async () => { await post('/api/account/delete'); setMe(null); navigate('/', { replace: true }); }} />
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      <MfaDialog open={mfaOpen} onClose={() => setMfaOpen(false)} run={reauth.run} />
      <DeleteAccountDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} run={reauth.run} />
      <ConfirmDialog open={aiOpen} onClose={() => setAiOpen(false)} danger={false} confirmLabel="Давам съгласие" title="Съгласие за AI обработка"
        onConfirm={() => { saveProfile.mutate({ aiProcessingConsent: true }); setAiOpen(false); }}
        text={<>Текстът на документите, които не успеем да разпознаем автоматично, може да бъде изпратен до AI доставчик в ЕС само за подреждане на таблицата с резултати. Името и личните ти идентификатори се премахват. Можеш да оттеглиш съгласието по всяко време. Извлечените стойности винаги минават през твоя преглед.</>} />
    </div>
  );
}

function describeUA(ua: string | null) {
  if (!ua) return 'Неизвестно устройство';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Устройство';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${br} ${os}`.trim();
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [v, setV] = useState({ currentPassword: '', newPassword: '' });
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => post('/api/auth/change-password', v),
    onSuccess: () => { toast('Паролата е сменена. Другите сесии са прекратени.'); setV({ currentPassword: '', newPassword: '' }); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Грешка'),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Смени паролата" footer={<><Button variant="secondary" onClick={onClose}>Отказ</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Смени</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {err && <Alert tone="error">{err}</Alert>}
        <Input label="Текуща парола" type="password" autoComplete="current-password" value={v.currentPassword} onChange={(e) => setV({ ...v, currentPassword: e.target.value })} />
        <Input label="Нова парола" type="password" autoComplete="new-password" hint="Поне 10 символа." value={v.newPassword} onChange={(e) => setV({ ...v, newPassword: e.target.value })} />
      </form>
    </Dialog>
  );
}

function MfaDialog({ open, onClose, run }: { open: boolean; onClose: () => void; run: (a: () => Promise<void>) => Promise<void> }) {
  const { setMe } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const start = () => run(async () => setSetup(await post('/api/auth/mfa/setup')));
  const enable = async () => {
    setErr(null);
    try {
      const r = await post<{ recoveryCodes: string[] }>('/api/auth/mfa/enable', { code });
      setCodes(r.recoveryCodes);
      setMe(await get<MeResponse>('/api/auth/me'));
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Грешка'); }
  };
  const close = () => { setSetup(null); setCodes(null); setCode(''); onClose(); };
  return (
    <Dialog open={open} onClose={close} title="Двуфакторна защита">
      {codes ? (
        <div className="space-y-3">
          <Alert tone="success" title="2FA е включена.">Запази тези резервни кодове на сигурно място. Всеки може да се използва веднъж, ако нямаш достъп до телефона си. Няма да бъдат показани отново.</Alert>
          <ul className="num grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-4 font-mono text-[15px]">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <Button className="w-full" onClick={close}>Готово</Button>
        </div>
      ) : !setup ? (
        <div className="space-y-3 text-[15px] text-ink-2">
          <p>Ще ти трябва приложение за удостоверяване (напр. Aegis, 2FAS, Google Authenticator, 1Password).</p>
          <Button onClick={start}>Започни</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[15px] text-ink-2">1. Сканирай QR кода с приложението си.</p>
          <img src={setup.qrDataUrl} alt="QR код за приложението за удостоверяване" className="mx-auto size-48 rounded-xl bg-white p-2" />
          <p className="text-center text-xs text-muted">Или въведи ключа: <code className="break-all">{setup.secret}</code></p>
          <p className="text-[15px] text-ink-2">2. Въведи 6-цифрения код от приложението.</p>
          {err && <Alert tone="error">{err}</Alert>}
          <Input label="Код" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button className="w-full" onClick={enable}>Включи 2FA</Button>
        </div>
      )}
    </Dialog>
  );
}

function DeleteAccountDialog({ open, onClose, run }: { open: boolean; onClose: () => void; run: (a: () => Promise<void>) => Promise<void> }) {
  const [pw, setPw] = useState('');
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await run(async () => { await post('/api/account/delete', { password: pw, confirmation: typed }); });
      setMe(null);
      navigate('/?deleted=1', { replace: true });
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Грешка'); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Изтриване на акаунта"
      footer={<><Button variant="secondary" onClick={onClose}>Отказ</Button><Button variant="danger" disabled={typed !== 'ИЗТРИЙ' || !pw} loading={busy} onClick={go}>Изтрий завинаги</Button></>}>
      <div className="space-y-3 text-[15px]">
        <Alert tone="warning">Изтриването на акаунта ще премахне всички свързани данни. Това не може да бъде отменено. Препоръчваме първо да изтеглиш копие на данните си.</Alert>
        {err && <Alert tone="error">{err}</Alert>}
        <Input label="Парола" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Input label={<>Напиши <b>ИЗТРИЙ</b>, за да потвърдиш</>} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </div>
    </Dialog>
  );
}
