import { useState } from "react";
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

  async function exportAs(fmt: ExportFmt) {
    setBusy(fmt);
    try {
      const blob = await api.exportObject(objectType, objectId, fmt);
      downloadBlob(blob, `${name}.${fmt}`);
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button className="btn-ghost" onClick={() => setOpen((o) => !o)}>
        <Download className="h-4 w-4" />
        Экспорт
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border border-border bg-elevated shadow-soft">
            {FORMATS.map((fmt) => (
              <button
                key={fmt}
                onClick={() => exportAs(fmt)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface"
              >
                <span className="uppercase">{fmt}</span>
                {busy === fmt && <Spinner />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
