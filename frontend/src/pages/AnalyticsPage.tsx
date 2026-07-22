import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  ChevronDown,
  FileDown,
  Flame,
  ListChecks,
  RefreshCw,
  Trophy,
} from "lucide-react";
import clsx from "clsx";
import {
  api,
  downloadBlob,
  type DashboardFilters,
  type ExecutorRating,
  type ExportFmt,
  type MorningBrief,
  type Task,
} from "@/lib/api";
import { PageHeader, Empty, Skeleton, SectionTitle, Badge, Avatar, Spinner, useToast } from "@/components/ui";
import { deadlineColor, deadlineUrgency, fmtDate, fmtPoints, priorityMeta } from "@/lib/utils";

// Пресеты периода -> границы дат (YYYY-MM-DD, локальные). «all» — без ограничения.
type Period = "all" | "today" | "7d" | "30d";
const PERIOD_LABELS: Record<Period, string> = {
  all: "Всё время",
  today: "Сегодня",
  "7d": "7 дней",
  "30d": "30 дней",
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function periodBounds(period: Period): { period_from?: string; period_to?: string } {
  if (period === "all") return {};
  const to = new Date();
  const from = new Date();
  if (period === "7d") from.setDate(from.getDate() - 6);
  if (period === "30d") from.setDate(from.getDate() - 29);
  return { period_from: ymd(from), period_to: ymd(to) };
}

// Ключи фильтров-селектов (кроме периода), сопоставленные со списками filter_options.
const SELECT_FILTERS = [
  { key: "responsible", label: "Исполнитель", options: "responsibles" },
  { key: "location", label: "Локация", options: "locations" },
  { key: "object", label: "Объект", options: "objects" },
  { key: "theme", label: "Тема", options: "themes" },
  { key: "priority", label: "Приоритет", options: "priorities" },
  { key: "status", label: "Статус", options: "statuses" },
] as const;

export default function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const period = (searchParams.get("period") as Period | null) ?? "all";
  const selects = useMemo(() => {
    const out: Record<string, string> = {};
    for (const { key } of SELECT_FILTERS) {
      const v = searchParams.get(key);
      if (v) out[key] = v;
    }
    return out;
  }, [searchParams]);

  const filters: DashboardFilters = { ...periodBounds(period), ...selects };

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", period, selects],
    queryFn: () => api.getDashboardAnalytics(filters),
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  function resetFilters() {
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  const options = data?.filter_options;
  const hasActiveFilters = period !== "all" || Object.keys(selects).length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        title="Аналитика"
        subtitle="Исполнительская дисциплина по поручениям: показатели, рейтинг, подсветка и утренняя справка."
      />

      {/* Фильтры */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="section-label mb-1 block">Период</span>
            <select
              className="input w-auto"
              value={period}
              onChange={(e) => setParam("period", e.target.value === "all" ? "" : e.target.value)}
              aria-label="Период"
            >
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <option key={p} value={p}>
                  {PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          {SELECT_FILTERS.map(({ key, label, options: optKey }) => {
            const values = options?.[optKey] ?? [];
            return (
              <label key={key} className="block">
                <span className="section-label mb-1 block">{label}</span>
                <select
                  className="input w-auto max-w-48"
                  value={selects[key] ?? ""}
                  onChange={(e) => setParam(key, e.target.value)}
                  aria-label={label}
                  disabled={values.length === 0}
                >
                  <option value="">Все</option>
                  {values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}

          {hasActiveFilters && (
            <button className="btn-ghost" onClick={resetFilters}>
              Сбросить
            </button>
          )}
        </div>
      </div>

      {/* KPI */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-4">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Всего" value={data?.kpis.total ?? 0} dot="bg-accent" />
          <Kpi label="В работе" value={data?.kpis.in_work ?? 0} dot="bg-info" />
          <Kpi label="Исполнено" value={data?.kpis.done ?? 0} dot="bg-success" />
          <Kpi label="Закрыто" value={data?.kpis.closed ?? 0} dot="bg-muted" />
          <Kpi label="Просрочено" value={data?.kpis.overdue ?? 0} dot="bg-danger" />
        </div>
      )}

      {/* Рейтинг исполнителей (4.5.3) */}
      <RatingsBlock ratings={data?.ratings ?? []} loading={isLoading} />

      {/* Подсветка просроченных и приоритетных (4.5.4) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <HighlightList
          icon={AlertTriangle}
          tone="text-danger"
          title="Просроченные"
          tasks={data?.highlights.overdue ?? []}
          loading={isLoading}
          emptyHint="Просроченных поручений нет."
        />
        <HighlightList
          icon={Flame}
          tone="text-warning"
          title="Приоритетные на контроле"
          tasks={data?.highlights.priority ?? []}
          loading={isLoading}
          emptyHint="Приоритетных поручений на контроле нет."
        />
      </div>

      {/* Утренняя справка (4.5.2) */}
      <MorningBriefBlock />
    </div>
  );
}

function MorningBriefBlock() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: brief, isLoading } = useQuery({ queryKey: ["brief-latest"], queryFn: api.getLatestBrief });

  const generate = useMutation({
    mutationFn: () => api.generateBrief(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brief-latest"] });
      toast("Утренняя справка сформирована");
    },
    onError: (e: any) => toast(e?.message ?? "Не удалось сформировать справку", "error"),
  });

  const exportBrief = useMutation({
    mutationFn: ({ fmt }: { fmt: ExportFmt }) => api.exportObject("brief", brief!.id, fmt),
    onSuccess: (blob, { fmt }) => downloadBlob(blob, `Утренняя справка.${fmt}`),
    onError: (e: any) => toast(e?.message ?? "Не удалось выгрузить справку", "error"),
  });

  return (
    <div className="card p-4">
      <SectionTitle
        action={
          <div className="flex items-center gap-2">
            {brief && (
              <>
                <button
                  className="btn-soft h-9 py-1"
                  disabled={exportBrief.isPending}
                  onClick={() => exportBrief.mutate({ fmt: "docx" })}
                  title="Выгрузить в Word"
                >
                  <FileDown className="h-4 w-4" /> Word
                </button>
                <button
                  className="btn-soft h-9 py-1"
                  disabled={exportBrief.isPending}
                  onClick={() => exportBrief.mutate({ fmt: "pdf" })}
                  title="Выгрузить в PDF"
                >
                  <FileDown className="h-4 w-4" /> PDF
                </button>
              </>
            )}
            <button className="btn-primary h-9 py-1" disabled={generate.isPending} onClick={() => generate.mutate()}>
              {generate.isPending ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Сформировать сейчас
            </button>
          </div>
        }
      >
        Утренняя справка
      </SectionTitle>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !brief ? (
        <Empty
          icon={CalendarClock}
          title="Справка ещё не сформирована"
          hint="Она формируется автоматически по расписанию. Можно сформировать сейчас — по текущим данным реестра."
        />
      ) : (
        <BriefContent brief={brief} />
      )}
    </div>
  );
}

function BriefContent({ brief }: { brief: MorningBrief }) {
  const c = brief.changes;
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        <span>
          Срез на <span className="font-medium text-fg">{fmtDate(brief.as_of)}</span>
        </span>
        <span aria-hidden>·</span>
        <span>сформирована {fmtDate(brief.generated_at)}</span>
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MiniStat label="Всего" value={brief.kpis.total} />
        <MiniStat label="В работе" value={brief.kpis.in_work} />
        <MiniStat label="Исполнено" value={brief.kpis.done} />
        <MiniStat label="Закрыто" value={brief.kpis.closed ?? 0} />
        <MiniStat label="Просрочено" value={brief.kpis.overdue} tone="text-danger" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BriefList title="Просроченные" tasks={brief.overdue} emptyHint="Просроченных нет." />
        <BriefList
          title="Приоритетные с приближающимся сроком"
          tasks={brief.priority_soon}
          emptyHint="Нет приоритетных с близким сроком."
          showPriority
        />
      </div>

      <div className="rounded-lg border border-border bg-elevated/40 p-3 text-sm">
        <span className="section-label mb-1.5 block">Изменения с прошлой справки</span>
        {c.first ? (
          <p className="text-muted">Это первая справка — сравнивать не с чем.</p>
        ) : (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
            <span>Новых: <span className="font-semibold text-fg tabular-nums">{c.new_tasks}</span></span>
            <span>Исполнено: <span className="font-semibold text-success tabular-nums">{c.newly_done}</span></span>
            <span>Стало просрочено: <span className="font-semibold text-danger tabular-nums">{c.newly_overdue}</span></span>
          </p>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className={clsx("text-xl font-semibold tabular-nums leading-none", tone)}>{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}

function BriefList({
  title,
  tasks,
  emptyHint,
  showPriority,
}: {
  title: string;
  tasks: MorningBrief["overdue"];
  emptyHint: string;
  showPriority?: boolean;
}) {
  return (
    <div>
      <div className="section-label mb-1.5 flex items-center gap-2">
        {title}
        {tasks.length > 0 && <span className="tabular-nums text-muted">· {tasks.length}</span>}
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted">{emptyHint}</p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((t) => {
            const prio = priorityMeta(t.priority);
            return (
              <li key={t.id}>
                <Link
                  to={`/?focus=${t.id}`}
                  className="block rounded-md border border-border bg-surface px-3 py-2 text-sm transition-colors hover:border-accent/50 hover:bg-elevated"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 font-medium">{t.assignment || "Без текста"}</span>
                    {showPriority && prio.elevated && (
                      <Badge className={clsx("shrink-0 border-transparent", prio.tint)}>{t.priority}</Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    <span className="text-fg">{t.responsible || "Не назначен"}</span>
                    {t.deadline && <span>{t.deadline}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RatingsBlock({ ratings, loading }: { ratings: ExecutorRating[]; loading: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="card p-4">
      <SectionTitle count={ratings.length}>
        <span className="inline-flex items-center gap-2">
          <Trophy className="h-4 w-4 text-accent" aria-hidden /> Рейтинг исполнителей
        </span>
      </SectionTitle>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : ratings.length === 0 ? (
        <Empty icon={Trophy} title="Пока нет данных для рейтинга" hint="Появятся, когда будут поручения по исполнителям." />
      ) : (
        <ul className="space-y-2">
          {ratings.map((r, i) => {
            const open = expanded === r.responsible;
            return (
              <li key={r.responsible} className="rounded-lg border border-border bg-surface">
                <button
                  className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-elevated"
                  onClick={() => setExpanded(open ? null : r.responsible)}
                  aria-expanded={open}
                >
                  <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-muted">{i + 1}</span>
                  <Avatar name={r.responsible === "Не назначен" ? "" : r.responsible} className="h-8 w-8" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.responsible}</div>
                    <div className="text-xs text-muted tabular-nums">{r.total_tasks} поручений на контроле</div>
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 text-base font-semibold tabular-nums",
                      r.score > 0 ? "text-success" : r.score < 0 ? "text-danger" : "text-muted",
                    )}
                  >
                    {fmtPoints(r.score)}
                  </span>
                  <ChevronDown className={clsx("h-4 w-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
                </button>
                {open && (
                  <div className="border-t border-border p-3">
                    {r.breakdown.length === 0 ? (
                      <p className="text-sm text-muted">По действующим правилам баллы не начислены.</p>
                    ) : (
                      <ul className="space-y-2.5">
                        {r.breakdown.map((b) => (
                          <li key={b.condition}>
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span className="text-fg">{b.label}</span>
                              <span className="tabular-nums text-muted">
                                {b.count} × {fmtPoints(b.points_each)} ={" "}
                                <span className={clsx("font-semibold", b.points >= 0 ? "text-success" : "text-danger")}>
                                  {fmtPoints(b.points)}
                                </span>
                              </span>
                            </div>
                            {/* Ссылки на конкретные поручения, за которые начислены баллы. */}
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {b.task_ids.map((id, idx) => (
                                <Link
                                  key={id}
                                  to={`/?focus=${id}`}
                                  className="chip border-border text-xs text-muted hover:border-accent/50 hover:text-accent"
                                  title="Открыть поручение"
                                >
                                  №{idx + 1}
                                </Link>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Kpi({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-muted">
        <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", dot)} aria-hidden />
        {label}
      </div>
    </div>
  );
}

function HighlightList({
  icon: Icon,
  tone,
  title,
  tasks,
  loading,
  emptyHint,
}: {
  icon: typeof AlertTriangle;
  tone: string;
  title: string;
  tasks: Task[];
  loading: boolean;
  emptyHint: string;
}) {
  return (
    <div className="card p-4">
      <SectionTitle>
        <span className="inline-flex items-center gap-2">
          <Icon className={clsx("h-4 w-4", tone)} aria-hidden />
          {title}
          {tasks.length > 0 && <span className="text-muted tabular-nums">· {tasks.length}</span>}
        </span>
      </SectionTitle>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <Empty icon={ListChecks} title={emptyHint} />
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <HighlightRow key={t.id} task={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function HighlightRow({ task }: { task: Task }) {
  const urgency = deadlineUrgency(task.deadline, task.status, task.deadline_at);
  const prio = priorityMeta(task.priority);
  return (
    <li>
      <Link
        to={`/?focus=${task.id}`}
        className="block rounded-lg border border-border bg-surface p-3 transition-colors hover:border-accent/50 hover:bg-elevated"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-sm font-medium">{task.assignment || "Без текста поручения"}</span>
          {prio.elevated && <Badge className={clsx("shrink-0 border-transparent", prio.tint)}>{task.priority}</Badge>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="font-medium text-fg">{task.responsible || "Не назначен"}</span>
          {task.deadline && <span className={clsx("font-medium", deadlineColor(urgency))}>{task.deadline}</span>}
        </div>
      </Link>
    </li>
  );
}
