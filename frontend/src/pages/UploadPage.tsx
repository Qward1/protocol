import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardPaste, FileAudio, FileText, UploadCloud } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { Card, PageHeader, Spinner } from "@/components/ui";

const TEXT_EXTENSIONS = [".txt", ".md", ".srt", ".vtt", ".csv", ".log"];

function isTextFile(file: File) {
  const name = file.name.toLowerCase();
  return file.type.startsWith("text/") || TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export default function UploadPage() {
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [mode, setMode] = useState<"media" | "text">("media");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [savingText, setSavingText] = useState(false);
  const [error, setError] = useState("");

  async function uploadMedia(file: File) {
    setError("");
    setProgress(0);
    try {
      const t = await api.uploadTranscription(file, setProgress);
      nav(`/transcriptions/${t.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Ошибка загрузки");
      setProgress(null);
    }
  }

  async function handleFile(file: File) {
    if (isTextFile(file)) {
      setError("");
      setMode("text");
      setTitle(file.name.replace(/\.[^.]+$/, ""));
      setText(await file.text());
      return;
    }
    await uploadMedia(file);
  }

  async function saveText() {
    const body = text.trim();
    if (!body) {
      setError("Добавьте текст встречи");
      return;
    }
    setError("");
    setSavingText(true);
    try {
      const t = await api.createTextTranscription(title.trim() || "Текст встречи", body);
      nav(`/transcriptions/${t.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Ошибка сохранения текста");
    } finally {
      setSavingText(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Новая встреча"
        subtitle="Загрузите запись или добавьте готовую расшифровку для протокола и поручений."
      />

      <div className="inline-flex rounded-lg border border-border bg-surface p-1 shadow-soft">
        <button
          className={clsx("btn px-4 py-2", mode === "media" ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated")}
          onClick={() => setMode("media")}
        >
          <FileAudio className="h-4 w-4" />
          Запись
        </button>
        <button
          className={clsx("btn px-4 py-2", mode === "text" ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated")}
          onClick={() => setMode("text")}
        >
          <ClipboardPaste className="h-4 w-4" />
          Текст
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className={clsx(mode !== "media" && "opacity-75")}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Аудио или видео</h2>
              <p className="mt-1 text-sm text-muted">mp3, wav, m4a, mp4, mov, mkv</p>
            </div>
            <FileAudio className="h-5 w-5 text-accent" />
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-5 py-12 text-center transition-colors ${
              drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/60"
            }`}
          >
            <div className="grid h-14 w-14 place-items-center rounded-lg bg-accent/10 text-accent">
              <UploadCloud className="h-7 w-7" />
            </div>
            <p className="mt-4 font-medium">Перетащите файл или нажмите для выбора</p>
            <p className="mt-1 max-w-sm text-sm text-muted">
              Текстовые файлы откроются справа, медиа уйдёт на распознавание.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="audio/*,video/*,.txt,.md,.srt,.vtt,.csv,.log"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>

          {progress !== null && (
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-2 text-sm text-muted">
                {progress < 100 ? <Spinner /> : <FileAudio className="h-4 w-4" />}
                {progress < 100 ? `Загрузка ${progress}%` : "Запуск распознавания..."}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-border">
                <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {error && mode === "media" && <p className="mt-4 text-sm text-rose-500">{error}</p>}
        </Card>

        <Card className={clsx(mode !== "text" && "opacity-75")}>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold">Готовая расшифровка</h2>
              <p className="mt-1 text-sm text-muted">Вставьте текст или загрузите текстовый файл.</p>
            </div>
            <button className="btn-ghost shrink-0" onClick={() => textInputRef.current?.click()}>
              <FileText className="h-4 w-4" />
              Файл текста
            </button>
            <input
              ref={textInputRef}
              type="file"
              accept=".txt,.md,.srt,.vtt,.csv,.log,text/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setTitle(f.name.replace(/\.[^.]+$/, ""));
                setText(await f.text());
                setMode("text");
              }}
            />
          </div>

          <div className="grid gap-3">
            <input
              className="input"
              placeholder="Название встречи"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="input min-h-[260px] resize-y leading-6"
              placeholder="[00:00] Иванов: обсудили сроки запуска..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setMode("text")}
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-xs text-muted">
              {text.trim() ? `${text.trim().length.toLocaleString("ru-RU")} знаков` : "Текст не добавлен"}
            </p>
            <button className="btn-primary" onClick={saveText} disabled={savingText || !text.trim()}>
              {savingText ? <Spinner /> : <ClipboardPaste className="h-4 w-4" />}
              Создать транскрипцию
            </button>
          </div>

          {error && mode === "text" && <p className="mt-4 text-sm text-rose-500">{error}</p>}
        </Card>
      </div>
    </div>
  );
}
