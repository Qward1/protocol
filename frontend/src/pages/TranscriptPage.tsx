import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Loader2, Text, AudioLines, Video, ChevronLeft } from "lucide-react";
import clsx from "clsx";
import { api, type Segment } from "@/lib/api";
import { Card, PageHeader, Empty, Spinner, Badge } from "@/components/ui";
import ExportMenu from "@/components/ExportMenu";
import { fmtTime, speakerColor } from "@/lib/utils";

export default function TranscriptPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState(0);

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

  return (
    <div>
      <Link to="/library" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
        <ChevronLeft className="h-4 w-4" /> Библиотека
      </Link>
      <PageHeader
        icon={KindIcon}
        title={t.filename}
        subtitle={`${kindLabel} · ${isText ? "готовая расшифровка" : fmtTime(t.duration)} · ${t.segments.length} сегментов`}
        actions={
          <>
            <ExportMenu objectType="transcription" objectId={t.id} name={t.filename} />
            <button
              className="btn-primary"
              disabled={processing || genProtocol.isPending}
              onClick={() => genProtocol.mutate()}
            >
              {genProtocol.isPending ? <Spinner /> : <FileText className="h-4 w-4" />}
              Сформировать протокол
            </button>
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
        <Empty title="Сегментов пока нет" hint="Дождитесь окончания распознавания." />
      ) : (
        <Card className="space-y-1 p-3">
          {t.segments.map((seg, i) => {
            const active = current >= seg.start && (seg.end ? current < seg.end : true);
            return (
              <button
                key={i}
                onClick={() => !isText && seek(seg)}
                className={clsx(
                  "flex w-full gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                  active && !isText ? "bg-accent/10" : !isText && "hover:bg-elevated",
                  isText && "cursor-default",
                )}
              >
                <span className="mt-0.5 w-12 shrink-0 font-mono text-xs text-muted">
                  {fmtTime(seg.start)}
                </span>
                <span className="flex-1">
                  {seg.speaker && (
                    <Badge className={clsx("mr-2 border-transparent", speakerColor(seg.speaker))}>
                      {seg.speaker}
                    </Badge>
                  )}
                  <span className="text-sm">{seg.text}</span>
                </span>
              </button>
            );
          })}
        </Card>
      )}
    </div>
  );
}
