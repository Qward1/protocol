import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ScrollText,
  ChevronLeft,
  AudioLines,
  FileText,
  CalendarClock,
  ListChecks,
  MessagesSquare,
  Quote,
  Pencil,
  Save,
  X,
} from "lucide-react";
import clsx from "clsx";
import { api, type Task } from "@/lib/api";
import { Card, PageHeader, Spinner, Badge, SectionTitle, Avatar, Empty } from "@/components/ui";
import ExportMenu from "@/components/ExportMenu";
import JustificationModal from "@/components/JustificationModal";
import { statusColor, statusDot, deadlineUrgency, deadlineColor } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useSelection } from "@/store/selection";

export default function ProtocolPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const sel = useSelection();
  const [justifyTask, setJustifyTask] = useState<Task | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", date: "", number: "", body: "" });

  const { data: p, isError } = useQuery({
    queryKey: ["protocol", id],
    queryFn: () => api.getProtocol(id),
    retry: false,
  });

  const save = useMutation({
    mutationFn: () => api.updateProtocol(id, draft),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["protocol", id] });
    },
  });

  const startEdit = () => {
    if (!p) return;
    setDraft({ title: p.title, date: p.date, number: p.number, body: p.body });
    setEditing(true);
  };

  if (isError) {
    return (
      <Empty
        icon={FileText}
        title="Протокол не найден или удалён"
        hint="Возможно, его удалили. Вернитесь к списку протоколов."
        action={
          <Link to="/protocols" className="btn-primary">
            <ChevronLeft className="h-4 w-4" /> Все протоколы
          </Link>
        }
      />
    );
  }

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
            {can("qa.use") && (
              <button
                className="btn-ghost"
                onClick={() => {
                  sel.setSingle("protocol", p.id);
                  nav("/chat");
                }}
                title="Задать вопрос по этому протоколу"
              >
                <MessagesSquare className="h-4 w-4" /> Спросить по протоколу
              </button>
            )}
            {can("protocols.manage") && !editing && (
              <button className="btn-ghost" onClick={startEdit} title="Редактировать протокол">
                <Pencil className="h-4 w-4" /> Редактировать
              </button>
            )}
            <ExportMenu objectType="protocol" objectId={p.id} name={p.title || "protocol"} />
          </>
        }
      />

      {editing ? (
        <Card className="mb-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <label className="block">
              <span className="section-label">Заголовок</span>
              <input
                className="input mt-1"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                aria-label="Заголовок протокола"
              />
            </label>
            <label className="block">
              <span className="section-label">Дата</span>
              <input
                className="input mt-1 sm:w-40"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                aria-label="Дата протокола"
              />
            </label>
            <label className="block">
              <span className="section-label">Номер</span>
              <input
                className="input mt-1 sm:w-32"
                value={draft.number}
                onChange={(e) => setDraft({ ...draft, number: e.target.value })}
                aria-label="Номер протокола"
              />
            </label>
          </div>
          <label className="block">
            <span className="section-label">Текст протокола</span>
            <textarea
              className="input mt-1 min-h-[240px] resize-y whitespace-pre-wrap leading-relaxed"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              aria-label="Текст протокола"
            />
          </label>
          <div className="flex items-center gap-2">
            <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Spinner /> : <Save className="h-4 w-4" />} Сохранить
            </button>
            <button className="btn-ghost" disabled={save.isPending} onClick={() => setEditing(false)}>
              <X className="h-4 w-4" /> Отмена
            </button>
            {save.isError && (
              <span role="alert" className="text-sm text-danger">
                {(save.error as Error)?.message ?? "Не удалось сохранить"}
              </span>
            )}
          </div>
        </Card>
      ) : (
        p.body && (
          <Card className="mb-6">
            <div className="max-w-[72ch] whitespace-pre-wrap text-sm leading-relaxed">{p.body}</div>
          </Card>
        )
      )}

      <SectionTitle count={p.tasks.length}>Поручения</SectionTitle>

      {p.tasks.length === 0 ? (
        <Empty icon={ListChecks} title="В этом протоколе нет поручений" />
      ) : (
        <div className="space-y-3">
          {p.tasks.map((task) => {
            const urgency = deadlineUrgency(task.deadline, task.status, task.deadline_at);
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
                        <div className="flex items-center justify-between gap-2">
                          <span className="section-label flex items-center gap-1">
                            <Quote className="h-3.5 w-3.5" /> Фрагмент-источник
                          </span>
                          {p.transcription_id && (
                            <Link
                              to={`/transcriptions/${p.transcription_id}?frag=${encodeURIComponent(task.source_fragment)}`}
                              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline"
                            >
                              <AudioLines className="h-3.5 w-3.5" /> К фрагменту записи
                            </Link>
                          )}
                        </div>
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
