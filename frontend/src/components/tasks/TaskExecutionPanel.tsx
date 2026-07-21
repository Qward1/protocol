import { Check, Send } from "lucide-react";
import { TASK_STATUS, type Task } from "@/lib/api";
import { fmtDate } from "@/lib/utils";
import type { TaskMutations } from "./useTaskMutations";

/** Раскрывающаяся панель контроля исполнения: метаданные + поле «что сделано». */
export function TaskExecutionPanel({
  task,
  canManage,
  completion,
  onCompletionChange,
  mutations,
}: {
  task: Task;
  canManage: boolean;
  completion: string;
  onCompletionChange: (text: string) => void;
  mutations: TaskMutations;
}) {
  const { submitExecution, confirm } = mutations;
  return (
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
            value={completion}
            onChange={(event) => onCompletionChange(event.target.value)}
            placeholder="Кратко опишите результат выполнения…"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button
              className="btn-ghost"
              disabled={submitExecution.isPending}
              onClick={() => submitExecution.mutate({ id: task.id, text: completion })}
            >
              <Send className="h-4 w-4" /> На проверку
            </button>
            {canManage && task.status !== TASK_STATUS.done && (
              <button className="btn-primary" disabled={confirm.isPending} onClick={() => confirm.mutate(task.id)}>
                <Check className="h-4 w-4" /> Подтвердить
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
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
