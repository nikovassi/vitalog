import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileSearch, Lock, LineChart, ShieldCheck, Stethoscope, Upload, Smartphone, EyeOff } from 'lucide-react';
import type { MeResponse } from '@vitalog/shared';
import { DISCLAIMER } from '@vitalog/shared';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Logo } from '../components/ui/Logo';
import { Button, LinkButton } from '../components/ui/Button';
import { Alert } from '../components/ui/Feedback';
import { STATIC_DEMO } from '../lib/staticDemo';

export default function Landing() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const demo = async () => {
    setBusy(true);
    try { setMe(await post<MeResponse>('/api/auth/demo')); navigate('/app'); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          {me ? <LinkButton to="/app" size="sm">Към профила</LinkButton> : STATIC_DEMO ? <Button size="sm" onClick={demo}>Отвори демото</Button> : <>
            <LinkButton to="/login" variant="ghost" size="sm">Вход</LinkButton>
            <LinkButton to="/register" size="sm">Регистрация</LinkButton>
          </>}
        </nav>
      </header>

      <main>
        {params.get('deleted') && <div className="mx-auto max-w-6xl px-4 sm:px-6"><Alert tone="success">Акаунтът и всички свързани данни са изтрити.</Alert></div>}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-8 pb-16 sm:px-6 lg:grid-cols-2 lg:pt-16">
          <div className="fade-up">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent-soft-ink"><Lock className="size-3.5" />Частно. Криптирано. В ЕС.</p>
            <h1 className="font-display text-4xl leading-[1.1] font-bold tracking-tight sm:text-5xl">Лабораторните ти резултати, подредени във времето.</h1>
            <p className="mt-5 max-w-xl text-lg text-ink-2">Качи PDF от лабораторията. Vitalog извлича показателите, ти ги проверяваш, и всяко следващо изследване се добавя към графиките ти.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {!STATIC_DEMO && <LinkButton to="/register" size="lg" icon={<Upload className="size-5" />}>Започни безплатно</LinkButton>}
              <Button size="lg" variant="secondary" onClick={demo} loading={busy}>Разгледай демо <ArrowRight className="size-4" /></Button>
            </div>
            <p className="mt-3 text-sm text-muted">{STATIC_DEMO ? 'Това е статична демо версия (GitHub Pages) със синтетични данни. Пълната версия изисква защитен сървър.' : 'Демото използва само синтетични, измислени данни.'}</p>
          </div>
          <HeroMock />
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:grid-cols-3 sm:px-6">
            {[
              { icon: Upload, t: '1. Качи изследване', d: 'PDF от всяка лаборатория – текстов или сканиран. От телефона или компютъра.' },
              { icon: FileSearch, t: '2. Провери данните', d: 'Виждаш всичко извлечено. Несигурните стойности са отбелязани. Нищо не се записва без теб.' },
              { icon: LineChart, t: '3. Следи във времето', d: 'Графики с референтните граници на лабораторията, промени и история на всеки показател.' },
            ].map((f) => (
              <div key={f.t}>
                <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-ink"><f.icon className="size-6" aria-hidden /></span>
                <h2 className="mt-4 font-display text-lg font-semibold">{f.t}</h2>
                <p className="mt-1 text-ink-2">{f.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight">Направено за спокойствие и яснота</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: ShieldCheck, t: 'Поверителност по подразбиране', d: 'Няма публични профили или линкове. Споделяш само избрани данни, временно, и можеш да отнемеш достъпа.' },
              { icon: Lock, t: 'Криптирани файлове', d: 'Всеки документ се криптира с отделен ключ за профила ти. Данните се хостват в ЕС.' },
              { icon: EyeOff, t: 'Без диагнози', d: 'Показваме стойности, лабораторни граници и промени – без медицински заключения. Тълкуването е за лекаря ти.' },
              { icon: CheckCircle2, t: 'Ясни статуси', d: '✓ В диапазона, ↑ Над, ↓ Под – с икона и текст, не само с цвят.' },
              { icon: Stethoscope, t: 'Специалисти и обобщения', d: 'Свържи изследванията с лекарите си и генерирай PDF обобщение за прегледа.' },
              { icon: Smartphone, t: 'Удобно на телефона', d: 'Качване директно от телефона, графики, които се четат на малък екран.' },
            ].map((f) => (
              <div key={f.t} className="rounded-2xl border border-border bg-surface p-5">
                <f.icon className="size-6 text-accent" aria-hidden />
                <h3 className="mt-3 font-semibold">{f.t}</h3>
                <p className="mt-1 text-[15px] text-ink-2">{f.d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted sm:px-6">
          <p>{DISCLAIMER}</p>
          <p className="mt-3">© {new Date().getFullYear()} Vitalog · <Link to="/login" className="hover:underline">Вход</Link></p>
        </div>
      </footer>
    </div>
  );
}

/** Illustrative product mock with clearly fictional numbers. */
function HeroMock() {
  const pts = [[30, 120], [110, 88], [190, 104], [270, 70], [350, 82]];
  return (
    <div className="relative" aria-hidden>
      <div className="rounded-3xl border border-border bg-surface p-5 shadow-pop sm:p-6">
        <div className="flex items-start justify-between">
          <div><p className="text-sm text-muted">Пикочна киселина · пример</p><p className="num mt-1 font-display text-4xl font-bold">356 <span className="text-base font-medium text-muted">µmol/L</span></p></div>
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[13px] font-medium text-accent-soft-ink">✓ В диапазона</span>
        </div>
        <svg viewBox="0 0 380 160" className="mt-4 w-full">
          <rect x="0" y="50" width="380" height="80" fill="var(--band)" />
          <line x1="0" y1="50" x2="380" y2="50" stroke="var(--band-edge)" strokeDasharray="4 4" />
          <line x1="0" y1="130" x2="380" y2="130" stroke="var(--band-edge)" strokeDasharray="4 4" />
          <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
          {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />)}
          <rect x="182" y="22" width="12" height="12" rx="2" transform="rotate(45 188 28)" fill="var(--surface)" stroke="var(--ink-2)" strokeWidth="1.5" />
        </svg>
        <p className="mt-2 text-sm text-ink-2">↑ Стойността се е увеличила с 14% спрямо предходното измерване.</p>
      </div>
      <div className="absolute -bottom-6 -left-4 hidden rounded-2xl border border-border bg-surface px-4 py-3 shadow-pop sm:block">
        <p className="text-sm font-medium">Открихме 33 показателя</p>
        <p className="text-xs text-muted">Провери ги преди записване</p>
      </div>
    </div>
  );
}
