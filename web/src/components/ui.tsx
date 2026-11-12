import { X, Loader2 } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  const v: Record<Variant, string> = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm shadow-indigo-600/20',
    secondary: 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-white text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50',
  };
  return (
    <button
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        v[variant],
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children, title, actions, bodyClass }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode; bodyClass?: string }) {
  return (
    <section className={cx('rounded-xl bg-white ring-1 ring-slate-200/80 shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={cx('p-5', bodyClass)}>{children}</div>
    </section>
  );
}

const tones = {
  slate: 'bg-slate-100 text-slate-600',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
};
export function Badge({ tone = 'slate', children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent', tones[tone], className)}>{children}</span>;
}

const inputCls =
  'w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none';

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, 'h-9', p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, 'font-mono text-xs', p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, 'h-9', p.className)} />;

export function Field({ label, help, required, children }: { label: string; help?: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
      {help && <span className="mt-1 block text-xs text-slate-500">{help}</span>}
    </label>
  );
}

/** 打开中的弹窗，Esc 只关闭最上层的一个 */
const modalStack: object[] = [];

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const token = {};
    modalStack.push(token);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && modalStack[modalStack.length - 1] === token && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(token), 1);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className={cx('w-full rounded-2xl bg-white shadow-2xl', wide ? 'max-w-4xl' : 'max-w-xl')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="size-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 scrollbar-thin">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, desc, action }: { icon?: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icon}</div>}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {desc && <p className="mt-1 max-w-sm text-xs text-slate-500">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {desc && <p className="mt-1 text-sm text-slate-500">{desc}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

export function ScoreRing({ value, size = 64, label }: { value?: number; size?: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color = value === undefined ? '#cbd5e1' : v >= 80 ? '#10b981' : v >= 60 ? '#f59e0b' : '#f43f5e';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#f1f5f9" strokeWidth={6} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={6} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} className="transition-all duration-700" />
      </svg>
      <div className="absolute flex flex-col items-center leading-none">
        <span className="font-semibold text-slate-900" style={{ fontSize: size / 4 }}>{value === undefined ? '—' : v.toFixed(0)}</span>
        {label && <span className="mt-0.5 text-[10px] text-slate-500">{label}</span>}
      </div>
    </div>
  );
}

export function Progress({ value, tone = 'indigo' }: { value: number; tone?: 'indigo' | 'emerald' }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cx('h-full rounded-full transition-all duration-500', tone === 'indigo' ? 'bg-indigo-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cx('rounded-md px-3 py-1.5 text-xs font-medium transition', value === it.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export { cx };
