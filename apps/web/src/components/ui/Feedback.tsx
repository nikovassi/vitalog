import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy aria-label="Зареждане">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-36" />)}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-ink">{icon}</div>}
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {text && <p className="mt-1 max-w-md text-[15px] text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

type Tone = 'info' | 'success' | 'warning' | 'error';
const toneStyle: Record<Tone, string> = {
  info: 'bg-info-soft text-info-ink',
  success: 'bg-accent-soft text-accent-soft-ink',
  warning: 'bg-attention-soft text-attention-ink',
  error: 'bg-danger-soft text-danger',
};
const toneIcon: Record<Tone, typeof Info> = { info: Info, success: CheckCircle2, warning: TriangleAlert, error: AlertCircle };

export function Alert({ tone = 'info', title, children, className, action }: { tone?: Tone; title?: string; children?: ReactNode; className?: string; action?: ReactNode }) {
  const Icon = toneIcon[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-xl px-4 py-3 text-[15px]', toneStyle[tone], className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : 'Нещо се обърка при зареждането.';
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <Alert tone={notFound ? 'info' : 'error'} title={notFound ? 'Не е намерено' : 'Грешка при зареждане'} action={onRetry && !notFound ? <Button size="sm" variant="secondary" onClick={onRetry}>Опитай отново</Button> : undefined}>
      {msg}
    </Alert>
  );
}

// ── Toasts ──────────────────────────────────────────────────────
interface Toast { id: number; tone: Tone; text: string }
const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:pr-6">
        {toasts.map((t) => {
          const Icon = toneIcon[t.tone];
          return (
            <div key={t.id} className="fade-up pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-[15px] shadow-pop">
              <Icon className={clsx('size-5 shrink-0', t.tone === 'error' ? 'text-danger' : t.tone === 'warning' ? 'text-attention' : 'text-accent')} aria-hidden />
              <span className="flex-1">{t.text}</span>
              <button className="text-muted hover:text-ink" aria-label="Затвори" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X className="size-4" /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
