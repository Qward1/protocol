import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ScrollText,
  ChevronLeft,
  AudioLines,
  FileText,
  CalendarClock,
  ListChecks,
  Quote,
} from "lucide-react";
import clsx from "clsx";
import { api, type Task } from "@/lib/api";
import { Card, PageHeader, Spinner, Badge, SectionTitle, Avatar, Empty } from "@/components/ui";
import ExportMenu from "@/components/ExportMenu";
import JustificationModal from "@/components/JustificationModal";
import { statusColor, statusDot, deadlineUrgency, deadlineColor } from "@/lib/utils";

export default function ProtocolPage() {
  const { id = "" } = useParams();
  const [justifyTask, setJustifyTask] = useState<Task | null>(null);

  const { data: p } = useQuery({ queryKey: ["protocol", id], queryFn: () => api.getProtocol(id) });

  if (!p) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-accent" />
      </div>
    );
  }

  return (
    <div>
      <Link to="/protocols" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
        <ChevronLeft className="h-4 w-4" /> Все протоколы
      </Link>

      <PageHeader
        icon={FileText}
        title={p.title || "Протокол"}
        subtitle={`${p.date || "дата не указана"}${p.number ? ` · № ${p.number}` : ""} · ${p.tasks.length} поручений`}
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

      {p.body && (
        <Card className="mb-6">
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{p.body}</div>
        </Card>
      )}

      <SectionTitle icon={ListChecks} count={p.tasks.length}>
        Поручения
      </SectionTitle>

      {p.tasks.length === 0 ? (
        <Empty icon={ListChecks} title="В этом протоколе нет поручений" />
      ) : (
        <div className="space-y-3">
          {p.tasks.map((task) => {
            const urgency = deadlineUrgency(task.deadline, task.status);
            return (
              <div key={task.id} className="card overflow-hidden p-0">
                <div className="flex">
                  <div className={clsx("w-1.5 shrink-0", statusDot(task.status))} />
                  <div className="min-w-0 flex-1 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <p className="flex-1 font-semibold leading-snug">{task.assignment}</p>
                      <button className="btn-soft shrink-0" onClick={() => setJustifyTask(task)}>
                        <ScrollText className="h-4 w-4" />
                        Обоснование
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      <span className="flex items-center gap-2">
                        <Avatar name={task.responsible} className="h-7 w-7" />
                        <span className="font-medium">{task.responsible || "Ответственный не определён"}</span>
                      </span>
                      {task.department && <span className="text-muted">{task.department}</span>}
                      {task.deadline && (
                        <span className={clsx("flex items-center gap-1.5 font-medium", deadlineColor(urgency))}>
                          <CalendarClock className="h-4 w-4" /> {task.deadline}
                        </span>
                      )}
                      <Badge className={clsx("border-transparent", statusColor(task.status))}>{task.status}</Badge>
                      {task.confidence > 0 && (
                        <span className="flex items-center gap-2 text-xs text-muted">
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-border">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${Math.round(task.confidence * 100)}%` }}
                            />
                          </span>
                          {(task.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>

                    {task.source_fragment && (
                      <div className="mt-3 rounded-lg border border-border bg-elevated/60 p-3 text-sm text-muted">
                        <span className="section-label flex items-center gap-1">
                          <Quote className="h-3.5 w-3.5" /> Фрагмент-источник
                        </span>
                        <p className="mt-1 italic">«{task.source_fragment}»</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {justifyTask && <JustificationModal task={justifyTask} onClose={() => setJustifyTask(null)} />}
    </div>
  );
}
