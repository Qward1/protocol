import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api, type RatingRule } from "@/lib/api";
import { PageHeader, Empty, Skeleton, SectionTitle, Spinner, ConfirmDialog, useToast } from "@/components/ui";

// Короткая подсказка «как считается» для каждого условия (детерминированно из полей поручения).
const CONDITION_HINTS: Record<string, string> = {
  done_on_time: "Статус «Выполнено» и закрыто не позже срока.",
  done_late: "Статус «Выполнено», но закрыто после срока.",
  overdue_open: "Не выполнено, а срок уже прошёл.",
  done_priority: "Выполнено поручение с приоритетом «Высокий»/«Критический».",
};

export default function RatingRulesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["rating-rules"], queryFn: api.listRatingRules });
  const [confirmDel, setConfirmDel] = useState<RatingRule | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rating-rules"] });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { points?: number; enabled?: boolean } }) =>
      api.updateRatingRule(id, patch),
    onSuccess: () => {
      invalidate();
      toast("Правило обновлено — рейтинг пересчитан");
    },
    onError: (e: any) => toast(e?.message ?? "Не удалось обновить правило", "error"),
  });
  const create = useMutation({
    mutationFn: (condition: string) => api.createRatingRule({ condition, points: 0 }),
    onSuccess: invalidate,
    onError: (e: any) => toast(e?.message ?? "Не удалось добавить правило", "error"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteRatingRule(id),
    onSuccess: invalidate,
    onError: (e: any) => toast(e?.message ?? "Не удалось удалить правило", "error"),
  });

  const rules = data?.rules ?? [];
  const used = new Set(rules.map((r) => r.condition));
  const missing = (data?.conditions ?? []).filter((c) => !used.has(c.key));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={SlidersHorizontal}
        title="Правила рейтинга"
        subtitle="Начисление и списание баллов по поручениям исполнителей. Меняйте баллы и включённость — рейтинг на дашборде пересчитывается автоматически."
      />

      <div className="card p-4">
        <SectionTitle>Действующие правила</SectionTitle>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          <Empty icon={SlidersHorizontal} title="Правил пока нет" hint="Добавьте условие ниже." />
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                saving={update.isPending}
                onSave={(points) => update.mutate({ id: rule.id, patch: { points } })}
                onToggle={() => update.mutate({ id: rule.id, patch: { enabled: !rule.enabled } })}
                onDelete={() => setConfirmDel(rule)}
              />
            ))}
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div className="card p-4">
          <SectionTitle>Добавить условие</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {missing.map((c) => (
              <button
                key={c.key}
                className="btn-soft"
                disabled={create.isPending}
                onClick={() => create.mutate(c.key)}
              >
                <Plus className="h-4 w-4" /> {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {confirmDel && (
        <ConfirmDialog
          title="Удалить правило?"
          description={
            <>
              Правило <span className="font-medium text-fg">«{confirmDel.label}»</span> перестанет влиять на рейтинг.
              Его можно будет добавить снова.
            </>
          }
          confirmLabel="Удалить"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDel.id, { onSuccess: () => setConfirmDel(null) })}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}

function RuleRow({
  rule,
  saving,
  onSave,
  onToggle,
  onDelete,
}: {
  rule: RatingRule;
  saving: boolean;
  onSave: (points: number) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [points, setPoints] = useState(String(rule.points));
  const parsed = Number(points);
  const changed = points.trim() !== "" && Number.isFinite(parsed) && parsed !== rule.points;

  return (
    <div className={clsx("card flex flex-wrap items-center gap-3 p-4", !rule.enabled && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{rule.label}</div>
        <div className="text-xs text-muted">{CONDITION_HINTS[rule.condition] ?? "Условие над поручениями исполнителя."}</div>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted">
        Баллы
        <input
          type="number"
          step="1"
          className="input h-9 w-24 py-1 text-right tabular-nums"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          aria-label={`Баллы за условие «${rule.label}»`}
        />
      </label>

      <button
        className="btn-primary h-9 py-1"
        disabled={!changed || saving}
        onClick={() => onSave(parsed)}
        title="Сохранить баллы"
      >
        {saving ? <Spinner /> : <Save className="h-4 w-4" />} Сохранить
      </button>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={rule.enabled} onChange={onToggle} aria-label={`Правило «${rule.label}» активно`} />
        Активно
      </label>

      <button
        className="icon-btn hover:!border-danger/40 hover:!text-danger"
        title="Удалить правило"
        aria-label={`Удалить правило «${rule.label}»`}
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
