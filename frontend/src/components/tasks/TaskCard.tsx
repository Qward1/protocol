import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Ban,
  CalendarClock,
  Check,
  ChevronDown,
  Edit3,
  ExternalLink,
  FileCheck2,
  MessageSquare,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import { TERMINAL_STATUSES, type Task } from "@/lib/api";
import { Avatar, Badge, ConfirmDialog } from "@/components/ui";
import { statusColor, statusDot, deadlineColor, deadlineUrgency, priorityMeta } from "@/lib/utils";
import { TaskEditForm } from "./TaskEditForm";
import { TaskExecutionPanel } from "./TaskExecutionPanel";
import type { TaskMutations } from "./useTaskMutations";
import type { Draft } from "./types";

export interface TaskCardProps {
  task: Task;
  can: (...perms: string[]) => boolean;
  editing: boolean;
  expanded: boolean;
  draft: Draft | null;
  setDraftField: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
  completion: string;
  onCompletionChange: (text: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onToggleExpand: () => void;
  mutations: TaskMutations;
}

/** Карточка поручения в реестре: просмотр / правка / раскрываемый контроль исполнения. */
export function TaskCard({
  task,
  can,
  editing,
  expanded,
  draft,
  setDraftField,
  completion,
  onCompletionChange,
  onStartEdit,
  onCancelEdit,
  onToggleExpand,
  mutations,
}: TaskCardProps) {
  const canManage = can("tasks.manage");
  const canExecute = can("tasks.execute");
  const sentToMax = Boolean(task.notified_at || task.max_chat_id);
  const urgency = deadlineUrgency(task.deadline, task.status, task.deadline_at);
  const overdue = urgency === "overdue";
  const prio = priorityMeta(task.priority);
  const terminal = TERMINAL_STATUSES.includes(task.status);
  const { update, confirm, sendMax, close, remove } = mutations;
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    // Подсветка (4.5.4): просроченные — красная рамка/полоса; высокий/критический
    // приоритет — тёплая рамка (уступает просрочке).
    <div
      className={clsx(
        "card overflow-hidden p-0 transition-colors hover:border-accent/40",
        overdue && "ring-1 ring-danger/50",
        !overdue && prio.elevated && "ring-1 ring-warning/45",
      )}
    >
      <div className="flex">
        <div className={clsx("w-1.5 shrink-0", overdue ? "bg-danger" : statusDot(task.status))} />
        <div className="min-w-0 flex-1 p-4">
          {editing && draft ? (
            <TaskEditForm
              draft={draft}
              setField={setDraftField}
              onSave={() => update.mutate({ id: task.id, patch: draft })}
              onCancel={onCancelEdit}
              saving={update.isPending}
            />
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold leading-snug">{task.assignment || "Без текста поручения"}</p>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {prio.elevated && <Badge className={clsx("border-transparent", prio.tint)}>{task.priority}</Badge>}
                  <Badge className={clsx("border-transparent", statusColor(task.status))}>{task.status}</Badge>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="flex items-center gap-2">
                  <Avatar name={task.responsible} className="h-7 w-7" />
                  <span className="font-medium">{task.responsible || "Не назначен"}</span>
                </span>
                {task.department && <span className="text-muted">{task.department}</span>}
                {task.deadline && (
                  <span className={clsx("flex items-center gap-1.5 font-medium", deadlineColor(urgency))}>
                    <CalendarClock className="h-4 w-4" />
                    {task.deadline}
                    {urgency === "overdue" && " · просрочено"}
                    {urgency === "soon" && " · скоро"}
                  </span>
                )}
                {sentToMax && (
                  <span className="flex items-center gap-1.5 text-accent">
                    <MessageSquare className="h-4 w-4" aria-hidden /> В MAX
                  </span>
                )}
                {task.confidence > 0 && (
                  <span className="text-xs tabular-nums text-muted">
                    уверенность {(task.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {canManage && !terminal && (
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
                  <button className="btn-ghost" onClick={onToggleExpand}>
                    <FileCheck2 className="h-4 w-4" /> Исполнение
                    <ChevronDown className={clsx("h-4 w-4 transition-transform", expanded && "rotate-180")} />
                  </button>
                )}
                {canManage && (
                  <button className="btn-ghost" onClick={onStartEdit}>
                    <Edit3 className="h-4 w-4" /> Изменить
                  </button>
                )}
                {canManage && !terminal && (
                  <button
                    className="btn-ghost text-muted"
                    disabled={close.isPending}
                    onClick={() => setConfirmClose(true)}
                    title="Закрыть без исполнения"
                  >
                    <Ban className="h-4 w-4" /> Закрыть
                  </button>
                )}
                {canManage && (
                  <button
                    className="btn-ghost text-danger"
                    disabled={remove.isPending}
                    onClick={() => setConfirmRemove(true)}
                    title="Удалить поручение"
                  >
                    <Trash2 className="h-4 w-4" /> Удалить
                  </button>
                )}
                {can("protocols.view") && (
                  <Link
                    className="icon-btn ml-auto"
                    to={`/protocols/${task.protocol_id}`}
                    title="Открыть протокол"
                    aria-label="Открыть протокол"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {confirmClose && (
        <ConfirmDialog
          title="Закрыть без исполнения?"
          description="Поручение получит статус «Закрыто» и не будет считаться выполненным. Справка не формируется."
          confirmLabel="Закрыть"
          busy={close.isPending}
          onConfirm={() => close.mutate(task.id, { onSuccess: () => setConfirmClose(false) })}
          onClose={() => setConfirmClose(false)}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Удалить поручение?"
          description="Поручение будет удалено безвозвратно."
          confirmLabel="Удалить"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(task.id, { onSuccess: () => setConfirmRemove(false) })}
          onClose={() => setConfirmRemove(false)}
        />
      )}

      {expanded && !editing && (
        <TaskExecutionPanel
          task={task}
          canManage={canManage}
          completion={completion}
          onCompletionChange={onCompletionChange}
          mutations={mutations}
        />
      )}
    </div>
  );
}
