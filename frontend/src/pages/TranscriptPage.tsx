import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Text, AudioLines, Video, ChevronLeft, Pencil, X, Check, RotateCcw } from "lucide-react";
import clsx from "clsx";
import { api, type Segment, type Transcription } from "@/lib/api";
import { Card, PageHeader, Empty, Spinner, Badge } from "@/components/ui";
import ExportMenu from "@/components/ExportMenu";
import { fmtTime, speakerColor } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

export default function TranscriptPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);

  const canRename = can("speakers.manage");

  const { data: t } = useQuery({
    queryKey: ["transcription", id],
    queryFn: () => api.getTranscription(id),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "done" || s === "error" ? false : 2000;
    },
  });

  const genProtocol = useMutation({
    mutationFn: () => api.generateProtocol(id),
    onSuccess: (p) => nav(`/protocols/${p.id}`),
  });

  const saveSpeakers = useMutation({
    mutationFn: (mappings: Record<string, string>) => api.updateSpeakers(id, mappings),
    onSuccess: (updated) => {
      qc.setQueryData(["transcription", id], updated);
      setRenaming(null);
    },
  });

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [t?.id]);

  function seek(seg: Segment) {
    const el = audioRef.current;
    if (el) {
      el.currentTime = seg.start;
      el.play().catch(() => {});
    }
  }

  if (!t) return <Spinner className="h-6 w-6" />;

  const processing = t.status === "pending" || t.status === "processing";
  const isText = t.media_kind === "text";
  const kindLabel = isText ? "Текст" : t.media_kind === "video" ? "Видео" : "Аудио";
  const KindIcon = isText ? Text : t.media_kind === "video" ? Video : AudioLines;
  const speakerMap = t.speaker_map ?? {};
  const displayName = (speaker: string) => speakerMap[speaker] || speaker;

  return (
    <div>
      <Link to="/library" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
        <ChevronLeft className="h-4 w-4" /> Библиотека
      </Link>
      <PageHeader
        icon={KindIcon}
        title={t.filename}
        subtitle={`${kindLabel} · ${isText ? "готовая расшифровка" : fmtTime(t.duration)} · ${t.segments.length} реплик`}
        actions={
          <>
            <ExportMenu objectType="transcription" objectId={t.id} name={t.filename} />
            {can("protocols.manage") && (
              <button
                className="btn-primary"
                disabled={processing || genProtocol.isPending}
                onClick={() => genProtocol.mutate()}
              >
                {genProtocol.isPending ? <Spinner /> : <FileText className="h-4 w-4" />}
                Сформировать протокол
              </button>
            )}
          </>
        }
      />

      {processing && (
        <Card className="mb-4">
          <div className="flex items-center gap-3 text-sm text-muted">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            Идёт распознавание речи… Страница обновится автоматически.
          </div>
        </Card>
      )}

      {t.status === "error" && (
        <Card className="mb-4">
          <p className="text-sm text-rose-500">Ошибка: {t.error}</p>
        </Card>
      )}

      {!isText && (
        <Card className="sticky top-0 z-10 mb-4">
          <audio ref={audioRef} src={api.mediaUrl(t.id)} controls className="w-full" />
        </Card>
      )}

      {isText && (
        <Card className="mb-4 flex items-center gap-3 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
            <Text className="h-4 w-4" />
          </div>
          <div className="text-sm text-muted">Запись создана из готового текста. Протокол можно сформировать сразу.</div>
        </Card>
      )}

      {t.segments.length === 0 ? (
        <Empty title="Реплик пока нет" hint="Дождитесь окончания распознавания." />
      ) : (
        <div className="space-y-2">
          {t.segments.map((seg, i) => {
            const active = current >= seg.start && (seg.end ? current < seg.end : true);
            const name = displayName(seg.speaker);
            return (
              <div
                key={i}
                onClick={() => !isText && seek(seg)}
                className={clsx(
                  "card p-3 transition-colors",
                  active && !isText ? "border-accent/50 ring-1 ring-accent/30" : "",
                  !isText && "cursor-pointer hover:border-accent/40",
                )}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-mono text-xs text-muted">{fmtTime(seg.start)}</span>
                  {seg.speaker &&
                    (canRename ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenaming(seg.speaker);
                        }}
                        className={clsx(
                          "chip group border-transparent transition-colors hover:brightness-105",
                          speakerColor(seg.speaker),
                        )}
                        title="Переименовать спикера"
                      >
                        {name}
                        <Pencil className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                      </button>
                    ) : (
                      <Badge className={clsx("border-transparent", speakerColor(seg.speaker))}>{name}</Badge>
                    ))}
                </div>
                <p className="text-sm leading-relaxed">{seg.text}</p>
              </div>
            );
          })}
        </div>
      )}

      {renaming !== null && (
        <SpeakerRenameModal
          speaker={renaming}
          current={speakerMap[renaming] ?? ""}
          transcription={t}
          saving={saveSpeakers.isPending}
          onSave={(name) => saveSpeakers.mutate({ [renaming]: name })}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  );
}

function SpeakerRenameModal({
  speaker,
  current,
  transcription,
  saving,
  onSave,
  onClose,
}: {
  speaker: string;
  current: string;
  transcription: Transcription;
  saving: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(current);
  const count = transcription.segments.filter((s) => s.speaker === speaker).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="card relative z-10 w-full max-w-md p-6">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold">Переименовать спикера</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-elevated">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-sm text-muted">
          Метка <span className="font-medium text-fg">{speaker}</span> ({count}{" "}
          {count === 1 ? "реплика" : "реплик"}). Укажите ФИО, должность или произвольное имя — оно
          заменит метку во всём совещании.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(value.trim());
          }}
        >
          <label className="block">
            <span className="section-label mb-1.5 block">Имя / должность</span>
            <input
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              placeholder="напр. Иванов И.И. или Министр финансов"
            />
          </label>

          <div className="mt-5 flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={saving || !current}
              onClick={() => onSave("")}
              title="Вернуть техническую метку"
            >
              <RotateCcw className="h-4 w-4" /> Сбросить
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Отмена
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? <Spinner /> : <Check className="h-4 w-4" />} Сохранить
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
