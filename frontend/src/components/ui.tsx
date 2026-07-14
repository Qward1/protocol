import clsx from "clsx";
import type { ComponentType, ReactNode } from "react";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("card p-4", className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: ComponentType<{ className?: string }>;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 border-b border-border/70 pb-5 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="icon-box h-11 w-11 shrink-0 shadow-soft">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 max-w-3xl text-sm font-medium text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({
  icon: Icon,
  children,
  count,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-accent" />}
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">{children}</h2>
        {count !== undefined && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent/12 px-1.5 text-xs font-bold text-accent">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "inline-block animate-spin rounded-full border-2 border-current border-t-transparent",
        className ?? "h-4 w-4",
      )}
    />
  );
}

export function Empty({
  title,
  hint,
  icon: Icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
}) {
  return (
    <div className="flex animate-fade-in flex-col items-center justify-center rounded-xl2 border border-dashed border-border bg-surface/50 px-4 py-14 text-center">
      {Icon && (
        <div className="icon-box mb-3 h-14 w-14">
          <Icon className="h-7 w-7" />
        </div>
      )}
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-md text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("chip", className)}>{children}</span>;
}

/** Круглый аватар с инициалами — для ответственных по поручениям. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={clsx(
        "grid shrink-0 place-items-center rounded-full text-xs font-bold",
        name ? avatarTint(name) : "bg-border text-muted",
        className ?? "h-8 w-8",
      )}
      title={name || undefined}
    >
      {initials || "?"}
    </span>
  );
}

const AVATAR_TINTS = [
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
];

function avatarTint(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}
