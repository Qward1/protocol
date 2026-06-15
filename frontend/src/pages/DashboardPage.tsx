import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ListChecks, Clock, AlertTriangle, CheckCircle2, Upload, Check } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { Card, PageHeader, Empty, Spinner, Badge } from "@/components/ui";
import { statusColor } from "@/lib/utils";

const FILTERS = ["Все", "Новое", "Требует проверки", "Выполнено"] as const;

export default function DashboardPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Все");
  const qc = useQueryClient();
  const { data: tasks, isLoading } = useQuery({ queryKey: ["tasks"], queryFn: () => api.listTasks() });
  const confirm = useMutation({
    mutationFn: (id: string) => api.confirmTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const counts = {
    total: tasks?.length ?? 0,
    new: tasks?.filter((t) => t.status === "Новое").length ?? 0,
    review: tasks?.filter((t) => t.status === "Требует проверки").length ?? 0,
    done: tasks?.filter((t) => t.status === "Выполнено").length ?? 0,
  };

  const filtered = (tasks ?? []).filter((t) => filter === "Все" || t.status === filter);

  return (
    <div>
      <PageHeader
        title="Контроль исполнения"
        subtitle="Поручения из протоколов: статусы, сроки, ответственные."
        actions={
          <Link to="/upload" className="btn-primary">
            <Upload className="h-4 w-4" /> Новая запись
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat icon={ListChecks} label="Всего" value={counts.total} tint="text-accent" />
        <Stat icon={Clock} label="Новые" value={counts.new} tint="text-sky-500" />
        <Stat icon={AlertTriangle} label="Требуют проверки" value={counts.review} tint="text-amber-500" />
        <Stat icon={CheckCircle2} label="Выполнено" value={counts.done} tint="text-emerald-500" />
      </div>

      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              "rounded-full px-3 py-1 text-sm transition-colors",
              filter === f ? "bg-accent text-accent-fg" : "border border-border hover:bg-elevated",
            )}
          >
            {f}
          </button>
        ))}
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
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-elevated text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Поручение</th>
                <th className="px-4 py-3">Ответственный</th>
                <th className="px-4 py-3">Срок</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b border-border/50 last:border-0 hover:bg-elevated/50">
                  <td className="max-w-md px-4 py-3">{t.assignment}</td>
                  <td className="px-4 py-3">{t.responsible || "—"}</td>
                  <td className="px-4 py-3 text-muted">{t.deadline || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge className={clsx("border-transparent", statusColor(t.status))}>{t.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {t.status !== "Выполнено" && (
                      <button
                        className="btn-ghost px-2 py-1 text-xs"
                        disabled={confirm.isPending}
                        onClick={() => confirm.mutate(t.id)}
                        title="Подтвердить выполнение (руководитель)"
                      >
                        <Check className="h-3.5 w-3.5" /> Подтвердить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
  tint: string;
}) {
  return (
    <Card className="flex items-center gap-3">
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
