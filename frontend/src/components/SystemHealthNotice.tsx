import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

/** Онбординг по состоянию системы: если ключевые сервисы не настроены И записей ещё
 *  нет, показываем человекочитаемую карточку «Что не настроено». Данные уже есть в
 *  /api/health — не хватало только UI. MAX/execution-control не показываем:
 *  они опциональны по дизайну. */
export default function SystemHealthNotice() {
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health });
  const { data: transcriptions } = useQuery({ queryKey: ["transcriptions"], queryFn: () => api.listTranscriptions() });

  if (!health || !transcriptions) return null;
  if (transcriptions.length > 0) return null; // онбординг — только на пустой системе

  const problems = [
    !health.openrouter &&
      "Распознавание речи недоступно: не задан ключ OpenRouter — загрузка аудио/видео будет падать.",
    !health.ffmpeg && "Обработка медиа недоступна: не найден ffmpeg — конвертация аудио/видео не сработает.",
    !health.dify_app &&
      "Протоколы и вопросы недоступны: не настроен Dify — генерация протокола и Q&A вернут пусто.",
    !health.dify_dataset &&
      "Семантический поиск ограничен: не задан датасет Dify — поиск по смыслу не будет работать.",
  ].filter(Boolean) as string[];

  if (problems.length === 0) return null;

  return (
    <div role="status" aria-live="polite" className="rounded-xl2 border border-warning/30 bg-warning/10 p-4 text-fg">
      <div className="mb-2 flex items-center gap-2 font-semibold text-warning">
        <AlertTriangle className="h-4 w-4" aria-hidden /> Что не настроено
      </div>
      <ul className="space-y-1.5 text-sm">
        {problems.map((p, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden>•</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        Заполните ключи в <code className="font-mono">backend/config.yaml</code> (см. README, раздел
        «Configuration») и перезапустите сервер.
      </p>
    </div>
  );
}
