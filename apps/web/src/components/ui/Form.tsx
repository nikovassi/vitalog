import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

const control = 'w-full min-w-0 rounded-xl border border-border-strong bg-surface px-3.5 text-[16px] text-ink placeholder:text-muted transition-[border,box-shadow] focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--accent-soft)] disabled:opacity-60 aria-[invalid=true]:border-danger';

export function Field({ label, hint, error, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink-2">{label}</label>
      {children}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string; wrapperClassName?: string };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, className, wrapperClassName, id, ...rest }, ref) {
  const auto = useId();
  const iid = id ?? auto;
  const input = <input ref={ref} id={iid} aria-invalid={!!error || undefined} aria-describedby={error ? `${iid}-err` : undefined} className={clsx(control, 'h-11', className)} {...rest} />;
  if (!label) return input;
  return <Field label={label} hint={hint} error={error} htmlFor={iid} className={wrapperClassName}>{input}</Field>;
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; error?: string; wrapperClassName?: string };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, error, className, wrapperClassName, id, children, ...rest }, ref) {
  const auto = useId();
  const iid = id ?? auto;
  const el = <select ref={ref} id={iid} aria-invalid={!!error || undefined} className={clsx(control, 'h-11 pr-8', className)} {...rest}>{children}</select>;
  if (!label) return el;
  return <Field label={label} error={error} htmlFor={iid} className={wrapperClassName}>{el}</Field>;
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; error?: string };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, error, className, id, ...rest }, ref) {
  const auto = useId();
  const iid = id ?? auto;
  const el = <textarea ref={ref} id={iid} aria-invalid={!!error || undefined} className={clsx(control, 'min-h-24 py-2.5', className)} {...rest} />;
  if (!label) return el;
  return <Field label={label} error={error} htmlFor={iid}>{el}</Field>;
});

export function Checkbox({ label, description, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={clsx('flex items-start gap-3', className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-5 shrink-0 rounded-md accent-[var(--accent)]" {...rest} />
      <label htmlFor={id} className="text-[15px] leading-snug text-ink">
        {label}
        {description && <span className="mt-0.5 block text-sm text-muted">{description}</span>}
      </label>
    </div>
  );
}

/** Segmented control (radio group semantics). */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('scrollbar-none flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('h-9 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors', value === o.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={clsx('h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors', active ? 'border-accent bg-accent-soft text-accent-soft-ink' : 'border-border bg-surface text-ink-2 hover:border-border-strong')}>
      {children}
    </button>
  );
}
