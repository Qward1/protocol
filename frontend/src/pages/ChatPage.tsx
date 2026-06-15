import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Send, Quote, SlidersHorizontal } from "lucide-react";
import { api, type Citation } from "@/lib/api";
import { Card, PageHeader, Spinner, Badge } from "@/components/ui";
import ExportMenu from "@/components/ExportMenu";
import { useSelection } from "@/store/selection";

interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

export default function ChatPage() {
  const sel = useSelection();
  const { data: lib } = useQuery({ queryKey: ["library"], queryFn: api.library });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, loading]);

  const scopeCount = sel.protocolIds.length + sel.transcriptionIds.length;

  async function send() {
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: question }]);
    setLoading(true);
    try {
      const res = await api.ask(
        question,
        { protocol_ids: sel.protocolIds, transcription_ids: sel.transcriptionIds },
        sessionId,
      );
      setSessionId(res.session_id);
      setMessages((m) => [...m, { role: "assistant", content: res.answer, citations: res.citations }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Ошибка запроса к ассистенту." }]);
    } finally {
      setLoading(false);
    }
  }

  const scopeTitles = [
    ...sel.transcriptionIds.map((id) => lib?.transcriptions.find((t) => t.id === id)?.filename),
    ...sel.protocolIds.map((id) => lib?.protocols.find((p) => p.id === id)?.title),
  ].filter(Boolean);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader
        title="Вопросы по записям и протоколам"
        subtitle="Ответы только на основе выбранного контекста, с указанием источников."
        actions={
          sessionId && <ExportMenu objectType="chat" objectId={sessionId} name="chat" />
        }
      />

      {/* Выбранный scope */}
      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <SlidersHorizontal className="h-4 w-4 text-muted" />
          {scopeCount === 0 ? (
            <span className="text-muted">
              Контекст не выбран —{" "}
              <Link to="/library" className="text-accent hover:underline">
                выберите в Библиотеке
              </Link>{" "}
              (иначе вопрос уйдёт без привязки).
            </span>
          ) : (
            <>
              {scopeTitles.map((t, i) => (
                <Badge key={i}>{t}</Badge>
              ))}
              <button className="text-xs text-muted hover:text-fg" onClick={sel.clear}>
                очистить
              </button>
            </>
          )}
        </div>
      </Card>

      {/* Лента сообщений */}
      <Card className="flex-1 space-y-4 overflow-y-auto">
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            Задайте вопрос по выбранным записям, например: «Какие поручения дали Иванову и в какой срок?»
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[80%] rounded-xl2 px-4 py-2.5 text-sm ${
                m.role === "user" ? "bg-accent text-accent-fg" : "border border-border bg-elevated"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.citations && m.citations.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                  {m.citations.map((c, j) => (
                    <Link
                      key={j}
                      to={c.source_type === "protocol" ? `/protocols/${c.source_id}` : `/transcriptions/${c.source_id}`}
                      className="flex items-center gap-1 text-xs text-muted hover:text-accent"
                    >
                      <Quote className="h-3 w-3" /> {c.title || c.source_id}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Ассистент думает…
          </div>
        )}
        <div ref={endRef} />
      </Card>

      {/* Поле ввода */}
      <div className="mt-3 flex gap-2">
        <input
          className="input"
          placeholder="Ваш вопрос…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn-primary" onClick={send} disabled={loading}>
          <Send className="h-4 w-4" />
          Спросить
        </button>
      </div>
    </div>
  );
}
