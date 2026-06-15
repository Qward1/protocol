import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
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
  Users,
  X,
} from "lucide-react";
import clsx from "clsx";
import { api, type Task } from "@/lib/api";
import { Card, PageHeader, Empty, Spinner, Badge } from "@/components/ui";
import { fmtDate, statusColor } from "@/lib/utils";

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
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const confirm = useMutation({
    mutationFn: (id: string) => api.confirmTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
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

  function saveEdit(task: Task) {
    if (!draft) return;
    update.mutate({ id: task.id, patch: draft });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Реестр поручений"
        subtitle="Задачи хранятся в приложении: ответственные, сроки, статусы и подтверждение исполнения."
        actions={
          <Link to="/upload" className="btn-primary">
            <Upload className="h-4 w-4" /> Новая запись
          </Link>
        }
      />

      <section className="rounded-xl2 border border-border bg-surface p-5 shadow-soft">
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-muted">
              <ListChecks className="h-4 w-4 text-accent" />
              Локальный контроль исполнения
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Рабочий журнал поручений без внешних таблиц</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Отправляйте поручения в группу MAX, фиксируйте исполнение и закрывайте задачи из одного экрана.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MiniMetric icon={Users} label="Ответственные" value={uniqueCount(tasks ?? [], "responsible")} tone="sky" />
            <MiniMetric icon={MessageSquare} label="В MAX" value={counts.sent} tone="emerald" />
            <MiniMetric icon={CalendarDays} label="Со сроком" value={(tasks ?? []).filter((t) => t.deadline).length} tone="amber" />
            <MiniMetric icon={CheckCircle2} label="Закрыто" value={counts.done} tone="rose" />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat icon={ListChecks} label="Всего" value={counts.total} tint="text-accent" accent="border-l-accent" />
        <Stat icon={Clock} label="Новые" value={counts.new} tint="text-sky-500" accent="border-l-sky-500" />
        <Stat icon={AlertTriangle} label="На проверке" value={counts.review} tint="text-amber-500" accent="border-l-amber-500" />
        <Stat icon={CheckCircle2} label="Выполнено" value={counts.done} tint="text-emerald-500" accent="border-l-emerald-500" />
      </div>

      {notice && (
        <div
          className={clsx(
            "flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
            notice.type === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
              : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
          )}
        >
          <span>{notice.text}</span>
          <button className="rounded-md px-2 py-1 hover:bg-surface/70" onClick={() => setNotice(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "rounded-lg border px-3 py-2 text-sm transition-colors",
                filter === f ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:bg-elevated",
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
            placeholder="Поиск по поручениям"
          />
        </label>
      </div>

      {isLoading ? (
        <Spinner className="h-6 w-6" />
      ) : filtered.length === 0 ? (
        <Empty
          title="Поручений нет"
          hint="Загрузите запись встречи и сформируйте протокол — поручения появятся здесь."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-border bg-elevated text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Поручение</th>
                  <th className="px-4 py-3">Ответственный</th>
                  <th className="px-4 py-3">Направление</th>
                  <th className="px-4 py-3">Срок</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">MAX</th>
                  <th className="px-4 py-3">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => {
                  const isEditing = editingId === task.id && draft;
                  const isExpanded = expandedId === task.id;
                  return (
                    <Fragment key={task.id}>
                      <tr className="border-b border-border/50 hover:bg-elevated/50">
                        <td className="w-[34%] px-4 py-3 align-top">
                          {isEditing ? (
                            <textarea
                              className="input min-h-20 resize-y"
                              value={draft.assignment}
                              onChange={(event) => setDraftField("assignment", event.target.value)}
                            />
                          ) : (
                            <button
                              className="line-clamp-3 text-left font-medium hover:text-accent"
                              onClick={() => setExpandedId(isExpanded ? null : task.id)}
                            >
                              {task.assignment || "Без текста поручения"}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {isEditing ? (
                            <input
                              className="input"
                              value={draft.responsible}
                              onChange={(event) => setDraftField("responsible", event.target.value)}
                            />
                          ) : (
                            task.responsible || "—"
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {isEditing ? (
                            <input
                              className="input"
                              value={draft.department}
                              onChange={(event) => setDraftField("department", event.target.value)}
                            />
                          ) : (
                            task.department || "—"
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-muted">
                          {isEditing ? (
                            <input
                              className="input"
                              value={draft.deadline}
                              onChange={(event) => setDraftField("deadline", event.target.value)}
                            />
                          ) : (
                            task.deadline || "—"
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {isEditing ? (
                            <select
                              className="input"
                              value={draft.status}
                              onChange={(event) => setDraftField("status", event.target.value)}
                            >
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Badge className={clsx("border-transparent", statusColor(task.status))}>
                              {task.status}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {task.notified_at || task.max_chat_id ? (
                            <div className="space-y-1">
                              <Badge className="border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                                Отправлено
                              </Badge>
                              {task.notified_at && <div className="text-xs text-muted">{fmtDate(task.notified_at)}</div>}
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-wrap gap-2">
                            {isEditing ? (
                              <>
                                <button className="btn-primary px-2 py-1" onClick={() => saveEdit(task)} title="Сохранить">
                                  <Save className="h-4 w-4" />
                                </button>
                                <button
                                  className="btn-ghost px-2 py-1"
                                  onClick={() => {
                                    setEditingId(null);
                                    setDraft(null);
                                  }}
                                  title="Отменить"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button className="btn-ghost px-2 py-1" onClick={() => startEdit(task)} title="Редактировать">
                                  <Edit3 className="h-4 w-4" />
                                </button>
                                <button
                                  className="btn-ghost px-2 py-1"
                                  onClick={() => setExpandedId(isExpanded ? null : task.id)}
                                  title="Исполнение"
                                >
                                  <FileCheck2 className="h-4 w-4" />
                                </button>
                                <button
                                  className="btn-ghost px-2 py-1"
                                  disabled={sendMax.isPending}
                                  onClick={() => sendMax.mutate(task.id)}
                                  title="Отправить в группу MAX"
                                >
                                  <MessageSquare className="h-4 w-4" />
                                </button>
                                <Link className="btn-ghost px-2 py-1" to={`/protocols/${task.protocol_id}`} title="Открыть протокол">
                                  <ExternalLink className="h-4 w-4" />
                                </Link>
                                {task.status !== "Выполнено" && (
                                  <button
                                    className="btn-ghost px-2 py-1"
                                    disabled={confirm.isPending}
                                    onClick={() => confirm.mutate(task.id)}
                                    title="Подтвердить выполнение"
                                  >
                                    <Check className="h-4 w-4" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-border/50 bg-elevated/40">
                          <td colSpan={7} className="px-4 py-4">
                            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                              <div className="space-y-3">
                                <Meta label="Создано" value={fmtDate(task.created_at)} />
                                <Meta label="MAX" value={task.max_username || "—"} />
                                <Meta label="Чат MAX" value={task.max_chat_id || "—"} />
                                <Meta label="Закрыто" value={task.closed_at ? fmtDate(task.closed_at) : "—"} />
                                {task.source_fragment && (
                                  <div>
                                    <div className="text-xs font-medium uppercase text-muted">Фрагмент-источник</div>
                                    <p className="mt-1 text-sm italic text-muted">«{task.source_fragment}»</p>
                                  </div>
                                )}
                                {task.reason_comment && (
                                  <div>
                                    <div className="text-xs font-medium uppercase text-muted">Комментарий назначения</div>
                                    <p className="mt-1 text-sm text-muted">{task.reason_comment}</p>
                                  </div>
                                )}
                              </div>
                              <div className="space-y-2">
                                <div className="text-xs font-medium uppercase text-muted">Что сделано</div>
                                <textarea
                                  className="input min-h-28 resize-y"
                                  value={completionText[task.id] ?? task.completion_text ?? ""}
                                  onChange={(event) =>
                                    setCompletionText((prev) => ({ ...prev, [task.id]: event.target.value }))
                                  }
                                  placeholder="Кратко опишите результат выполнения"
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    className="btn-primary"
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
                                  {task.status !== "Выполнено" && (
                                    <button
                                      className="btn-ghost"
                                      disabled={confirm.isPending}
                                      onClick={() => confirm.mutate(task.id)}
                                    >
                                      <Check className="h-4 w-4" /> Подтвердить
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tint,
  accent,
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
  tint: string;
  accent: string;
}) {
  return (
    <Card className={clsx("flex items-center gap-3 border-l-4", accent)}>
      <div className={clsx("grid h-11 w-11 place-items-center rounded-lg bg-elevated", tint)}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-xs text-muted">{label}</div>
      </div>
    </Card>
  );
}

function MiniMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
  tone: "sky" | "emerald" | "amber" | "rose";
}) {
  const tones = {
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
    rose: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  };
  return (
    <div className="rounded-lg border border-border bg-elevated p-3">
      <div className={clsx("mb-2 grid h-8 w-8 place-items-center rounded-md", tones[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 text-sm">
      <div className="text-xs font-medium uppercase text-muted">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function uniqueCount(tasks: Task[], field: keyof Pick<Task, "responsible">) {
  return new Set(tasks.map((task) => String(task[field] || "").trim()).filter(Boolean)).size;
}
