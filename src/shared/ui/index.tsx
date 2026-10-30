import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './ui.module.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'link';
  fullWidth?: boolean;
  busy?: boolean;
};

/** Botón base. `busy` lo deshabilita mientras la operación está en curso (evita doble clic). */
export function Button({ variant = 'primary', fullWidth, busy, disabled, className, children, ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], fullWidth ? styles.fullWidth : '', className ?? ''].join(' ');
  return (
    <button className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? 'Procesando…' : children}
    </button>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string | null;
};

export function TextField({ label, hint, error, id, ...rest }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      {hint && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
      <input
        id={inputId}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
      {error && (
        <span id={errorId} className={styles.fieldError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

type SelectFieldProps = {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
};

export function SelectField({ label, hint, value, onChange, options, disabled }: SelectFieldProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {hint && <span className={styles.hint}>{hint}</span>}
      <select
        id={id}
        className={styles.input}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type AlertProps = { tone?: 'info' | 'success' | 'warning' | 'danger'; title?: string; children: ReactNode };

export function Alert({ tone = 'info', title, children }: AlertProps) {
  return (
    <div className={`${styles.alert} ${styles[tone]}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {title && <p className={styles.alertTitle}>{title}</p>}
      {children}
    </div>
  );
}

type TextAreaFieldProps = {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  rows?: number;
};

export function TextAreaField({ label, hint, value, onChange, maxLength, rows = 3 }: TextAreaFieldProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {hint && <span className={styles.hint}>{hint}</span>}
      <textarea
        id={id}
        className={styles.input}
        value={value}
        rows={rows}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

type CheckboxFieldProps = { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void };

export function CheckboxField({ label, hint, checked, onChange }: CheckboxFieldProps) {
  return (
    <label className={styles.checkbox}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className={styles.label}>{label}</span>
        {hint && <span className={`${styles.hint} ${styles.block}`}>{hint}</span>}
      </span>
    </label>
  );
}

export function Badge({ tone, children }: { tone?: 'warning' | 'success'; children: ReactNode }) {
  const toneClass = tone === 'warning' ? styles.badgeWarning : tone === 'success' ? styles.badgeSuccess : '';
  return <span className={`${styles.badge} ${toneClass}`}>{children}</span>;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.pageHeader}>
      <h1>{title}</h1>
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  );
}

/** Tabla con desplazamiento horizontal en pantallas angostas. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>{children}</table>
    </div>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className={styles.fieldRow}>{children}</div>;
}

export function Stack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}

export const uiClasses = { numeric: styles.numeric, muted: styles.muted, subsection: styles.subsection };

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={`${styles.card} ${className ?? ''}`}>{children}</section>;
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className={styles.loading} role="status">
      {label}
    </div>
  );
}

type DialogProps = { title: string; children: ReactNode; actions: ReactNode };

/** Diálogo modal simple con foco inicial en el contenido. */
export function Dialog({ title, children, actions }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className={styles.backdrop}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`${styles.card} ${styles.dialog}`}>
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className={styles.dialogActions}>{actions}</div>
      </div>
    </div>
  );
}
