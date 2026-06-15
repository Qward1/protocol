import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, FileText, AudioLines, Check, MessagesSquare, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api, type SearchHit } from "@/lib/api";
import { Card, PageHeader, Empty, Spinner, Badge } from "@/components/ui";
import { useSelection } from "@/store/selection";
import { fmtDate } from "@/lib/utils";

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

  return (
    <div>
      <PageHeader
        title="Библиотека"
        subtitle="Историческая память: записи и протоколы. Отметьте нужные и задавайте вопросы."
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
      <Card className="mb-6">
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
            {search.isPending ? <Spinner /> : "Найти"}
          </button>
        </form>

        {search.data && (
          <div className="mt-4 space-y-2">
            {search.data.length === 0 ? (
              <p className="text-sm text-muted">Ничего не найдено.</p>
            ) : (
              search.data.map((hit: SearchHit, i) => (
                <div
                  key={i}
                  className={clsx(
                    "rounded-lg border border-border bg-elevated p-3 text-sm",
                    hit.transcription_id && "cursor-pointer hover:border-accent/50",
                  )}
                  onClick={() => hit.transcription_id && nav(`/transcriptions/${hit.transcription_id}`)}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium">{hit.title || "Запись"}</span>
                    <Badge>score {hit.score.toFixed(2)}</Badge>
                  </div>
                  <p className="text-muted">…{hit.fragment}…</p>
                </div>
              ))
            )}
          </div>
        )}
      </Card>

      {isLoading ? (
        <Spinner className="h-6 w-6" />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Записи</h2>
            {!data?.transcriptions.length ? (
              <Empty title="Нет записей" />
            ) : (
              <div className="space-y-2">
                {data.transcriptions.map((t) => {
                  const picked = sel.transcriptionIds.includes(t.id);
                  return (
                    <Card key={t.id} className="flex items-center gap-3 p-3">
                      <SelectBtn picked={picked} onClick={() => sel.toggleTranscription(t.id)} />
                      <AudioLines className="h-4 w-4 text-muted" />
                      <Link to={`/transcriptions/${t.id}`} className="flex-1 truncate hover:text-accent">
                        {t.filename}
                      </Link>
                      <Badge>{t.status}</Badge>
                      <DeleteBtn onClick={() => delTr.mutate(t.id)} />
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Протоколы</h2>
            {!data?.protocols.length ? (
              <Empty title="Нет протоколов" />
            ) : (
              <div className="space-y-2">
                {data.protocols.map((p) => {
                  const picked = sel.protocolIds.includes(p.id);
                  return (
                    <Card key={p.id} className="flex items-center gap-3 p-3">
                      <SelectBtn picked={picked} onClick={() => sel.toggleProtocol(p.id)} />
                      <FileText className="h-4 w-4 text-muted" />
                      <Link to={`/protocols/${p.id}`} className="flex-1 truncate hover:text-accent">
                        {p.title || "Без названия"}
                      </Link>
                      <span className="text-xs text-muted">{fmtDate(p.created_at)}</span>
                      <DeleteBtn onClick={() => delPr.mutate(p.id)} />
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        if (confirm("Удалить безвозвратно?")) onClick();
      }}
      className="rounded-md p-1.5 text-muted hover:bg-rose-500/10 hover:text-rose-500"
      title="Удалить"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function SelectBtn({ picked, onClick }: { picked: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors",
        picked ? "border-accent bg-accent text-accent-fg" : "border-border hover:border-accent",
      )}
    >
      {picked && <Check className="h-3.5 w-3.5" />}
    </button>
  );
}
