import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ClipboardPaste, FileAudio, FileText, UploadCloud, X } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { Card, PageHeader, Spinner } from "@/components/ui";
import SystemHealthNotice from "@/components/SystemHealthNotice";

const TEXT_EXTENSIONS = [".txt", ".md", ".srt", ".vtt", ".csv", ".log"];
// Соответствует upload.allowed_extensions в backend/app/config.py.
const MEDIA_EXTENSIONS = [
  ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".opus",
  ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v",
];

function isTextFile(file: File) {
  const name = file.name.toLowerCase();
  return file.type.startsWith("text/") || TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isMediaFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("audio/") ||
    file.type.startsWith("video/") ||
    MEDIA_EXTENSIONS.some((ext) => name.endsWith(ext))
  );
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
  const abortRef = useRef<AbortController | null>(null);

  const uploading = progress !== null && progress < 100;

  // Предупреждаем о потере активной загрузки при уходе со страницы/закрытии вкладки.
  useEffect(() => {
    if (!uploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading]);

  async function uploadMedia(file: File) {
    setError("");
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const t = await api.uploadTranscription(file, setProgress, controller.signal);
      nav(`/transcriptions/${t.id}`);
    } catch (e: any) {
      if (axios.isCancel?.(e) || e?.name === "CanceledError" || e?.code === "ERR_CANCELED") {
        setError("Загрузка отменена.");
      } else {
        setError(e?.message ?? "Ошибка загрузки");
      }
      setProgress(null);
    } finally {
      abortRef.current = null;
    }
  }

  function cancelUpload() {
    abortRef.current?.abort();
  }

  async function handleFile(file: File) {
    if (isTextFile(file)) {
      setError("");
      setMode("text");
      setTitle(file.name.replace(/\.[^.]+$/, ""));
      setText(await file.text());
      return;
    }
    if (!isMediaFile(file)) {
      setMode("media");
      setError(
        `Неподдерживаемый формат «${file.name}». Разрешены аудио/видео: ${MEDIA_EXTENSIONS.join(", ")} — или текстовая расшифровка.`,
      );
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
        icon={UploadCloud}
        title="Новая встреча"
        subtitle="Загрузите запись или добавьте готовую расшифровку для протокола и поручений."
      />

      <SystemHealthNotice />

      <div className="inline-flex rounded-lg border border-border bg-surface p-1 shadow-1" role="tablist" aria-label="Тип загрузки">
        <button
          role="tab"
          aria-selected={mode === "media"}
          className={clsx("btn px-4", mode === "media" ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated")}
          onClick={() => setMode("media")}
        >
          <FileAudio className="h-4 w-4" aria-hidden />
          Запись
        </button>
        <button
          role="tab"
          aria-selected={mode === "text"}
          className={clsx("btn px-4", mode === "text" ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated")}
          onClick={() => setMode("text")}
        >
          <ClipboardPaste className="h-4 w-4" aria-hidden />
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
              <div className="mb-2 flex items-center gap-2 text-sm text-muted" aria-live="polite">
                {progress < 100 ? <Spinner /> : <FileAudio className="h-4 w-4" aria-hidden />}
                <span className="tabular-nums">
                  {progress < 100 ? `Загрузка ${progress}%` : "Запуск распознавания…"}
                </span>
                {uploading && (
                  <button
                    className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-danger/10 hover:text-danger"
                    onClick={cancelUpload}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden /> Отменить
                  </button>
                )}
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-border"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Прогресс загрузки"
              >
                <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {error && mode === "media" && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}
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

          {error && mode === "text" && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
