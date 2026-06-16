export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const h = Math.floor(m / 60);
  const mm = (h > 0 ? m % 60 : m).toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${sec.toString().padStart(2, "0")}` : `${mm}:${sec.toString().padStart(2, "0")}`;
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

const SPEAKER_COLORS = [
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
];

export function speakerColor(speaker: string): string {
  if (!speaker) return "bg-border text-muted";
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) hash = (hash * 31 + speaker.charCodeAt(i)) >>> 0;
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length];
}

export function statusColor(status: string): string {
  switch (status) {
    case "Выполнено":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
    case "Требует проверки":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-300";
    default:
      return "bg-sky-500/15 text-sky-600 dark:text-sky-300";
  }
}

/** Цвет «точки»/левой полосы статуса (для карточек поручений). */
export function statusDot(status: string): string {
  switch (status) {
    case "Выполнено":
      return "bg-emerald-500";
    case "Требует проверки":
      return "bg-amber-500";
    default:
      return "bg-sky-500";
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

/** Разбирает свободную строку срока и возвращает оттенок срочности. */
export function deadlineUrgency(
  deadline: string,
  status: string,
): "none" | "ok" | "soon" | "overdue" {
  if (!deadline || status === "Выполнено") return "none";
  let date: Date | null = null;
  for (const parse of DEADLINE_FORMATS) {
    date = parse(deadline.trim());
    if (date && !Number.isNaN(date.getTime())) break;
    date = null;
  }
  if (!date) return "none";
  const days = (date.getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "overdue";
  if (days <= 2) return "soon";
  return "ok";
}

export function deadlineColor(urgency: ReturnType<typeof deadlineUrgency>): string {
  switch (urgency) {
    case "overdue":
      return "text-rose-600 dark:text-rose-300";
    case "soon":
      return "text-amber-600 dark:text-amber-300";
    default:
      return "text-muted";
  }
}
