import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Form';

/** Native <dialog>: focus trap, Esc, inert background and screen-reader semantics for free. */
export function Dialog({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      aria-labelledby="dlg-title"
      className={`m-auto w-[calc(100%-2rem)] ${size === 'lg' ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-border bg-surface p-0 text-ink shadow-pop backdrop:bg-black/40 backdrop:backdrop-blur-[2px]`}
    >
      {open && (
        <div className="fade-up flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <h2 id="dlg-title" className="font-display text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Затвори"><X className="size-5" /></button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** "Сигурен ли си?" – optionally requires typing a confirmation word. */
export function ConfirmDialog({
  open, onClose, onConfirm, title, text, confirmLabel = 'Изтрий', danger = true, requireText, loading,
}: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; requireText?: string; loading?: boolean }) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Отказ</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} disabled={!!requireText && typed !== requireText}>{confirmLabel}</Button>
      </>}
    >
      <div className="space-y-4 text-[15px] text-ink-2">
        {text}
        {requireText && <Input label={<>Напиши <b>{requireText}</b>, за да потвърдиш</>} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
      </div>
    </Dialog>
  );
}
