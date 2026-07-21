import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, type Task } from "@/lib/api";
import { Modal, Spinner } from "./ui";
import ExportMenu from "./ExportMenu";

export default function JustificationModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const mut = useMutation({ mutationFn: () => api.buildJustification(task.id) });

  // Сразу запускаем генерацию справки при открытии.
  useEffect(() => {
    mut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const j = mut.data;

  return (
    <Modal title="Справка-обоснование назначения" onClose={onClose} maxWidthClass="max-w-2xl">
      <p className="mb-4 text-sm text-muted">
        Поручение: <span className="text-fg">{task.assignment}</span> · Ответственный:{" "}
        <span className="text-fg">{task.responsible || "—"}</span>
      </p>

      {mut.isPending && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted" aria-live="polite">
          <Spinner /> Формирование обоснования…
        </div>
      )}

      {mut.isError && (
        <p role="alert" className="py-6 text-sm text-danger">
          Не удалось сформировать обоснование:{" "}
          {mut.error instanceof Error ? mut.error.message : "неизвестная ошибка."}
        </p>
      )}

      {j && (
        <div className="space-y-4">
          <Section title="На основании фрагмента записи" body={j.fragment || task.source_fragment} />
          <Section title="На основании должностной обязанности" body={j.duty} />
          <Section title="Обоснование" body={j.text} />
          <div className="flex justify-end pt-2">
            <ExportMenu objectType="justification" objectId={j.id} name={`spravka_${task.id}`} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="section-label mb-1">{title}</div>
      <div className="whitespace-pre-wrap rounded-lg border border-border bg-elevated p-3 text-sm">
        {body || "—"}
      </div>
    </div>
  );
}
