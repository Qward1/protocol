import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Text, AudioLines, Video, ChevronLeft, Pencil, X, Check, RotateCcw, MessagesSquare } from "lucide-react";
import clsx from "clsx";
import { api, type Segment, type Transcription } from "@/lib/api";
import { Card, PageHeader, Empty, Spinner, Badge, Modal } from "@/components/ui";
import ExportMenu from "@/components/ExportMenu";
import { fmtTime, personTint, bestSegmentIndex } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useSelection } from "@/store/selection";

export default function TranscriptPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const sel = useSelection();
  const audioRef = useRef<HTMLAudioElement>(null);
  // Храним ТОЛЬКО индекс активного сегмента, а не сырое время плеера — иначе
  // timeupdate (~4 Гц) перерисовывал бы весь транскрипт при воспроизведении.
  const [activeIndex, setActiveIndex] = useState(-1);
  const [rate, setRate] = useState(1);
  const [renaming, setRenaming] = useState<string | null>(null);
  // jump-to-fragment: ?t=<секунды> (точный таймкод) или ?frag=<текст> (ищем по словам).
  const [params] = useSearchParams();
  const seekParam = params.get("t");
  const fragParam = params.get("frag");
  const [jumpedIdx, setJumpedIdx] = useState<number | null>(null);
  const handledJump = useRef<string | null>(null);
  const [editingSeg, setEditingSeg] = useState<number | null>(null);

  const canRename = can("speakers.manage");
  const canManageTr = can("transcripts.manage");

  const { data: t, isError } = useQuery({
    queryKey: ["transcription", id],
    queryFn: () => api.getTranscription(id),
    retry: false,
    refetchInterval: (q) => {
      if (q.state.status === "error") return false; // не долбим 404 после удаления
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

  const retry = useMutation({
    mutationFn: () => api.retryTranscription(id),
    onSuccess: (updated) => qc.setQueryData(["transcription", id], updated),
  });
  const saveSegments = useMutation({
    mutationFn: (segments: Segment[]) => api.updateSegments(id, segments),
    onSuccess: (updated) => {
      qc.setQueryData(["transcription", id], updated);
      setEditingSeg(null);
    },
  });

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const segs = t?.segments ?? [];
    // setActiveIndex с тем же значением React отбрасывает (Object.is), поэтому в
    // пределах одного сегмента ре-рендера нет — перерисовываются лишь две
    // карточки на границе (уходящая и приходящая active).
    const onTime = () => setActiveIndex(activeSegmentIndex(segs, el.currentTime));
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [t?.id, t?.segments]);

  // Скорость воспроизведения (нативный playbackRate) — сбрасывается при смене src.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, t?.id]);

  // Стабильные колбэки для memo-карточек: не пересоздаются между рендерами,
  // поэтому карточки, у которых не изменились примитивные пропсы, не перерисовываются.
  const seek = useCallback((seg: Segment) => {
    const el = audioRef.current;
    if (el) {
      el.currentTime = seg.start;
      el.play().catch(() => {});
    }
  }, []);
  const segmentsRef = useRef<Segment[]>([]);
  segmentsRef.current = t?.segments ?? [];
  const saveMutate = saveSegments.mutate;
  const startRename = useCallback((speaker: string) => setRenaming(speaker), []);
  const startEditSeg = useCallback((i: number) => setEditingSeg(i), []);
  const cancelEditSeg = useCallback(() => setEditingSeg(null), []);
  const saveSeg = useCallback(
    (i: number, text: string) =>
      saveMutate(segmentsRef.current.map((s, j) => (j === i ? { ...s, text } : s))),
    [saveMutate],
  );

  // Пришли по ссылке с таймкодом/фрагментом — перематываем плеер и подсвечиваем сегмент.
  useEffect(() => {
    if (!t || t.status !== "done" || t.segments.length === 0) return;
    const key = seekParam != null ? `t:${seekParam}` : fragParam ? `f:${fragParam}` : null;
    if (!key || handledJump.current === key) return;

    const segs = t.segments;
    let idx = -1;
    let time: number | null = null;
    if (seekParam != null) {
      const secs = Number(seekParam);
      if (!Number.isNaN(secs)) {
        time = secs;
        idx = segs.findIndex((s, i) => secs >= s.start && (i + 1 >= segs.length || secs < segs[i + 1].start));
      }
    } else if (fragParam) {
      idx = bestSegmentIndex(segs, fragParam);
      if (idx >= 0) time = segs[idx].start;
    }
    if (idx < 0 && time == null) return;
    handledJump.current = key;
    if (idx < 0) idx = 0;

    setJumpedIdx(idx);
    if (time != null) {
      setActiveIndex(idx);
      const el = audioRef.current;
      if (el) {
        el.currentTime = time;
        el.play().catch(() => {});
      }
    }
    const targetIdx = idx;
    requestAnimationFrame(() =>
      document.getElementById(`seg-${targetIdx}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }, [t, seekParam, fragParam]);

  if (isError) {
    return (
      <Empty
        icon={FileText}
        title="Запись не найдена или удалена"
        hint="Возможно, её удалили. Вернитесь в библиотеку и выберите другую."
        action={
          <Link to="/library" className="btn-primary">
            <ChevronLeft className="h-4 w-4" /> В библиотеку
          </Link>
        }
      />
    );
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
            {can("qa.use") && (
              <button
                className="btn-ghost"
                onClick={() => {
                  sel.setSingle("transcription", t.id);
                  nav("/chat");
                }}
                title="Задать вопрос по этой записи"
              >
                <MessagesSquare className="h-4 w-4" /> Спросить по записи
              </button>
            )}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="text-sm text-danger">
              Ошибка распознавания: {t.error || "неизвестная ошибка"}
            </p>
            {canManageTr && (
              <button className="btn-soft shrink-0" disabled={retry.isPending} onClick={() => retry.mutate()}>
                {retry.isPending ? <Spinner /> : <RotateCcw className="h-4 w-4" aria-hidden />} Повторить распознавание
              </button>
            )}
          </div>
          {retry.isError && (
            <p className="mt-2 text-xs text-danger">
              {retry.error instanceof Error ? retry.error.message : "Не удалось перезапустить распознавание."}
            </p>
          )}
        </Card>
      )}

      {genProtocol.isError && (
        <Card className="mb-4">
          <p role="alert" className="text-sm text-danger">
            Не удалось сформировать протокол:{" "}
            {genProtocol.error instanceof Error
              ? genProtocol.error.message
              : "неизвестная ошибка. Проверьте состояние сервисов на /api/health."}
          </p>
        </Card>
      )}

      {!isText && (
        <Card className="sticky top-0 z-10 mb-4">
          <audio ref={audioRef} src={api.mediaUrl(t.id)} controls className="w-full" />
          <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted">
            <label className="flex items-center gap-1.5">
              Скорость
              <select
                className="input h-8 w-auto py-1 text-xs tabular-nums"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                aria-label="Скорость воспроизведения"
              >
                <option value={1}>1×</option>
                <option value={1.5}>1.5×</option>
                <option value={2}>2×</option>
              </select>
            </label>
          </div>
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
          {t.segments.map((seg, i) => (
            <SegmentCard
              key={i}
              seg={seg}
              index={i}
              name={displayName(seg.speaker)}
              active={activeIndex === i}
              jumped={jumpedIdx === i}
              isText={isText}
              canRename={canRename}
              canManage={canManageTr}
              editing={editingSeg === i}
              saving={editingSeg === i && saveSegments.isPending}
              onSeek={seek}
              onRename={startRename}
              onStartEdit={startEditSeg}
              onCancelEdit={cancelEditSeg}
              onSaveEdit={saveSeg}
            />
          ))}
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

/** Индекс активного сегмента для текущего времени плеера (бинарный поиск по start).
 *  −1, если время раньше первого сегмента или за пределами `end` последнего активного
 *  (та же семантика, что и прежняя проверка `time ∈ [start, end)`). */
function activeSegmentIndex(segments: Segment[], time: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= time) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx < 0) return -1;
  const seg = segments[idx];
  return seg.end && time >= seg.end ? -1 : idx;
}

interface SegmentCardProps {
  seg: Segment;
  index: number;
  name: string;
  active: boolean;
  jumped: boolean;
  isText: boolean;
  canRename: boolean;
  canManage: boolean;
  editing: boolean;
  saving: boolean;
  onSeek: (seg: Segment) => void;
  onRename: (speaker: string) => void;
  onStartEdit: (index: number) => void;
  onCancelEdit: () => void;
  onSaveEdit: (index: number, text: string) => void;
}

/** Одна реплика транскрипта. memo + примитивные пропсы: при воспроизведении
 *  перерисовывается только карточка, у которой изменился `active`. */
const SegmentCard = memo(function SegmentCard({
  seg,
  index,
  name,
  active,
  jumped,
  isText,
  canRename,
  canManage,
  editing,
  saving,
  onSeek,
  onRename,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: SegmentCardProps) {
  // Текст правки — локальное состояние карточки: набор текста не трогает соседние.
  const [text, setText] = useState(seg.text);
  useEffect(() => {
    if (editing) setText(seg.text);
  }, [editing, seg.text]);

  return (
    <div
      id={`seg-${index}`}
      onClick={() => !isText && onSeek(seg)}
      className={clsx(
        "card scroll-mt-24 p-3 transition-colors",
        (active && !isText) || jumped ? "border-accent/50 ring-1 ring-accent/30" : "",
        !isText && "cursor-pointer hover:border-accent/40",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-xs tabular-nums text-muted">{fmtTime(seg.start)}</span>
        {seg.speaker &&
          (canRename ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRename(seg.speaker);
              }}
              className="chip group border-transparent transition-[filter] hover:brightness-105"
              style={personTint(seg.speaker)}
              title="Переименовать спикера"
              aria-label={`Переименовать спикера ${name}`}
            >
              {name}
              <Pencil className="h-3 w-3 opacity-50 group-hover:opacity-100" aria-hidden />
            </button>
          ) : (
            <Badge className="border-transparent" style={personTint(seg.speaker)}>
              {name}
            </Badge>
          ))}
        {canManage && !editing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit(index);
            }}
            className="icon-btn ml-auto h-7 w-7"
            title="Редактировать текст реплики"
            aria-label="Редактировать текст реплики"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          <textarea
            className="input min-h-20 resize-y text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onCancelEdit}>
              <X className="h-4 w-4" /> Отмена
            </button>
            <button className="btn-primary" disabled={saving} onClick={() => onSaveEdit(index, text)}>
              {saving ? <Spinner /> : <Check className="h-4 w-4" />} Сохранить
            </button>
          </div>
        </div>
      ) : (
        <p className="max-w-[68ch] text-sm leading-relaxed">{seg.text}</p>
      )}
    </div>
  );
});

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
    <Modal title="Переименовать спикера" onClose={onClose} maxWidthClass="max-w-md">
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
            spellCheck={false}
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
            <RotateCcw className="h-4 w-4" aria-hidden /> Сбросить
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner /> : <Check className="h-4 w-4" aria-hidden />} Сохранить
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
