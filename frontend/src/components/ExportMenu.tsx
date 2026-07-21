import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { api, downloadBlob, type ExportFmt } from "@/lib/api";
import { Spinner } from "./ui";

const FORMATS: ExportFmt[] = ["docx", "pdf", "md", "txt", "json"];

export default function ExportMenu({
  objectType,
  objectId,
  name,
}: {
  objectType: string;
  objectId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFmt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Escape закрывает и возвращает фокус на кнопку; фокус на первый пункт при открытии.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Стрелочная навигация между пунктами меню.
  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
    items[(next + items.length) % items.length]?.focus();
  }

  async function exportAs(fmt: ExportFmt) {
    setBusy(fmt);
    setError(null);
    try {
      const blob = await api.exportObject(objectType, objectId, fmt);
      downloadBlob(blob, `${name}.${fmt}`);
      setOpen(false);
      btnRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Не удалось выполнить экспорт");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        className="btn-ghost"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download className="h-4 w-4" aria-hidden />
        Экспорт
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Форматы экспорта"
            onKeyDown={onMenuKey}
            className="elevated absolute right-0 z-20 mt-1 w-56 overflow-hidden p-1"
          >
            {FORMATS.map((fmt) => (
              <button
                key={fmt}
                role="menuitem"
                onClick={() => exportAs(fmt)}
                disabled={busy !== null}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-elevated disabled:opacity-50"
              >
                <span className="uppercase">{fmt}</span>
                {busy === fmt && <Spinner />}
              </button>
            ))}
            {error && (
              <p role="alert" className="border-t border-border px-3 py-2 text-xs text-danger">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
