import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, ShieldCheck } from 'lucide-react';
import { CONSENT_VERSION, DISCLAIMER, emailSchema, loginSchema, passwordSchema, type MeResponse } from '@vitalog/shared';
import { ApiError, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useNoIndex, useTitle } from '../lib/hooks';
import { Button } from '../components/ui/Button';
import { Checkbox, Input } from '../components/ui/Form';
import { Alert } from '../components/ui/Feedback';
import { Logo } from '../components/ui/Logo';
import { LOCAL_MODE } from '../lib/mode';
import { Navigate } from 'react-router-dom';

type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';

function Shell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  useTitle(title);
  useNoIndex();
  return (
    <div className="flex min-h-dvh flex-col items-center bg-bg px-4 py-8 sm:justify-center">
      <Link to="/" className="mb-8" aria-label="Vitalog – начална страница"><Logo /></Link>
      <main className="fade-up w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-8">
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </main>
      {footer && <div className="mt-6 text-center text-[15px] text-ink-2">{footer}</div>}
      <p className="mt-8 flex max-w-md items-start gap-2 text-xs text-muted"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />Данните се пазят криптирани в ЕС и са видими само за теб.</p>
    </div>
  );
}

export default function Auth({ mode }: { mode: Mode }) {
  if (LOCAL_MODE) return mode === 'register' ? <LocalStart /> : mode === 'login' ? <LocalLogin /> : <Navigate to="/" replace />;
  if (mode === 'register') return <Register />;
  if (mode === 'forgot') return <Forgot />;
  if (mode === 'reset') return <Reset />;
  if (mode === 'verify') return <Verify />;
  return <Login />;
}

function useAfterLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next');
  return () => navigate(next && next.startsWith('/app') ? next : '/app', { replace: true });
}

function Login() {
  const { setMe, me } = useAuth();
  const [params] = useSearchParams();
  const after = useAfterLogin();
  const [error, setError] = useState<string | null>(null);
  const [mfa, setMfa] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(loginSchema) });

  useEffect(() => { if (me && !me.mfaPending) after(); else if (me?.mfaPending) setMfa(true); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await post<MeResponse>('/api/auth/login', values);
      setMe(res);
      if (res.mfaPending) setMfa(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Неуспешен вход.');
    }
  });

  const verifyMfa = async () => {
    setBusy(true);
    setError(null);
    try {
      setMe(await post<MeResponse>('/api/auth/mfa/verify', { code }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Невалиден код.');
    } finally {
      setBusy(false);
    }
  };

  const demo = async () => {
    setBusy(true);
    try {
      setMe(await post<MeResponse>('/api/auth/demo'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Демо режимът не е наличен.');
      setBusy(false);
    }
  };

  if (mfa) {
    return (
      <Shell title="Двуфакторна защита" subtitle="Въведи 6-цифрения код от приложението за удостоверяване или резервен код.">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void verifyMfa(); }}>
          {error && <Alert tone="error">{error}</Alert>}
          <Input label="Код" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          <Button type="submit" className="w-full" loading={busy} icon={<ShieldCheck className="size-4" />}>Потвърди</Button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title="Вход" subtitle="Добре дошъл отново." footer={<>Нямаш акаунт? <Link to="/register" className="font-medium text-accent hover:underline">Регистрирай се</Link></>}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {params.get('expired') && <Alert tone="info">Сесията ти изтече от съображения за сигурност. Моля, влез отново.</Alert>}
        {params.get('reset') && <Alert tone="success">Паролата е сменена. Влез с новата парола.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Email" type="email" autoComplete="email" {...register('email')} error={errors.email?.message} />
        <Input label="Парола" type="password" autoComplete="current-password" {...register('password')} error={errors.password?.message} />
        <div className="flex justify-end"><Link to="/forgot" className="text-sm font-medium text-accent hover:underline">Забравена парола?</Link></div>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>Вход</Button>
      </form>
      <div className="my-5 flex items-center gap-3 text-sm text-muted"><span className="h-px flex-1 bg-border" />или<span className="h-px flex-1 bg-border" /></div>
      <Button variant="secondary" className="w-full" onClick={demo} loading={busy}>Разгледай демо (синтетични данни)</Button>
    </Shell>
  );
}

const registerForm = z.object({
  displayName: z.string().trim().min(1, 'Въведи име').max(80),
  email: emailSchema,
  password: passwordSchema,
  consentHealthData: z.boolean().refine((v) => v, 'Необходимо е съгласие, за да съхраняваме здравни данни.'),
  acceptDisclaimer: z.boolean().refine((v) => v, 'Моля, потвърди.'),
});

function Register() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(registerForm), defaultValues: { consentHealthData: false, acceptDisclaimer: false } });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      setMe(await post<MeResponse>('/api/auth/register', { email: v.email, password: v.password, displayName: v.displayName, consentHealthData: true, consentVersion: CONSENT_VERSION }));
      navigate('/app', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Регистрацията не успя.');
    }
  });
  return (
    <Shell title="Създай акаунт" subtitle="Безплатно. Отнема по-малко от минута." footer={<>Имаш акаунт? <Link to="/login" className="font-medium text-accent hover:underline">Влез</Link></>}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Как да те наричаме?" autoComplete="given-name" {...register('displayName')} error={errors.displayName?.message} />
        <Input label="Email" type="email" autoComplete="email" {...register('email')} error={errors.email?.message} />
        <Input label="Парола" type="password" autoComplete="new-password" hint="Поне 10 символа. Фраза от няколко думи е добър избор." {...register('password')} error={errors.password?.message} />
        <div className="space-y-3 rounded-xl bg-surface-2 p-4">
          <Checkbox {...register('consentHealthData')} label="Съгласен съм Vitalog да съхранява и обработва моите медицински документи и резултати, за да ги организира и визуализира."
            description="Изрично съгласие по чл. 9 GDPR. Можеш да го оттеглиш, като изтриеш профила си." />
          {errors.consentHealthData && <p role="alert" className="text-sm text-danger">{errors.consentHealthData.message}</p>}
          <Checkbox {...register('acceptDisclaimer')} label="Разбирам, че Vitalog не поставя диагнози и не замества лекар." />
          {errors.acceptDisclaimer && <p role="alert" className="text-sm text-danger">{errors.acceptDisclaimer.message}</p>}
        </div>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>Създай акаунт</Button>
        <p className="text-xs text-muted">{DISCLAIMER}</p>
      </form>
    </Shell>
  );
}

function Forgot() {
  const [done, setDone] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(z.object({ email: emailSchema })) });
  const onSubmit = handleSubmit(async (v) => {
    const r = await post<{ message: string }>('/api/auth/forgot', v).catch((e: ApiError) => ({ message: e.message }));
    setDone(r.message);
  });
  return (
    <Shell title="Забравена парола" subtitle="Ще ти изпратим линк за смяна на паролата." footer={<Link to="/login" className="font-medium text-accent hover:underline">Обратно към вход</Link>}>
      {done ? <Alert tone="success">{done}</Alert> : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Input label="Email" type="email" autoComplete="email" {...register('email')} error={errors.email?.message} />
          <Button type="submit" className="w-full" loading={isSubmitting}>Изпрати линк</Button>
        </form>
      )}
    </Shell>
  );
}

function Reset() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Паролите не съвпадат', path: ['confirm'] })),
  });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await post('/api/auth/reset', { token: params.get('token') ?? '', password: v.password });
      navigate('/login?reset=1', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Неуспешна смяна.');
    }
  });
  return (
    <Shell title="Нова парола" subtitle="След смяната всички активни сесии ще бъдат прекратени.">
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Нова парола" type="password" autoComplete="new-password" {...register('password')} error={errors.password?.message} />
        <Input label="Повтори паролата" type="password" autoComplete="new-password" {...register('confirm')} error={errors.confirm?.message} />
        <Button type="submit" className="w-full" loading={isSubmitting}>Смени паролата</Button>
      </form>
    </Shell>
  );
}

function Verify() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    post('/api/auth/verify-email', { token: params.get('token') ?? '' })
      .then(() => { setState('ok'); void refresh(); })
      .catch((e: ApiError) => { setState('error'); setMsg(e.message); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Shell title="Потвърждение на email">
      {state === 'loading' && <p className="text-muted">Проверяваме…</p>}
      {state === 'ok' && <Alert tone="success" title="Email адресът е потвърден." action={<Link to="/app" className="font-medium underline">Към началото</Link>} />}
      {state === 'error' && <Alert tone="error">{msg}</Alert>}
    </Shell>
  );
}

/** Local mode (GitHub Pages): no accounts – a profile that lives only in this browser. */
function LocalStart() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      setMe(await post<MeResponse>('/api/auth/register', { displayName: name }));
      navigate('/app', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Неуспешно.');
      setBusy(false);
    }
  };
  return (
    <Shell title="Започни" subtitle="Без регистрация. Данните ти остават само в този браузър." footer={<Link to="/login" className="font-medium text-accent hover:underline">Вече имам данни в този браузър</Link>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && ack) void start(); }}>
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Как да те наричаме?" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
        <Alert tone="info" title="Как се пазят данните">
          PDF файловете се обработват на твоето устройство и всичко се записва само в този браузър. Нищо не се изпраща към сървър.
          Ако изчистиш данните на сайта в браузъра или смениш устройството, данните няма да са налични – изтегляй копие от „Профил → Моите данни“.
        </Alert>
        <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} label="Разбирам. Разбирам и че Vitalog не поставя диагнози и не замества лекар." />
        <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!name.trim() || !ack}>Започни</Button>
        <p className="text-xs text-muted">{DISCLAIMER}</p>
      </form>
    </Shell>
  );
}

function LocalLogin() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (url: string) => {
    setBusy(true);
    setError(null);
    try {
      setMe(await post<MeResponse>(url));
      navigate('/app', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Неуспешно.');
      setBusy(false);
    }
  };
  return (
    <Shell title="Добре дошъл отново" subtitle="Данните ти са записани в този браузър." footer={<Link to="/register" className="font-medium text-accent hover:underline">Започни нов профил</Link>}>
      <div className="space-y-3">
        {error && <Alert tone="info">{error}</Alert>}
        <Button className="w-full" size="lg" loading={busy} onClick={() => go('/api/auth/login')}>Продължи</Button>
        <Button className="w-full" variant="secondary" loading={busy} onClick={() => go('/api/auth/demo')}>Разгледай демо (синтетични данни)</Button>
      </div>
    </Shell>
  );
}
