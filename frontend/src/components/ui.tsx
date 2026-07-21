import clsx from "clsx";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { personTint } from "@/lib/utils";

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
    <div className="mb-6 flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Иконка заголовка — тихий маркер типа экрана, без цветного «квадрата». */}
        {Icon && <Icon className="h-[22px] w-[22px] shrink-0 text-accent" />}
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({
  children,
  count,
  action,
}: {
  children: ReactNode;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {/* Тонкая акцентная планка — фирменный «маркер записи». */}
        <span className="h-4 w-0.5 rounded-full bg-accent" aria-hidden />
        <h2 className="text-[15px] font-semibold text-fg">{children}</h2>
        {count !== undefined && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent/12 px-1.5 text-xs font-semibold tabular-nums text-accent">
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
      role="status"
      aria-label="Загрузка"
      className={clsx(
        "inline-block animate-spin rounded-full border-2 border-current border-t-transparent",
        className ?? "h-4 w-4",
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("skeleton", className)} />;
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
    <div className="flex flex-col items-center justify-center rounded-xl2 border border-dashed border-border bg-surface/50 px-4 py-14 text-center">
      {Icon && (
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl2 bg-elevated text-muted">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-md text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Badge({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={clsx("chip", className)} style={style}>
      {children}
    </span>
  );
}

/** Круглый аватар с инициалами — для ответственных по поручениям.
 *  Тон берётся из общей personTint (utils), а не из локальной копии. */
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
        "grid shrink-0 place-items-center rounded-full text-xs font-semibold",
        className ?? "h-8 w-8",
      )}
      style={personTint(name)}
      title={name || undefined}
    >
      {initials || "?"}
    </span>
  );
}

/* ============================================================================
   Modal — общая обвязка для всех диалогов (SpeakerRename, Justification, Confirm).
   Фокус-ловушка, возврат фокуса, Escape, блокировка скролла body, aria.
   ========================================================================== */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  onClose,
  children,
  maxWidthClass = "max-w-lg",
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const node = ref.current;
    const focusables = node?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables && focusables[0] ? focusables[0] : node)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ overscrollBehavior: "contain" }}>
      <div className="absolute inset-0 animate-fade-in bg-black/50" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          "elevated relative z-10 max-h-[85vh] w-full animate-pop-in overflow-y-auto outline-none",
          maxWidthClass,
        )}
        style={{ overscrollBehavior: "contain" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button onClick={onClose} className="icon-btn h-8 w-8" aria-label="Закрыть">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Диалог подтверждения деструктивного действия — вместо window.confirm. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Удалить",
  cancelLabel = "Отмена",
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} maxWidthClass="max-w-md">
      <div className="text-sm text-muted">{description}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </button>
        <button className="btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? <Spinner /> : null}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ============================================================================
   Toast — единые уведомления (успех/ошибка/инфо), автоскрытие через 5с.
   Без сторонних зависимостей: контекст + портал.
   ========================================================================== */

type ToastKind = "ok" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastCtx {
  toast: (text: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (text: string, kind: ToastKind = "ok") => {
      const id = Date.now() + Math.random();
      setItems((list) => [...list, { id, kind, text }]);
      window.setTimeout(() => remove(id), 5000);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
          <div aria-live="polite" aria-atomic="false" className="flex w-full flex-col items-center gap-2 sm:items-end">
            {items.map((t) => (
              <div
                key={t.id}
                role={t.kind === "error" ? "alert" : "status"}
                className={clsx(
                  "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl2 border bg-surface px-4 py-3 text-sm shadow-2 animate-pop-in",
                  t.kind === "ok" && "border-success/40",
                  t.kind === "error" && "border-danger/40",
                  t.kind === "info" && "border-info/40",
                )}
              >
                <span
                  aria-hidden
                  className={clsx(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    t.kind === "ok" && "bg-success",
                    t.kind === "error" && "bg-danger",
                    t.kind === "info" && "bg-info",
                  )}
                />
                <span className="flex-1">{t.text}</span>
                <button
                  onClick={() => remove(t.id)}
                  aria-label="Закрыть уведомление"
                  className="-mr-1 -mt-0.5 rounded-md p-1 text-muted hover:bg-elevated hover:text-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
