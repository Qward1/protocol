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
