import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  FileText,
  AudioLines,
  Video,
  Type,
  Check,
  MessagesSquare,
  Trash2,
  Library as LibraryIcon,
  ListChecks,
  ChevronRight,
} from "lucide-react";
import clsx from "clsx";
import { api, type SearchHit, type TranscriptionListItem, type ProtocolListItem } from "@/lib/api";
import { Card, PageHeader, Empty, Spinner, Badge, SectionTitle } from "@/components/ui";
import { useSelection } from "@/store/selection";
import { fmtDate, fmtTime } from "@/lib/utils";

export default function LibraryPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["library"], queryFn: api.library });
  const sel = useSelection();
  const [q, setQ] = useState("");
  const search = useMutation({ mutationFn: (query: string) => api.search(query) });
  const delTr = useMutation({
    mutationFn: (id: string) => api.deleteTranscription(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
  });
  const delPr = useMutation({
    mutationFn: (id: string) => api.deleteProtocol(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
  });

  const selectedCount = sel.protocolIds.length + sel.transcriptionIds.length;
  const transcriptions = data?.transcriptions ?? [];
  const protocols = data?.protocols ?? [];

  const allTrPicked = transcriptions.length > 0 && transcriptions.every((t) => sel.transcriptionIds.includes(t.id));
  const allPrPicked = protocols.length > 0 && protocols.every((p) => sel.protocolIds.includes(p.id));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LibraryIcon}
        title="Библиотека"
        subtitle="Историческая память: записи и протоколы. Отметьте нужные — задайте вопросы или ищите по смыслу."
        actions={
          <button
            className="btn-primary"
            disabled={selectedCount === 0}
            onClick={() => nav("/chat")}
          >
            <MessagesSquare className="h-4 w-4" />
            Вопросы по выбранному ({selectedCount})
          </button>
        }
      />

      {/* Семантический поиск по всем встречам */}
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) search.mutate(q.trim());
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input
              className="input pl-9"
              placeholder="Семантический поиск по всем записям…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="btn-primary" type="submit" disabled={search.isPending}>
            {search.isPending ? <Spinner /> : <Search className="h-4 w-4" />}
            Найти
          </button>
        </form>

        {search.data && (
          <div className="mt-4 space-y-2">
            {search.data.length === 0 ? (
              <p className="text-sm text-muted">Ничего не найдено.</p>
            ) : (
              search.data.map((hit: SearchHit, i) => (
                <button
                  key={i}
                  className={clsx(
                    "block w-full rounded-lg border border-border bg-elevated p-3 text-left text-sm transition-colors",
                    hit.transcription_id && "hover:border-accent/50",
                  )}
                  onClick={() => hit.transcription_id && nav(`/transcriptions/${hit.transcription_id}`)}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">{hit.title || "Запись"}</span>
                    <Badge>score {hit.score.toFixed(2)}</Badge>
                  </div>
                  <p className="text-muted">…{hit.fragment}…</p>
                </button>
              ))
            )}
          </div>
        )}
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-accent" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <SectionTitle
              icon={AudioLines}
              count={transcriptions.length}
              action={
                transcriptions.length > 0 && (
                  <SelectAll
                    picked={allTrPicked}
                    onToggle={() =>
                      transcriptions.forEach((t) => {
                        const picked = sel.transcriptionIds.includes(t.id);
                        if (allTrPicked ? picked : !picked) sel.toggleTranscription(t.id);
                      })
                    }
                  />
                )
              }
            >
              Записи
            </SectionTitle>
            {!transcriptions.length ? (
              <Empty icon={AudioLines} title="Нет записей" hint="Загрузите аудио, видео или текст встречи." />
            ) : (
              <div className="space-y-2">
                {transcriptions.map((t) => (
                  <TranscriptionRow
                    key={t.id}
                    t={t}
                    picked={sel.transcriptionIds.includes(t.id)}
                    onToggle={() => sel.toggleTranscription(t.id)}
                    onDelete={() => delTr.mutate(t.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle
              icon={FileText}
              count={protocols.length}
              action={
                protocols.length > 0 && (
                  <SelectAll
                    picked={allPrPicked}
                    onToggle={() =>
                      protocols.forEach((p) => {
                        const picked = sel.protocolIds.includes(p.id);
                        if (allPrPicked ? picked : !picked) sel.toggleProtocol(p.id);
                      })
                    }
                  />
                )
              }
            >
              Протоколы
            </SectionTitle>
            {!protocols.length ? (
              <Empty icon={FileText} title="Нет протоколов" hint="Откройте запись и сформируйте протокол." />
            ) : (
              <div className="space-y-2">
                {protocols.map((p) => (
                  <ProtocolRow
                    key={p.id}
                    p={p}
                    picked={sel.protocolIds.includes(p.id)}
                    onToggle={() => sel.toggleProtocol(p.id)}
                    onDelete={() => delPr.mutate(p.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function kindIcon(kind: string) {
  if (kind === "video") return Video;
  if (kind === "text") return Type;
  return AudioLines;
}

function TranscriptionRow({
  t,
  picked,
  onToggle,
  onDelete,
}: {
  t: TranscriptionListItem;
  picked: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const Icon = kindIcon(t.media_kind);
  const meta =
    t.media_kind === "text" ? "Текст" : fmtTime(t.duration);
  return (
    <div className={clsx("card-link flex items-center gap-3 p-3", picked && "border-accent/50 ring-1 ring-accent/30")}>
      <SelectBtn picked={picked} onClick={onToggle} />
      <div className="icon-box h-9 w-9 shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <Link to={`/transcriptions/${t.id}`} className="min-w-0 flex-1">
        <div className="truncate font-medium">{t.filename}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          <span>{meta}</span>
          <span>·</span>
          <span>{t.segments_count} сегм.</span>
          <span>·</span>
          <span>{fmtDate(t.created_at)}</span>
        </div>
      </Link>
      <StatusChip status={t.status} />
      <DeleteBtn onClick={onDelete} />
    </div>
  );
}

function ProtocolRow({
  p,
  picked,
  onToggle,
  onDelete,
}: {
  p: ProtocolListItem;
  picked: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={clsx("card-link flex items-center gap-3 p-3", picked && "border-accent/50 ring-1 ring-accent/30")}>
      <SelectBtn picked={picked} onClick={onToggle} />
      <div className="icon-box h-9 w-9 shrink-0">
        <FileText className="h-4 w-4" />
      </div>
      <Link to={`/protocols/${p.id}`} className="min-w-0 flex-1">
        <div className="truncate font-medium">{p.title || "Без названия"}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="h-3.5 w-3.5" />
            {p.tasks_count} поручений
          </span>
          {p.date && (
            <>
              <span>·</span>
              <span>{p.date}</span>
            </>
          )}
          <span>·</span>
          <span>{fmtDate(p.created_at)}</span>
        </div>
      </Link>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
      <DeleteBtn onClick={onDelete} />
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tint =
    status === "done"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
      : status === "error"
        ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
        : "bg-amber-500/15 text-amber-600 dark:text-amber-300";
  const label = status === "done" ? "готово" : status === "error" ? "ошибка" : status;
  return <Badge className={clsx("shrink-0 border-transparent", tint)}>{label}</Badge>;
}

function SelectAll({ picked, onToggle }: { picked: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="text-xs font-semibold text-accent hover:underline">
      {picked ? "Снять все" : "Выбрать все"}
    </button>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (confirm("Удалить безвозвратно?")) onClick();
      }}
      className="shrink-0 rounded-md p-1.5 text-muted hover:bg-rose-500/10 hover:text-rose-500"
      title="Удалить"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function SelectBtn({ picked, onClick }: { picked: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={clsx(
        "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
        picked ? "border-accent bg-accent text-accent-fg" : "border-border hover:border-accent",
      )}
      title={picked ? "Убрать из выборки" : "Добавить в выборку"}
    >
      {picked && <Check className="h-3.5 w-3.5" />}
    </button>
  );
}
