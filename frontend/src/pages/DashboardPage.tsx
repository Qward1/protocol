import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ListChecks, Search, Upload } from "lucide-react";
import clsx from "clsx";
import { api, TASK_PRIORITY, TASK_STATUS, type Task } from "@/lib/api";
import { PageHeader, Empty, Skeleton } from "@/components/ui";
import SystemHealthNotice from "@/components/SystemHealthNotice";
import { deadlineDate, deadlineUrgency } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { StatCards, type TaskCounts } from "@/components/tasks/StatCards";
import { TaskCard } from "@/components/tasks/TaskCard";
import { useTaskMutations } from "@/components/tasks/useTaskMutations";
import { FILTERS, ALL_FILTERS, type Draft, type Filter, type Sort } from "@/components/tasks/types";

export default function DashboardPage() {
  // Фильтр/сортировка/поиск живут в URL, чтобы переживать переход к протоколу и «назад».
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>(() => {
    const f = searchParams.get("filter") as Filter | null;
    return f && ALL_FILTERS.includes(f) ? f : "Все";
  });
  const [sort, setSort] = useState<Sort>(() => (searchParams.get("sort") === "deadline" ? "deadline" : "created"));
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [completionText, setCompletionText] = useState<Record<string, string>>({});
  // Переход «к карточке» из аналитики: /?focus=<id>. Захватываем один раз при
  // монтировании — синхронизация URL ниже затирает focus, но нам он уже не нужен.
  const [focusId, setFocusId] = useState<string | null>(() => searchParams.get("focus"));
  const [flashId, setFlashId] = useState<string | null>(null);

  // Синхронизируем состояние обратно в URL (replace — без замусоривания истории).
  useEffect(() => {
    const next = new URLSearchParams();
    if (filter !== "Все") next.set("filter", filter);
    if (sort !== "created") next.set("sort", sort);
    if (query.trim()) next.set("q", query.trim());
    setSearchParams(next, { replace: true });
  }, [filter, sort, query, setSearchParams]);

  const { can } = useAuth();
  const canUpload = can("upload");

  const { data: tasks, isLoading } = useQuery({ queryKey: ["tasks"], queryFn: () => api.listTasks() });

  // Чтобы искомая карточка точно была в списке — сбрасываем фильтр/поиск.
  useEffect(() => {
    if (focusId) {
      setFilter("Все");
      setQuery("");
    }
  }, [focusId]);

  // Подскроллить к карточке и кратко подсветить её.
  useEffect(() => {
    if (!focusId || isLoading) return;
    const el = document.getElementById(`task-${focusId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(focusId);
    const timer = window.setTimeout(() => {
      setFlashId(null);
      setFocusId(null);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [focusId, isLoading, tasks]);

  const mutations = useTaskMutations({
    onUpdated: () => {
      setEditingId(null);
      setDraft(null);
    },
    onExecutionSubmitted: (id) => setCompletionText((prev) => ({ ...prev, [id]: "" })),
  });

  const isOverdue = (t: Task) => deadlineUrgency(t.deadline, t.status, t.deadline_at) === "overdue";
  const isSentToMax = (t: Task) => Boolean(t.notified_at || t.max_chat_id);

  const counts: TaskCounts = {
    total: tasks?.length ?? 0,
    new: tasks?.filter((t) => t.status === TASK_STATUS.new).length ?? 0,
    review: tasks?.filter((t) => t.status === TASK_STATUS.review).length ?? 0,
    done: tasks?.filter((t) => t.status === TASK_STATUS.done).length ?? 0,
    overdue: tasks?.filter(isOverdue).length ?? 0,
    sent: tasks?.filter(isSentToMax).length ?? 0,
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (tasks ?? []).filter((task) => {
      const filterMatch =
        filter === "Все"
          ? true
          : filter === "Просрочено"
            ? isOverdue(task)
            : filter === "В MAX"
              ? isSentToMax(task)
              : task.status === filter;
      const queryMatch =
        !q ||
        [task.assignment, task.responsible, task.department, task.deadline, task.completion_text]
          .join(" ")
          .toLowerCase()
          .includes(q);
      return filterMatch && queryMatch;
    });
    if (sort === "deadline") {
      // По сроку (ближайшие сверху); нераспознанные/пустые сроки — в конец.
      return [...list].sort((a, b) => {
        const da = deadlineDate(a.deadline, a.deadline_at)?.getTime() ?? Infinity;
        const db = deadlineDate(b.deadline, b.deadline_at)?.getTime() ?? Infinity;
        return da - db;
      });
    }
    return list; // API уже отдаёт created_at desc
  }, [filter, query, sort, tasks]);

  function startEdit(task: Task) {
    setEditingId(task.id);
    setExpandedId(null);
    setDraft({
      assignment: task.assignment,
      responsible: task.responsible,
      department: task.department,
      deadline: task.deadline,
      status: task.status,
      priority: task.priority || TASK_PRIORITY.normal,
      location: task.location,
      object: task.object,
      theme: task.theme,
      max_username: task.max_username,
    });
  }

  function setDraftField<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ListChecks}
        title="Реестр поручений"
        subtitle="Ответственные, сроки, статусы, контроль исполнения и отправка в MAX — в одном месте."
        actions={
          canUpload ? (
            <Link to="/upload" className="btn-primary">
              <Upload className="h-4 w-4" /> Новая запись
            </Link>
          ) : undefined
        }
      />

      <SystemHealthNotice />

      <StatCards counts={counts} filter={filter} onFilter={setFilter} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5 rounded-xl2 border border-border bg-surface p-1 shadow-soft">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors",
                filter === f ? "bg-accent/12 text-accent" : "text-muted hover:bg-elevated hover:text-fg",
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">
            <span className="hidden sm:inline">Сортировка</span>
            <select
              className="input w-auto"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              aria-label="Сортировка поручений"
            >
              <option value="created">Сначала новые</option>
              <option value="deadline">По сроку</option>
            </select>
          </label>
          <label className="relative block w-full lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input
              className="input pl-9"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по поручениям…"
            />
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card flex gap-4 p-4">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-8 w-48" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Empty
          icon={ListChecks}
          title={tasks?.length ? "Ничего не найдено" : "Поручений пока нет"}
          hint={
            tasks?.length
              ? "Измените фильтр или поисковый запрос."
              : "Загрузите запись встречи и сформируйте протокол — поручения появятся здесь."
          }
          action={
            !tasks?.length ? (
              <Link to="/upload" className="btn-primary">
                <Upload className="h-4 w-4" /> Загрузить запись
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => (
            <div
              key={task.id}
              id={`task-${task.id}`}
              className={clsx(
                "scroll-mt-24 rounded-xl2 transition-shadow",
                flashId === task.id && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
              )}
            >
            <TaskCard
              task={task}
              can={can}
              editing={editingId === task.id}
              expanded={expandedId === task.id}
              draft={editingId === task.id ? draft : null}
              setDraftField={setDraftField}
              completion={completionText[task.id] ?? task.completion_text ?? ""}
              onCompletionChange={(text) => setCompletionText((prev) => ({ ...prev, [task.id]: text }))}
              onStartEdit={() => startEdit(task)}
              onCancelEdit={() => {
                setEditingId(null);
                setDraft(null);
              }}
              onToggleExpand={() => setExpandedId(expandedId === task.id ? null : task.id)}
              mutations={mutations}
            />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
