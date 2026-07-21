import { useEffect, useState } from "react";
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
  ListFilter,
  ChevronRight,
  Upload,
  X,
} from "lucide-react";
import clsx from "clsx";
import { api, type SearchHit, type TranscriptionListItem, type ProtocolListItem } from "@/lib/api";
import { Card, PageHeader, Empty, Spinner, Skeleton, Badge, SectionTitle, ConfirmDialog } from "@/components/ui";
import { useSelection } from "@/store/selection";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtTime } from "@/lib/utils";

export default function LibraryPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canDelTr = can("transcripts.manage");
  const canDelPr = can("protocols.manage");
  const canQa = can("qa.use");
  const canUpload = can("upload");
  const { data, isLoading } = useQuery({ queryKey: ["library"], queryFn: api.library });
  const sel = useSelection();
  const [q, setQ] = useState("");
  const [listFilter, setListFilter] = useState(""); // мгновенная клиентская фильтрация списков
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

  const lf = listFilter.trim().toLowerCase();
  const shownTr = lf ? transcriptions.filter((t) => t.filename.toLowerCase().includes(lf)) : transcriptions;
  const shownPr = lf ? protocols.filter((p) => (p.title || "").toLowerCase().includes(lf)) : protocols;

  // После загрузки/обновления библиотеки убираем из Q&A-выборки ID удалённых
  // объектов, чтобы счётчик не врал и в /api/qa не уходили «мёртвые» ID.
  const pruneMissing = sel.pruneMissing;
  useEffect(() => {
    if (!data) return;
    pruneMissing(
      data.protocols.map((p) => p.id),
      data.transcriptions.map((t) => t.id),
    );
  }, [data, pruneMissing]);

  const allTrPicked = shownTr.length > 0 && shownTr.every((t) => sel.transcriptionIds.includes(t.id));
  const allPrPicked = shownPr.length > 0 && shownPr.every((p) => sel.protocolIds.includes(p.id));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LibraryIcon}
        title="Библиотека"
        subtitle="Историческая память: записи и протоколы. Отметьте нужные — задайте вопросы или ищите по смыслу."
        actions={
          canQa ? (
            <button
              className="btn-primary"
              disabled={selectedCount === 0}
              onClick={() => nav("/chat")}
            >
              <MessagesSquare className="h-4 w-4" />
              Вопросы по выбранному ({selectedCount})
            </button>
          ) : undefined
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
              type="search"
              name="semantic-search"
              placeholder="Семантический поиск по всем записям…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {(search.data || search.isPending) && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setQ("");
                search.reset();
              }}
              title="Очистить результаты"
              aria-label="Очистить результаты поиска"
            >
              <X className="h-4 w-4" />
            </button>
          )}
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
                  onClick={() => hit.transcription_id && nav(hitHref(hit))}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">{hit.title || "Запись"}</span>
                    {/* Порядок = релевантность; сырой score пользователю не показываем. */}
                    <span className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-border" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${Math.round(Math.max(0, Math.min(1, hit.score)) * 100)}%` }}
                      />
                    </span>
                  </div>
                  <p className="text-muted">
                    …<Highlight text={hit.fragment} query={search.variables ?? q} />…
                  </p>
                </button>
              ))
            )}
          </div>
        )}
      </Card>

      {isLoading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {[0, 1].map((col) => (
            <div key={col} className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card flex items-center gap-3 p-3">
                  <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <>
        {(transcriptions.length > 0 || protocols.length > 0) && (
          <label className="relative block">
            <ListFilter className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input
              className="input pl-9"
              type="search"
              name="library-filter"
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              placeholder="Фильтр по названию записей и протоколов…"
              aria-label="Фильтр по названию"
            />
            {listFilter && (
              <button
                type="button"
                onClick={() => setListFilter("")}
                className="absolute right-2 top-2 rounded-md p-1 text-muted hover:text-fg"
                aria-label="Очистить фильтр"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <SectionTitle
              count={shownTr.length}
              action={
                shownTr.length > 0 && (
                  <SelectAll
                    picked={allTrPicked}
                    onToggle={() =>
                      shownTr.forEach((t) => {
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
            {!shownTr.length ? (
              <Empty
                icon={AudioLines}
                title={transcriptions.length ? "Ничего не найдено" : "Нет записей"}
                hint={transcriptions.length ? "Измените фильтр по названию." : "Загрузите аудио, видео или текст встречи."}
                action={
                  !transcriptions.length && canUpload ? (
                    <Link to="/upload" className="btn-primary">
                      <Upload className="h-4 w-4" /> Загрузить запись
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <div className="space-y-2">
                {shownTr.map((t) => (
                  <TranscriptionRow
                    key={t.id}
                    t={t}
                    picked={sel.transcriptionIds.includes(t.id)}
                    canDelete={canDelTr}
                    onToggle={() => sel.toggleTranscription(t.id)}
                    onDelete={() => delTr.mutate(t.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle
              count={shownPr.length}
              action={
                shownPr.length > 0 && (
                  <SelectAll
                    picked={allPrPicked}
                    onToggle={() =>
                      shownPr.forEach((p) => {
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
            {!shownPr.length ? (
              <Empty
                icon={FileText}
                title={protocols.length ? "Ничего не найдено" : "Нет протоколов"}
                hint={protocols.length ? "Измените фильтр по названию." : "Откройте запись и сформируйте протокол."}
              />
            ) : (
              <div className="space-y-2">
                {shownPr.map((p) => (
                  <ProtocolRow
                    key={p.id}
                    p={p}
                    picked={sel.protocolIds.includes(p.id)}
                    canDelete={canDelPr}
                    onToggle={() => sel.toggleProtocol(p.id)}
                    onDelete={() => delPr.mutate(p.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
        </>
      )}
    </div>
  );
}

/** Экранирование спецсимволов regex для подсветки. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Слова запроса (>2 символов, с поддержкой кириллицы) для подсветки совпадений. */
function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);
}

/** Подсветить слова запроса в тексте фрагмента (без dangerouslySetInnerHTML). */
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = queryTerms(query);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "giu");
  // split с захватывающей группой: совпадения — на нечётных индексах.
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-accent/25 px-0.5 text-fg">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Ссылка на запись с перемоткой на найденный фрагмент (?t=<секунды> или ?frag=<текст>). */
function hitHref(hit: SearchHit): string {
  const suffix =
    hit.start != null ? `?t=${Math.floor(hit.start)}` : hit.fragment ? `?frag=${encodeURIComponent(hit.fragment)}` : "";
  return `/transcriptions/${hit.transcription_id}${suffix}`;
}

function kindIcon(kind: string) {
  if (kind === "video") return Video;
  if (kind === "text") return Type;
  return AudioLines;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function TranscriptionRow({
  t,
  picked,
  canDelete,
  onToggle,
  onDelete,
}: {
  t: TranscriptionListItem;
  picked: boolean;
  canDelete: boolean;
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
      {canDelete && (
        <DeleteBtn
          title="Удалить запись?"
          description={`Будут удалены запись «${t.filename}», а также все связанные с ней протоколы и поручения. Действие необратимо.`}
          onConfirm={onDelete}
        />
      )}
    </div>
  );
}

function ProtocolRow({
  p,
  picked,
  canDelete,
  onToggle,
  onDelete,
}: {
  p: ProtocolListItem;
  picked: boolean;
  canDelete: boolean;
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
      <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      {canDelete && (
        <DeleteBtn
          title="Удалить протокол?"
          description={`Будут удалены протокол «${p.title || "Без названия"}» и ${p.tasks_count} ${plural(
            p.tasks_count,
            "поручение",
            "поручения",
            "поручений",
          )}. Действие необратимо.`}
          onConfirm={onDelete}
        />
      )}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tint =
    status === "done"
      ? "bg-success/15 text-success"
      : status === "error"
        ? "bg-danger/15 text-danger"
        : "bg-warning/15 text-warning";
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

function DeleteBtn({
  title,
  description,
  onConfirm,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
        title="Удалить"
        aria-label={title}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <ConfirmDialog
          title={title}
          description={description}
          confirmLabel="Удалить"
          onConfirm={() => {
            onConfirm();
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
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
