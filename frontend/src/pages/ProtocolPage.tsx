import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, ChevronLeft, AudioLines } from "lucide-react";
import clsx from "clsx";
import { api, type Task } from "@/lib/api";
import { Card, PageHeader, Spinner, Badge } from "@/components/ui";
import ExportMenu from "@/components/ExportMenu";
import JustificationModal from "@/components/JustificationModal";
import { statusColor } from "@/lib/utils";

export default function ProtocolPage() {
  const { id = "" } = useParams();
  const [justifyTask, setJustifyTask] = useState<Task | null>(null);

  const { data: p } = useQuery({ queryKey: ["protocol", id], queryFn: () => api.getProtocol(id) });

  if (!p) return <Spinner className="h-6 w-6" />;

  return (
    <div>
      <PageHeader
        title={p.title || "Протокол"}
        subtitle={`${p.date || "дата не указана"}${p.number ? ` · № ${p.number}` : ""}`}
        actions={
          <>
            {p.transcription_id && (
              <Link to={`/transcriptions/${p.transcription_id}`} className="btn-ghost">
                <AudioLines className="h-4 w-4" />
                Запись
              </Link>
            )}
            <ExportMenu objectType="protocol" objectId={p.id} name={p.title || "protocol"} />
          </>
        }
      />

      <Link to="/protocols" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft className="h-4 w-4" /> Все протоколы
      </Link>

      {p.body && (
        <Card className="mb-6">
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{p.body}</div>
        </Card>
      )}

      <h2 className="mb-3 text-lg font-semibold">Поручения ({p.tasks.length})</h2>
      <div className="space-y-3">
        {p.tasks.map((task) => (
          <Card key={task.id} className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="font-medium">{task.assignment}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge>{task.responsible || "Ответственный не определён"}</Badge>
                  {task.department && <Badge>{task.department}</Badge>}
                  {task.deadline && <Badge>⏰ {task.deadline}</Badge>}
                  <Badge className={clsx("border-transparent", statusColor(task.status))}>
                    {task.status}
                  </Badge>
                  {task.confidence > 0 && (
                    <Badge>уверенность {(task.confidence * 100).toFixed(0)}%</Badge>
                  )}
                </div>
              </div>
              <button className="btn-ghost shrink-0" onClick={() => setJustifyTask(task)}>
                <ScrollText className="h-4 w-4" />
                Обоснование
              </button>
            </div>

            {task.source_fragment && (
              <div className="rounded-lg border border-border bg-elevated p-3 text-sm text-muted">
                <span className="text-xs font-medium uppercase tracking-wide">Фрагмент-источник</span>
                <p className="mt-1 italic">«{task.source_fragment}»</p>
              </div>
            )}
          </Card>
        ))}
      </div>

      {justifyTask && <JustificationModal task={justifyTask} onClose={() => setJustifyTask(null)} />}
    </div>
  );
}
