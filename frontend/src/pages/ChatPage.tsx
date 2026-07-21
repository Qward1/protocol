import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Send, Quote, SlidersHorizontal, MessagesSquare, AudioLines, FileText, Plus, History } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, type Citation } from "@/lib/api";
import { Card, PageHeader, Spinner, Badge } from "@/components/ui";
import ExportMenu from "@/components/ExportMenu";
import { useSelection } from "@/store/selection";

marked.setOptions({ breaks: true, gfm: true });

/** Ответы ассистента — markdown от LLM. Рендерим через marked и обязательно
 *  санируем DOMPurify перед вставкой (защита от XSS в dangerouslySetInnerHTML). */
function renderMarkdown(text: string): string {
  try {
    return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  } catch {
    // Не роняем страницу на пат-входе от LLM — показываем безопасный текст.
    return DOMPurify.sanitize(text);
  }
}

// Последняя сессия чата — чтобы предложить продолжить разговор после перезахода.
const SESSION_KEY = "do_last_session";

interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

/** Ссылка на источник цитаты: протокол — как есть; запись — с перемоткой на фрагмент
 *  (?t=<секунды>, если бэкенд отдал start; иначе ?frag=<текст> — ищем сегмент по словам). */
function citationHref(c: Citation): string {
  if (c.source_type === "protocol") return `/protocols/${c.source_id}`;
  const suffix =
    c.start != null
      ? `?t=${Math.floor(c.start)}`
      : c.fragment
        ? `?frag=${encodeURIComponent(c.fragment)}`
        : "";
  return `/transcriptions/${c.source_id}${suffix}`;
}

export default function ChatPage() {
  const sel = useSelection();
  const { data: lib } = useQuery({ queryKey: ["library"], queryFn: api.library });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [resumeId, setResumeId] = useState<string | null>(() => sessionStorage.getItem(SESSION_KEY));
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, loading]);

  // Запоминаем последнюю сессию, чтобы её можно было продолжить после перезахода.
  useEffect(() => {
    if (sessionId) sessionStorage.setItem(SESSION_KEY, sessionId);
  }, [sessionId]);

  async function resume() {
    if (!resumeId) return;
    try {
      const h = await api.getSession(resumeId);
      setMessages(h.messages.map((m) => ({ role: m.role, content: m.content, citations: m.citations })));
      setSessionId(h.session_id);
    } catch {
      sessionStorage.removeItem(SESSION_KEY); // сессия удалена
    }
    setResumeId(null);
  }

  function newDialog() {
    setMessages([]);
    setSessionId(undefined);
    setResumeId(null);
    sessionStorage.removeItem(SESSION_KEY);
  }

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
    } catch (err) {
      // Интерсептор в api.ts достаёт detail с бэкенда — показываем причину.
      const message = err instanceof Error && err.message ? err.message : "Ошибка запроса к ассистенту.";
      setMessages((m) => [...m, { role: "assistant", content: message }]);
    } finally {
      setLoading(false);
    }
  }

  const scopeTitles = [
    ...sel.transcriptionIds.map((id) => lib?.transcriptions.find((t) => t.id === id)?.filename),
    ...sel.protocolIds.map((id) => lib?.protocols.find((p) => p.id === id)?.title),
  ].filter(Boolean);

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] w-full max-w-4xl flex-col lg:h-[calc(100dvh-6rem)]">
      <PageHeader
        icon={MessagesSquare}
        title="Вопросы по записям и протоколам"
        subtitle="Ответы только на основе выбранного контекста, с указанием источников."
        actions={
          <div className="flex items-center gap-2">
            {(messages.length > 0 || sessionId) && (
              <button className="btn-ghost" onClick={newDialog} title="Начать новый разговор">
                <Plus className="h-4 w-4" /> Новый диалог
              </button>
            )}
            {sessionId && <ExportMenu objectType="chat" objectId={sessionId} name="chat" />}
          </div>
        }
      />

      {/* Выбранный scope */}
      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <SlidersHorizontal className="h-4 w-4 text-muted" />
          {scopeCount === 0 ? (
            <div className="flex w-full flex-col gap-2">
              <span className="text-muted">
                Контекст не выбран —{" "}
                <Link to="/library" className="text-accent hover:underline">
                  выберите в Библиотеке
                </Link>{" "}
                или добавьте быстро:
              </span>
              {(!!lib?.transcriptions.length || !!lib?.protocols.length) && (
                <div className="flex flex-wrap gap-1.5">
                  {lib?.transcriptions.slice(0, 5).map((t) => (
                    <button
                      key={t.id}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2.5 py-1 text-xs transition-colors hover:border-accent/50"
                      onClick={() => sel.setSingle("transcription", t.id)}
                    >
                      <AudioLines className="h-3 w-3 shrink-0 text-muted" />
                      <span className="max-w-[11rem] truncate">{t.filename}</span>
                    </button>
                  ))}
                  {lib?.protocols.slice(0, 5).map((p) => (
                    <button
                      key={p.id}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2.5 py-1 text-xs transition-colors hover:border-accent/50"
                      onClick={() => sel.setSingle("protocol", p.id)}
                    >
                      <FileText className="h-3 w-3 shrink-0 text-muted" />
                      <span className="max-w-[11rem] truncate">{p.title || "Без названия"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
          <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
            <div className="icon-box h-14 w-14">
              <MessagesSquare className="h-7 w-7" />
            </div>
            <p className="max-w-md text-sm text-muted">
              Задайте вопрос по выбранным записям, например:
              <br />
              <span className="text-fg">«Какие поручения дали Иванову и в какой срок?»</span>
            </p>
            {resumeId && !sessionId && (
              <button className="btn-soft" onClick={resume}>
                <History className="h-4 w-4" /> Продолжить прошлый разговор
              </button>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[80%] animate-pop-in rounded-xl2 px-4 py-2.5 text-sm ${
                m.role === "user" ? "bg-accent text-accent-fg" : "border border-border bg-elevated"
              }`}
            >
              {m.role === "assistant" ? (
                <div className="chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
              {m.citations && m.citations.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                  {m.citations.map((c, j) => (
                    <Link
                      key={j}
                      to={citationHref(c)}
                      className="flex items-center gap-1 text-xs text-muted hover:text-accent"
                    >
                      <Quote className="h-3 w-3" aria-hidden /> {c.title || c.source_id}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <Spinner /> Ассистент думает…
          </div>
        )}
        <div ref={endRef} />
      </Card>

      {/* Поле ввода */}
      <div className="mt-3 flex gap-2">
        <input
          className="input"
          type="text"
          enterKeyHint="send"
          aria-label="Ваш вопрос"
          placeholder="Ваш вопрос…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Не отправлять недописанное во время ввода через IME (composition).
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
        />
        <button className="btn-primary" onClick={send} disabled={loading}>
          <Send className="h-4 w-4" aria-hidden />
          Спросить
        </button>
      </div>
    </div>
  );
}
