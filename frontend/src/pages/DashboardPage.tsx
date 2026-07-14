import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Edit3,
  ExternalLink,
  FileCheck2,
  ListChecks,
  MessageSquare,
  Save,
  Search,
  Send,
  Upload,
  X,
} from "lucide-react";
import clsx from "clsx";
import { api, type Task } from "@/lib/api";
import { PageHeader, Empty, Spinner, Badge, Avatar } from "@/components/ui";
import { fmtDate, statusColor, statusDot, deadlineUrgency, deadlineColor } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

const FILTERS = ["Все", "Новое", "Требует проверки", "Выполнено"] as const;
const STATUS_OPTIONS = ["Новое", "Требует проверки", "Выполнено"] as const;

type Filter = (typeof FILTERS)[number];
type Draft = Pick<Task, "assignment" | "responsible" | "department" | "deadline" | "status" | "max_username">;

export default function DashboardPage() {
  const [filter, setFilter] = useState<Filter>("Все");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [completionText, setCompletionText] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("tasks.manage");
  const canExecute = can("tasks.execute");
  const canUpload = can("upload");

  const { data: tasks, isLoading } = useQuery({ queryKey: ["tasks"], queryFn: () => api.listTasks() });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) => api.updateTask(id, patch),
    onSuccess: () => {
      setEditingId(null);
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const submitExecution = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.submitExecution(id, text),
    onSuccess: (_, vars) => {
      setCompletionText((prev) => ({ ...prev, [vars.id]: "" }));
      setNotice({ type: "ok", text: "Исполнение отправлено на проверку" });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const confirm = useMutation({
    mutationFn: (id: string) => api.confirmTask(id),
    onSuccess: () => {
      setNotice({ type: "ok", text: "Поручение закрыто, сформирована справка" });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const sendMax = useMutation({
    mutationFn: (id: string) => api.sendTaskToMax(id),
    onSuccess: () => {
      setNotice({ type: "ok", text: "Поручение отправлено в группу MAX" });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "MAX не принял сообщение";
      setNotice({ type: "error", text: message });
    },
  });

  const counts = {
    total: tasks?.length ?? 0,
    new: tasks?.filter((t) => t.status === "Новое").length ?? 0,
    review: tasks?.filter((t) => t.status === "Требует проверки").length ?? 0,
    done: tasks?.filter((t) => t.status === "Выполнено").length ?? 0,
    sent: tasks?.filter((t) => Boolean(t.notified_at || t.max_chat_id)).length ?? 0,
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tasks ?? []).filter((task) => {
      const statusMatch = filter === "Все" || task.status === filter;
      const queryMatch =
        !q ||
        [task.assignment, task.responsible, task.department, task.deadline, task.completion_text]
          .join(" ")
          .toLowerCase()
          .includes(q);
      return statusMatch && queryMatch;
    });
  }, [filter, query, tasks]);

  function startEdit(task: Task) {
    setEditingId(task.id);
    setExpandedId(null);
    setDraft({
      assignment: task.assignment,
      responsible: task.responsible,
      department: task.department,
      deadline: task.deadline,
      status: task.status,
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat icon={ListChecks} label="Всего" value={counts.total} tint="text-accent" bar="from-accent to-accent-2"
          active={filter === "Все"} onClick={() => setFilter("Все")} />
        <Stat icon={Clock} label="Новые" value={counts.new} tint="text-sky-500" bar="from-sky-400 to-sky-600"
          active={filter === "Новое"} onClick={() => setFilter("Новое")} />
        <Stat icon={AlertTriangle} label="На проверке" value={counts.review} tint="text-amber-500" bar="from-amber-400 to-amber-600"
          active={filter === "Требует проверки"} onClick={() => setFilter("Требует проверки")} />
        <Stat icon={CheckCircle2} label="Выполнено" value={counts.done} tint="text-emerald-500" bar="from-emerald-400 to-emerald-600"
          active={filter === "Выполнено"} onClick={() => setFilter("Выполнено")} />
        <Stat icon={MessageSquare} label="В MAX" value={counts.sent} tint="text-violet-500" bar="from-violet-400 to-violet-600" />
      </div>

      {can("ratings.view") && !!tasks?.length && <Ratings tasks={tasks} />}

      {notice && (
        <div
          className={clsx(
            "flex animate-fade-in items-center justify-between gap-3 rounded-xl2 border px-4 py-3 text-sm",
            notice.type === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
              : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
          )}
        >
          <span>{notice.text}</span>
          <button className="rounded-md p-1 hover:bg-surface/70" onClick={() => setNotice(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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
        <label className="relative block w-full lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input
            className="input pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по поручениям…"
          />
        </label>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-accent" />
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
          {filtered.map((task) => {
            const isEditing = editingId === task.id && draft;
            const isExpanded = expandedId === task.id;
            const sentToMax = Boolean(task.notified_at || task.max_chat_id);
            const urgency = deadlineUrgency(task.deadline, task.status);

            return (
              <div
                key={task.id}
                className="card overflow-hidden p-0 transition-shadow hover:shadow-card"
              >
                <div className="flex">
                  <div className={clsx("w-1.5 shrink-0", statusDot(task.status))} />
                  <div className="min-w-0 flex-1 p-4">
                    {isEditing ? (
                      <EditForm
                        draft={draft}
                        setField={setDraftField}
                        onSave={() => update.mutate({ id: task.id, patch: draft })}
                        onCancel={() => {
                          setEditingId(null);
                          setDraft(null);
                        }}
                        saving={update.isPending}
                      />
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-semibold leading-snug">
                            {task.assignment || "Без текста поручения"}
                          </p>
                          <Badge className={clsx("shrink-0 border-transparent", statusColor(task.status))}>
                            {task.status}
                          </Badge>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                          <span className="flex items-center gap-2">
                            <Avatar name={task.responsible} className="h-7 w-7" />
                            <span className="font-medium">{task.responsible || "Не назначен"}</span>
                          </span>
                          {task.department && (
                            <span className="text-muted">{task.department}</span>
                          )}
                          {task.deadline && (
                            <span className={clsx("flex items-center gap-1.5 font-medium", deadlineColor(urgency))}>
                              <CalendarClock className="h-4 w-4" />
                              {task.deadline}
                              {urgency === "overdue" && " · просрочено"}
                              {urgency === "soon" && " · скоро"}
                            </span>
                          )}
                          {sentToMax && (
                            <span className="flex items-center gap-1.5 text-violet-600 dark:text-violet-300">
                              <MessageSquare className="h-4 w-4" /> В MAX
                            </span>
                          )}
                          {task.confidence > 0 && (
                            <span className="text-xs text-muted">
                              уверенность {(task.confidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          {canManage && task.status !== "Выполнено" && (
                            <button
                              className="btn-primary"
                              disabled={confirm.isPending}
                              onClick={() => confirm.mutate(task.id)}
                              title="Закрыть поручение и сформировать справку"
                            >
                              <Check className="h-4 w-4" /> Подтвердить
                            </button>
                          )}
                          {canManage && (
                            <button
                              className="btn-soft"
                              disabled={sendMax.isPending}
                              onClick={() => sendMax.mutate(task.id)}
                              title="Отправить карточку в группу MAX с кнопкой подтверждения"
                            >
                              <MessageSquare className="h-4 w-4" />
                              {sentToMax ? "Отправить снова" : "В MAX"}
                            </button>
                          )}
                          {canExecute && (
                            <button
                              className="btn-ghost"
                              onClick={() => setExpandedId(isExpanded ? null : task.id)}
                            >
                              <FileCheck2 className="h-4 w-4" /> Исполнение
                              <ChevronDown
                                className={clsx("h-4 w-4 transition-transform", isExpanded && "rotate-180")}
                              />
                            </button>
                          )}
                          {canManage && (
                            <button className="btn-ghost" onClick={() => startEdit(task)}>
                              <Edit3 className="h-4 w-4" /> Изменить
                            </button>
                          )}
                          {can("protocols.view") && (
                            <Link
                              className="icon-btn ml-auto"
                              to={`/protocols/${task.protocol_id}`}
                              title="Открыть протокол"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {isExpanded && !isEditing && (
                  <div className="animate-fade-in border-t border-border/70 bg-elevated/40 p-4">
                    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
                      <div className="space-y-3 text-sm">
                        <Meta label="Создано" value={fmtDate(task.created_at)} />
                        <Meta label="Получатель MAX" value={task.max_username || "—"} />
                        <Meta label="Закрыто" value={task.closed_at ? fmtDate(task.closed_at) : "—"} />
                        {task.source_fragment && (
                          <div>
                            <div className="section-label">Фрагмент-источник</div>
                            <p className="mt-1 rounded-lg border border-border bg-surface p-2.5 text-sm italic text-muted">
                              «{task.source_fragment}»
                            </p>
                          </div>
                        )}
                        {task.reason_comment && (
                          <div>
                            <div className="section-label">Комментарий назначения</div>
                            <p className="mt-1 text-sm text-muted">{task.reason_comment}</p>
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="section-label">Что сделано</div>
                        <textarea
                          className="input min-h-28 resize-y"
                          value={completionText[task.id] ?? task.completion_text ?? ""}
                          onChange={(event) =>
                            setCompletionText((prev) => ({ ...prev, [task.id]: event.target.value }))
                          }
                          placeholder="Кратко опишите результат выполнения…"
                        />
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            className="btn-ghost"
                            disabled={submitExecution.isPending}
                            onClick={() =>
                              submitExecution.mutate({
                                id: task.id,
                                text: completionText[task.id] ?? task.completion_text ?? "",
                              })
                            }
                          >
                            <Send className="h-4 w-4" /> На проверку
                          </button>
                          {canManage && task.status !== "Выполнено" && (
                            <button
                              className="btn-primary"
                              disabled={confirm.isPending}
                              onClick={() => confirm.mutate(task.id)}
                            >
                              <Check className="h-4 w-4" /> Подтвердить
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EditForm({
  draft,
  setField,
  onSave,
  onCancel,
  saving,
}: {
  draft: Draft;
  setField: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-3">
      <textarea
        className="input min-h-20 resize-y font-medium"
        value={draft.assignment}
        onChange={(e) => setField("assignment", e.target.value)}
        placeholder="Текст поручения"
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Ответственный">
          <input className="input" value={draft.responsible} onChange={(e) => setField("responsible", e.target.value)} />
        </Field>
        <Field label="Направление">
          <input className="input" value={draft.department} onChange={(e) => setField("department", e.target.value)} />
        </Field>
        <Field label="Срок">
          <input className="input" value={draft.deadline} onChange={(e) => setField("deadline", e.target.value)} />
        </Field>
        <Field label="Статус">
          <select className="input" value={draft.status} onChange={(e) => setField("status", e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>
          <X className="h-4 w-4" /> Отмена
        </button>
        <button className="btn-primary" onClick={onSave} disabled={saving}>
          {saving ? <Spinner /> : <Save className="h-4 w-4" />} Сохранить
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="section-label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tint,
  bar,
  active,
  onClick,
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
  tint: string;
  bar: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={clsx(
        "card relative flex items-center gap-3 overflow-hidden p-4 text-left transition-all",
        onClick && "hover:-translate-y-0.5 hover:shadow-card",
        active && "ring-2 ring-accent/40",
      )}
    >
      <span className={clsx("absolute inset-y-0 left-0 w-1 bg-gradient-to-b", bar)} />
      <div className={clsx("icon-box h-11 w-11", tint)}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-extrabold tabular-nums">{value}</div>
        <div className="text-xs font-medium text-muted">{label}</div>
      </div>
    </Tag>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3">
      <div className="section-label">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

/** Рейтинг исполнителей: доля выполненных поручений по ответственным (для главы). */
function Ratings({ tasks }: { tasks: Task[] }) {
  const rows = useMemo(() => {
    const byPerson = new Map<string, { total: number; done: number }>();
    for (const t of tasks) {
      const name = (t.responsible || "").trim() || "Не назначен";
      const rec = byPerson.get(name) ?? { total: 0, done: 0 };
      rec.total += 1;
      if (t.status === "Выполнено") rec.done += 1;
      byPerson.set(name, rec);
    }
    return [...byPerson.entries()]
      .map(([name, r]) => ({ name, ...r, rate: r.total ? r.done / r.total : 0 }))
      .sort((a, b) => b.rate - a.rate || b.total - a.total)
      .slice(0, 6);
  }, [tasks]);

  if (rows.length === 0) return null;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Рейтинг исполнителей</h2>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3">
            <Avatar name={r.name === "Не назначен" ? "" : r.name} className="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{r.name}</span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
                  {r.done}/{r.total} · {(r.rate * 100).toFixed(0)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
                  style={{ width: `${Math.round(r.rate * 100)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
