import { TASK_STATUS, type Task } from "@/lib/api";

// Виджеты-фильтры: статусы + «Просрочено» + «В MAX» (последний доступен только
// как стат-карточка, не как таб). Токены статусов — из общего TASK_STATUS.
export const FILTERS = ["Все", TASK_STATUS.new, TASK_STATUS.review, TASK_STATUS.done, "Просрочено"] as const;
export const STATUS_OPTIONS = [TASK_STATUS.new, TASK_STATUS.review, TASK_STATUS.done] as const;

export type Filter = (typeof FILTERS)[number] | "В MAX";
export const ALL_FILTERS: Filter[] = [...FILTERS, "В MAX"];

export type Sort = "created" | "deadline";

export type Draft = Pick<
  Task,
  | "assignment"
  | "responsible"
  | "department"
  | "deadline"
  | "status"
  | "priority"
  | "location"
  | "object"
  | "theme"
  | "max_username"
>;
