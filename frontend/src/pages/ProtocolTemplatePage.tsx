import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileCog, Upload, Check, Star, FileText, Save } from "lucide-react";
import clsx from "clsx";
import {
  api,
  PROTOCOL_CANONICAL_FIELDS,
  type ProtocolCanonicalField,
  type ProtocolTemplate,
} from "@/lib/api";
import { PageHeader, Card, SectionTitle, Empty, Spinner, Skeleton, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

// Человеческие подписи канонических полей (значения — из PROTOCOL_CANONICAL_FIELDS).
const FIELD_LABELS: Record<ProtocolCanonicalField, string> = {
  title: "Заголовок",
  date: "Дата",
  number: "Номер",
  body: "Текст протокола",
  tasks: "Список поручений (цикл)",
};

/** Инвертировать field_mapping ({поле: плейсхолдер}) в {плейсхолдер: поле}. */
function invertMapping(mapping: Record<string, string>): Record<string, string> {
  const byPlaceholder: Record<string, string> = {};
  for (const [field, placeholder] of Object.entries(mapping)) {
    byPlaceholder[placeholder] = field;
  }
  return byPlaceholder;
}

export default function ProtocolTemplatePage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0); // сброс <input type=file> после загрузки
  const [error, setError] = useState("");

  const activeQuery = useQuery({
    queryKey: ["protocol-template-active"],
    queryFn: api.getActiveProtocolTemplate,
    retry: false, // 404 = активного шаблона ещё нет
  });
  const listQuery = useQuery({
    queryKey: ["protocol-templates"],
    queryFn: api.listProtocolTemplates,
  });

  const active = activeQuery.isError ? null : activeQuery.data ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["protocol-template-active"] });
    qc.invalidateQueries({ queryKey: ["protocol-templates"] });
  };

  const upload = useMutation({
    mutationFn: () => api.uploadProtocolTemplate(file as File),
    onSuccess: () => {
      setFile(null);
      setFileKey((k) => k + 1);
      setError("");
      invalidate();
    },
    onError: (e: any) => setError(e?.message ?? "Не удалось загрузить шаблон"),
  });

  const activate = useMutation({
    mutationFn: (id: string) => api.activateProtocolTemplate(id),
    onSuccess: invalidate,
    onError: (e: any) => setError(e?.message ?? "Не удалось активировать шаблон"),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileCog}
        title="Шаблон протокола"
        subtitle="Word-шаблон (.docx) с плейсхолдерами. По нему экспортируется DOCX протокола."
      />

      {/* Загрузка нового шаблона */}
      <Card className="space-y-3">
        <SectionTitle>Загрузить шаблон</SectionTitle>
        <p className="max-w-2xl text-sm text-muted">
          Вставьте в документ плейсхолдеры прямо в текст: <code>{"{{ title }}"}</code>,{" "}
          <code>{"{{ date }}"}</code>, <code>{"{{ number }}"}</code>, <code>{"{{ body }}"}</code> и цикл{" "}
          <code>{"{% for t in tasks %}…{{ t.assignment }}…{% endfor %}"}</code>. После загрузки шаблон
          становится активным, а поля сопоставляются автоматически.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            key={fileKey}
            type="file"
            accept=".docx"
            aria-label="Файл шаблона .docx"
            className="input max-w-md file:mr-3 file:rounded-md file:border-0 file:bg-accent/12 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-accent"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            className="btn-primary"
            disabled={!file || upload.isPending}
            onClick={() => upload.mutate()}
          >
            {upload.isPending ? <Spinner /> : <Upload className="h-4 w-4" />} Загрузить
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </Card>

      {/* Сопоставление полей активного шаблона */}
      {activeQuery.isLoading ? (
        <Card className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </Card>
      ) : !active ? (
        <Empty
          icon={FileText}
          title="Активный шаблон не загружен"
          hint="Загрузите .docx выше — при экспорте протокола в DOCX будет использован обычный формат."
        />
      ) : (
        <MappingCard key={active.id} template={active} onSaved={invalidate} onError={setError} />
      )}

      {/* История версий */}
      <div>
        <SectionTitle count={listQuery.data?.length}>Версии шаблона</SectionTitle>
        {listQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : !listQuery.data?.length ? (
          <Empty icon={FileCog} title="Шаблоны ещё не загружались" />
        ) : (
          <div className="space-y-2">
            {listQuery.data.map((t) => (
              <div key={t.id} className="card flex flex-wrap items-center gap-3 p-4">
                <FileText className="h-5 w-5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{t.name || "Без названия"}</span>
                    {t.is_active && (
                      <Badge className="border-transparent bg-success/15 text-success">Активный</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    {t.detected_placeholders.length} плейсхолдеров · загружен {fmtDate(t.created_at)}
                  </div>
                </div>
                {!t.is_active && (
                  <button
                    className="btn-soft shrink-0"
                    disabled={activate.isPending}
                    onClick={() => {
                      setError("");
                      activate.mutate(t.id);
                    }}
                  >
                    <Star className="h-4 w-4" /> Сделать активным
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Таблица «плейсхолдер → каноническое поле» для активного шаблона. */
function MappingCard({
  template,
  onSaved,
  onError,
}: {
  template: ProtocolTemplate;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  // Состояние по плейсхолдерам: {плейсхолдер: каноническое поле | ""}.
  const initial = useMemo(() => invertMapping(template.field_mapping), [template.field_mapping]);
  const [rows, setRows] = useState<Record<string, string>>(initial);
  useEffect(() => setRows(initial), [initial]);

  const save = useMutation({
    mutationFn: () => {
      // Собираем обратно field_mapping {поле: плейсхолдер}, пропуская несопоставленные.
      const mapping: Record<string, string> = {};
      for (const [placeholder, field] of Object.entries(rows)) {
        if (field) mapping[field] = placeholder;
      }
      return api.updateProtocolTemplateMapping(template.id, mapping);
    },
    onSuccess: onSaved,
    onError: (e: any) => onError(e?.message ?? "Не удалось сохранить сопоставление"),
  });

  const setField = (placeholder: string, field: string) => {
    setRows((prev) => {
      const next = { ...prev };
      // Каждое каноническое поле сопоставляется максимум одному плейсхолдеру.
      if (field) {
        for (const ph of Object.keys(next)) if (next[ph] === field) next[ph] = "";
      }
      next[placeholder] = field;
      return next;
    });
  };

  return (
    <Card className="space-y-4">
      <SectionTitle action={
        <button className="btn-primary h-9 py-1" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Spinner /> : <Save className="h-4 w-4" />} Сохранить сопоставление
        </button>
      }>
        Поля активного шаблона: {template.name}
      </SectionTitle>

      {template.detected_placeholders.length === 0 ? (
        <Empty icon={FileText} title="В шаблоне не найдено плейсхолдеров" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2 pr-4 font-medium">Плейсхолдер</th>
                <th className="py-2 font-medium">Поле протокола</th>
              </tr>
            </thead>
            <tbody>
              {template.detected_placeholders.map((ph) => (
                <tr key={ph} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4">
                    <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[13px]">
                      {`{{ ${ph} }}`}
                    </code>
                  </td>
                  <td className="py-2">
                    <select
                      className={clsx("input h-9 w-auto min-w-52 py-1", !rows[ph] && "text-muted")}
                      value={rows[ph] ?? ""}
                      aria-label={`Поле протокола для плейсхолдера ${ph}`}
                      onChange={(e) => setField(ph, e.target.value)}
                    >
                      <option value="">— не сопоставлено —</option>
                      {PROTOCOL_CANONICAL_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {save.isSuccess && (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" /> Сопоставление сохранено
        </p>
      )}
    </Card>
  );
}
