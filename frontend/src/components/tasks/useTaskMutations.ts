import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Task } from "@/lib/api";
import { useToast } from "@/components/ui";

/** Колбэки для состояния страницы (закрыть форму правки, очистить поле исполнения). */
interface Callbacks {
  onUpdated?: () => void;
  onExecutionSubmitted?: (taskId: string) => void;
}

/** Мутации поручения с единой обработкой (invalidate ["tasks"] + toast) в одном
 *  месте — раньше четыре мутации дублировали onSuccess/onError-паттерн. */
export function useTaskMutations({ onUpdated, onExecutionSubmitted }: Callbacks = {}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks"] });
  const fail = (fallback: string) => (error: unknown) =>
    toast(error instanceof Error ? error.message : fallback, "error");

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) => api.updateTask(id, patch),
    onSuccess: () => {
      onUpdated?.();
      toast("Изменения сохранены");
      invalidate();
    },
    onError: fail("Не удалось сохранить"),
  });

  const submitExecution = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.submitExecution(id, text),
    onSuccess: (_, vars) => {
      onExecutionSubmitted?.(vars.id);
      toast("Исполнение отправлено на проверку");
      invalidate();
    },
    onError: fail("Не удалось отправить исполнение"),
  });

  const confirm = useMutation({
    mutationFn: (id: string) => api.confirmTask(id),
    onSuccess: () => {
      toast("Поручение закрыто, сформирована справка");
      invalidate();
    },
    onError: fail("Не удалось закрыть поручение"),
  });

  const sendMax = useMutation({
    mutationFn: (id: string) => api.sendTaskToMax(id),
    onSuccess: () => {
      toast("Поручение отправлено в группу MAX");
      invalidate();
    },
    onError: fail("MAX не принял сообщение"),
  });

  return { update, submitExecution, confirm, sendMax };
}

export type TaskMutations = ReturnType<typeof useTaskMutations>;
