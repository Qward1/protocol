import { TASK_PRIORITY } from "@/lib/api";
import { TASK_STATUS } from "@/lib/api";

/** Токенизация с поддержкой кириллицы (\w в JS не включает кириллицу — режем по не-буквам). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);
}

/** Индекс сегмента с максимальным пересечением слов с фрагментом (аналог qa._best_segment).
 *  Используется для jump-to-fragment, когда точного таймкода нет — только текст фрагмента. */
export function bestSegmentIndex(segments: { text: string }[], fragment: string): number {
  const needle = new Set(tokenize(fragment));
  if (needle.size === 0) return -1;
  let best = -1;
  let bestScore = 0;
  segments.forEach((seg, i) => {
    let score = 0;
    for (const w of tokenize(seg.text)) if (needle.has(w)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const h = Math.floor(m / 60);
  const mm = (h > 0 ? m % 60 : m).toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${sec.toString().padStart(2, "0")}` : `${mm}:${sec.toString().padStart(2, "0")}`;
}

/** Разобрать наивный UTC-datetime от бэкенда в Date.
 *  Бэкенд отдаёт время без суффикса зоны (напр. «2026-07-19T09:00:00»), а
 *  new Date() трактует такую строку как локальное время. Дописываем «Z», если
 *  смещение/зона не указаны, чтобы дата не «уезжала» на таймзону. */
export function parseBackendDate(iso: string): Date {
  const normalized = /([+-]\d\d:?\d\d|Z)$/.test(iso) ? iso : `${iso}Z`;
  return new Date(normalized);
}

export function fmtDate(iso: string): string {
  try {
    return parseBackendDate(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** Категориальный тон для аватаров/меток спикеров (декоративный, не семантика).
 *  Единая функция вместо дублей avatarTint (ui.tsx) и speakerColor.
 *  Оттенок берётся из фиксированного набора «спокойных» hue; светлота/насыщенность
 *  подобраны так, чтобы мягкая заливка и текст читались в обеих темах без dark:-веток. */
const PERSON_HUES = [222, 158, 32, 350, 265, 190];

export function personTint(name: string): { backgroundColor: string; color: string } {
  const trimmed = (name || "").trim();
  if (!trimmed) return { backgroundColor: "rgb(var(--border))", color: "rgb(var(--muted))" };
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0;
  const h = PERSON_HUES[hash % PERSON_HUES.length];
  // light-dark() следует за `color-scheme` (задан в :root/.dark), поэтому текст
  // остаётся читаемым в обеих темах без dark:-веток. Заливка — мягкий тон над surface.
  return {
    backgroundColor: `hsl(${h} 48% 50% / 0.16)`,
    color: `light-dark(hsl(${h} 58% 38%), hsl(${h} 70% 74%))`,
  };
}

/** Оформление приоритета поручения (чип/точка) + флаг «повышенный» для подсветки.
 *  Семантические токены, без ручных dark:-веток. «Высокий»/«Критический» —
 *  elevated (подсветка 4.5.4 и условие рейтинга done_priority). */
export function priorityMeta(priority: string): { elevated: boolean; tint: string; dot: string } {
  switch (priority) {
    case TASK_PRIORITY.critical:
      return { elevated: true, tint: "bg-danger/15 text-danger", dot: "bg-danger" };
    case TASK_PRIORITY.high:
      return { elevated: true, tint: "bg-warning/15 text-warning", dot: "bg-warning" };
    case TASK_PRIORITY.low:
      return { elevated: false, tint: "bg-elevated text-muted", dot: "bg-border" };
    default: // «Обычный» или пусто — нейтрально
      return { elevated: false, tint: "bg-elevated text-muted", dot: "bg-muted" };
  }
}

/** Баллы рейтинга: целые — без дробной части, иначе один знак; со знаком «+». */
export function fmtPoints(points: number): string {
  const rounded = Math.round(points * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return rounded > 0 ? `+${text}` : text;
}

export function statusColor(status: string): string {
  switch (status) {
    case TASK_STATUS.done:
      return "bg-success/15 text-success";
    case TASK_STATUS.review:
      return "bg-warning/15 text-warning";
    default:
      return "bg-info/15 text-info";
  }
}

/** Цвет «точки»/левой полосы статуса (для карточек поручений). */
export function statusDot(status: string): string {
  switch (status) {
    case TASK_STATUS.done:
      return "bg-success";
    case TASK_STATUS.review:
      return "bg-warning";
    default:
      return "bg-info";
  }
}

const DEADLINE_FORMATS: ((v: string) => Date | null)[] = [
  (v) => {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 23), +(m[5] ?? 59)) : null;
  },
  (v) => {
    const m = v.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})(?:[ T](\d{2}):(\d{2}))?/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 23), +(m[5] ?? 59)) : null;
  },
];

/** Разобранный момент срока: приоритет — deadline_at (наивный UTC с бэкенда),
 *  фоллбэк — эвристический разбор свободной строки. null, если распознать нельзя. */
export function deadlineDate(deadline: string, deadlineAt?: string | null): Date | null {
  if (deadlineAt) {
    const d = parseBackendDate(deadlineAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (!deadline) return null;
  for (const parse of DEADLINE_FORMATS) {
    const d = parse(deadline.trim());
    if (d && !Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Оттенок срочности срока. Использует deadline_at, если он есть; иначе — строку. */
export function deadlineUrgency(
  deadline: string,
  status: string,
  deadlineAt?: string | null,
): "none" | "ok" | "soon" | "overdue" {
  if (status === TASK_STATUS.done) return "none";
  const date = deadlineDate(deadline, deadlineAt);
  if (!date) return "none";
  const days = (date.getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "overdue";
  if (days <= 2) return "soon";
  return "ok";
}

/** Разобрать строку срока в значения для нативных <input type="date"/"time">.
 *  Пустые поля, если распознать нельзя. */
export function deadlineToInputs(deadline: string): { date: string; time: string } {
  const raw = (deadline || "").trim();
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : "" };
  m = raw.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    return { date: `${m[3]}-${mo}-${dd}`, time: m[4] ? `${m[4]}:${m[5]}` : "" };
  }
  return { date: "", time: "" };
}

/** Собрать каноничную строку срока «ДД.ММ.ГГГГ [ЧЧ:ММ]» из значений date/time-пикеров. */
export function inputsToDeadline(date: string, time: string): string {
  if (!date) return "";
  const [y, mo, d] = date.split("-");
  const base = `${d}.${mo}.${y}`;
  return time ? `${base} ${time}` : base;
}

export function deadlineColor(urgency: ReturnType<typeof deadlineUrgency>): string {
  switch (urgency) {
    case "overdue":
      return "text-danger";
    case "soon":
      return "text-warning";
    default:
      return "text-muted";
  }
}
