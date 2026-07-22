import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Edit3, FileClock, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api, TASK_PRIORITY, type Task } from "@/lib/api";
import { Avatar, Badge, ConfirmDialog, Spinner, useToast } from "@/components/ui";
import { statusColor } from "@/lib/utils";
import { TaskEditForm } from "./TaskEditForm";
import type { Draft } from "./types";

/** Черновики поручений на странице протокола: правка, удаление и подтверждение.
 *  До подтверждения поручения не попадают в реестр (см. confirm-tasks на бэкенде). */
export function DraftTasksPanel({ protocolId, drafts }: { protocolId: string; drafts: Task[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["protocol", protocolId] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };
  const fail = (fallback: string) => (error: unknown) =>
    toast(error instanceof Error ? error.message : fallback, "error");

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) => api.updateTask(id, patch),
    onSuccess: () => {
      setEditingId(null);
      setDraft(null);
      toast("Изменения сохранены");
      invalidate();
    },
    onError: fail("Не удалось сохранить"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: () => {
      setRemoveId(null);
      toast("Поручение удалено");
      invalidate();
    },
    onError: fail("Не удалось удалить поручение"),
  });

  const confirmAll = useMutation({
    mutationFn: () => api.confirmProtocolTasks(protocolId),
    onSuccess: () => {
      toast("Поручения добавлены в реестр");
      invalidate();
    },
    onError: fail("Не удалось подтвердить поручения"),
  });

  function startEdit(t: Task) {
    setEditingId(t.id);
    setDraft({
      assignment: t.assignment,
      responsible: t.responsible,
      department: t.department,
      deadline: t.deadline,
      status: t.status,
      priority: t.priority || TASK_PRIORITY.normal,
      location: t.location,
      object: t.object,
      theme: t.theme,
      max_username: t.max_username,
    });
  }

  function setField<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  return (
    <div className="mb-6 rounded-xl2 border border-warning/40 bg-warning/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <FileClock className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
          <div>
            <div className="font-semibold">Черновики поручений · {drafts.length}</div>
            <div className="text-sm text-muted">
              Проверьте и при необходимости отредактируйте. В реестр поручения попадут только после подтверждения.
            </div>
          </div>
        </div>
        <button className="btn-primary" disabled={confirmAll.isPending} onClick={() => confirmAll.mutate()}>
          {confirmAll.isPending ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />} Подтвердить поручения
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {drafts.map((t) => (
          <div key={t.id} className="rounded-xl2 border border-border bg-surface p-4">
            {editingId === t.id && draft ? (
              <TaskEditForm
                draft={draft}
                setField={setField}
                onSave={() => update.mutate({ id: t.id, patch: draft })}
                onCancel={() => {
                  setEditingId(null);
                  setDraft(null);
                }}
                saving={update.isPending}
              />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold leading-snug">{t.assignment || "Без текста поручения"}</p>
                  <Badge className={clsx("border-transparent", statusColor(t.status))}>{t.status}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Avatar name={t.responsible} className="h-7 w-7" />
                    <span className="font-medium">{t.responsible || "Не назначен"}</span>
                  </span>
                  {t.department && <span className="text-muted">{t.department}</span>}
                  {t.deadline && <span className="text-muted">{t.deadline}</span>}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="btn-ghost" onClick={() => startEdit(t)}>
                    <Edit3 className="h-4 w-4" /> Изменить
                  </button>
                  <button className="btn-ghost text-danger" onClick={() => setRemoveId(t.id)}>
                    <Trash2 className="h-4 w-4" /> Удалить
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {removeId && (
        <ConfirmDialog
          title="Удалить поручение?"
          description="Поручение будет удалено безвозвратно."
          confirmLabel="Удалить"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(removeId)}
          onClose={() => setRemoveId(null)}
        />
      )}
    </div>
  );
}
