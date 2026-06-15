import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { X, ScrollText } from "lucide-react";
import { api, type Task } from "@/lib/api";
import { Spinner } from "./ui";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="card relative z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold">Справка-обоснование назначения</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-elevated">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-sm text-muted">
          Поручение: <span className="text-fg">{task.assignment}</span> · Ответственный:{" "}
          <span className="text-fg">{task.responsible || "—"}</span>
        </p>

        {mut.isPending && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted">
            <Spinner /> Формирование обоснования…
          </div>
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
      </div>
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{title}</div>
      <div className="whitespace-pre-wrap rounded-lg border border-border bg-elevated p-3 text-sm">
        {body || "—"}
      </div>
    </div>
  );
}
