import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadCloud, FileAudio } from "lucide-react";
import { api } from "@/lib/api";
import { Card, PageHeader, Spinner } from "@/components/ui";

export default function UploadPage() {
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function upload(file: File) {
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

  return (
    <div>
      <PageHeader
        title="Загрузка записи"
        subtitle="Аудио или видео встречи. Распознавание речи — через OpenRouter (Gemini), с тайм-кодами и спикерами."
      />

      <Card>
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
            if (f) upload(f);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl2 border-2 border-dashed py-16 transition-colors ${
            drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/60"
          }`}
        >
          <div className="grid h-14 w-14 place-items-center rounded-full bg-accent/10 text-accent">
            <UploadCloud className="h-7 w-7" />
          </div>
          <p className="mt-4 font-medium">Перетащите файл сюда или нажмите</p>
          <p className="mt-1 text-sm text-muted">mp3, wav, m4a, mp4, mov, mkv …</p>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
        </div>

        {progress !== null && (
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted">
              {progress < 100 ? <Spinner /> : <FileAudio className="h-4 w-4" />}
              {progress < 100 ? `Загрузка ${progress}%` : "Запуск распознавания…"}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-rose-500">{error}</p>}
      </Card>
    </div>
  );
}
