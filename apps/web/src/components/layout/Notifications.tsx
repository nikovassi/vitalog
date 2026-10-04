import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import clsx from 'clsx';
import { formatDateTime, type Notification } from '@vitalog/shared';
import { get, post } from '../../lib/api';

/** Factual notifications only ("Резултатът е готов за потвърждение") – never alarms. */
export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ items: Notification[]; unread: number }>('/api/notifications'), refetchInterval: 60_000 });
  const readAll = useMutation({ mutationFn: () => post('/api/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readOne = useMutation({ mutationFn: (id: string) => post(`/api/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const unread = data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true"
        aria-label={unread ? `Известия, ${unread} непрочетени` : 'Известия'}
        className="relative flex size-11 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2 hover:text-ink">
        <Bell className="size-5" aria-hidden />
        {unread > 0 && <span className="num absolute top-1.5 right-1.5 flex min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-ink">{unread}</span>}
      </button>
      {open && (
        <div className="fade-up absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface shadow-pop" role="region" aria-label="Известия">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="font-display font-semibold">Известия</p>
            {unread > 0 && <button className="text-sm font-medium text-accent hover:underline" onClick={() => readAll.mutate()}>Маркирай всички</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {!data?.items.length && <li className="px-4 py-8 text-center text-[15px] text-muted">Нямаш известия.</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <button
                  className={clsx('flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2', !n.readAt && 'bg-accent-soft/40')}
                  onClick={() => { if (!n.readAt) readOne.mutate(n.id); setOpen(false); if (n.link) navigate(n.link); }}
                >
                  <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium">{n.title}</span>
                    {n.body && <span className="block text-sm text-ink-2">{n.body}</span>}
                    <span className="block text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
