import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  Activity, CalendarClock, FileText, FlaskConical, Home, LineChart, Plus, Search, Stethoscope, Upload, User,
} from 'lucide-react';
import { DISCLAIMER } from '@vitalog/shared';
import { useAuth } from '../../lib/auth';
import { useNoIndex } from '../../lib/hooks';
import { Logo, LogoMark } from '../ui/Logo';
import { LinkButton } from '../ui/Button';
import { SearchDialog } from './SearchDialog';
import { NotificationsButton } from './Notifications';
import { DemoBanner, VerifyBanner } from './Banners';
import { RecoveryCodeDialog, SyncIndicator } from './CloudWidgets';
import { LOCAL_MODE } from '../../lib/mode';

const NAV = [
  { to: '/app', label: 'Начало', icon: Home, end: true },
  { to: '/app/reports', label: 'Изследвания', icon: FlaskConical },
  { to: '/app/biomarkers', label: 'Показатели', icon: Activity },
  { to: '/app/trends', label: 'Графики', icon: LineChart },
  { to: '/app/timeline', label: 'Хронология', icon: CalendarClock },
  { to: '/app/documents', label: 'Документи', icon: FileText },
  { to: '/app/specialists', label: 'Специалисти', icon: Stethoscope },
  { to: '/app/settings', label: 'Профил', icon: User },
];

const MOBILE_NAV = [
  { to: '/app', label: 'Начало', icon: Home, end: true },
  { to: '/app/reports', label: 'Изследвания', icon: FlaskConical },
  null, // upload FAB
  { to: '/app/biomarkers', label: 'Показатели', icon: Activity },
  { to: '/app/settings', label: 'Профил', icon: User },
];

export function AppShell() {
  useNoIndex();
  const { me } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only z-50 rounded-lg bg-accent px-4 py-2 text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Към съдържанието</a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface lg:flex" aria-label="Основна навигация">
        <div className="px-5 pt-5 pb-4"><NavLink to="/app" aria-label="Vitalog – начало"><Logo /></NavLink></div>
        <div className="px-4 pb-4">
          <LinkButton to="/app/upload" className="w-full" icon={<Upload className="size-4" />}>Качи изследване</LinkButton>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors', isActive ? 'bg-accent-soft text-accent-soft-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
              <n.icon className="size-5" aria-hidden />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <p className="border-t border-border px-5 py-4 text-xs leading-relaxed text-muted">{DISCLAIMER}</p>
      </aside>

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <NavLink to="/app" className="lg:hidden" aria-label="Vitalog – начало"><LogoMark className="size-9" /></NavLink>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="ml-auto flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-left text-[15px] text-muted transition-colors hover:border-border-strong sm:max-w-md lg:ml-0"
            aria-label="Търсене на показатели, изследвания, документи"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="truncate">Търси показател, изследване…</span>
            <kbd className="ml-auto hidden rounded-md border border-border px-1.5 text-xs sm:inline">Ctrl K</kbd>
          </button>
          {LOCAL_MODE && <SyncIndicator />}
          <NotificationsButton />
          <button onClick={() => navigate('/app/settings')} className="hidden size-11 items-center justify-center rounded-full lg:flex" aria-label="Профил и настройки" title={me?.profile.displayName}>
            <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft font-display font-semibold text-accent-soft-ink">{me?.profile.displayName.slice(0, 1).toUpperCase()}</span>
          </button>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pt-5 pb-32 sm:px-6 lg:pb-12">
        {me?.profile.isDemo && <DemoBanner />}
        {me && !LOCAL_MODE && !me.profile.isDemo && !me.user.emailVerified && <VerifyBanner />}
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface lg:hidden" aria-label="Основна навигация">
        <ul className="mx-auto grid h-[68px] max-w-lg grid-cols-5 items-stretch">
          {MOBILE_NAV.map((n, i) => n ? (
            <li key={n.to}>
              <NavLink to={n.to} end={n.end} className={({ isActive }) => clsx('flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive ? 'text-accent' : 'text-muted')}>
                <n.icon className="size-[22px]" aria-hidden />
                {n.label}
              </NavLink>
            </li>
          ) : (
            <li key={i} className="flex items-center justify-center">
              <NavLink to="/app/upload" aria-label="Качи изследване" className="-mt-6 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-pop ring-4 ring-bg transition-transform active:scale-95">
                <Plus className="size-7" strokeWidth={2.5} aria-hidden />
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      {LOCAL_MODE && <RecoveryCodeDialog />}
    </div>
  );
}

