import clsx from "clsx";
import { TASK_STATUS } from "@/lib/api";
import type { Filter } from "./types";

export interface TaskCounts {
  total: number;
  new: number;
  review: number;
  done: number;
  overdue: number;
  sent: number;
}

/** Стат-карточки-фильтры реестра поручений. Все пять кликабельны (один фильтр). */
export function StatCards({
  counts,
  filter,
  onFilter,
}: {
  counts: TaskCounts;
  filter: Filter;
  onFilter: (f: Filter) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Stat label="Всего" value={counts.total} dot="bg-accent" active={filter === "Все"} onClick={() => onFilter("Все")} />
      <Stat label="Новые" value={counts.new} dot="bg-info"
        active={filter === TASK_STATUS.new} onClick={() => onFilter(TASK_STATUS.new)} />
      <Stat label="На проверке" value={counts.review} dot="bg-warning"
        active={filter === TASK_STATUS.review} onClick={() => onFilter(TASK_STATUS.review)} />
      <Stat label="Выполнено" value={counts.done} dot="bg-success"
        active={filter === TASK_STATUS.done} onClick={() => onFilter(TASK_STATUS.done)} />
      <Stat label="Просрочено" value={counts.overdue} dot="bg-danger"
        active={filter === "Просрочено"} onClick={() => onFilter("Просрочено")} />
      <Stat label="В MAX" value={counts.sent} dot="bg-accent/60"
        active={filter === "В MAX"} onClick={() => onFilter("В MAX")} />
    </div>
  );
}

/** Стат-карточка-фильтр: крупная цифра, подпись, тонкая цветная точка (без градиента). */
function Stat({
  label,
  value,
  dot,
  active,
  onClick,
}: {
  label: string;
  value: number;
  dot: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      className={clsx(
        "card p-4 text-left transition-colors",
        onClick && "hover:border-accent/50 hover:bg-elevated",
        active && "border-accent bg-accent/5",
      )}
    >
      <div className="text-2xl font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-muted">
        <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", dot)} aria-hidden />
        {label}
      </div>
    </Tag>
  );
}
