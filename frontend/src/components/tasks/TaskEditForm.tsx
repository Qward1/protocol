import { AlertTriangle, Save, X } from "lucide-react";
import { Spinner } from "@/components/ui";
import { TASK_PRIORITIES } from "@/lib/api";
import { deadlineDate, deadlineToInputs, inputsToDeadline } from "@/lib/utils";
import { STATUS_OPTIONS, type Draft } from "./types";

/** Форма ручной правки поручения (текст, ответственный, направление, срок, статус). */
export function TaskEditForm({
  draft,
  setField,
  onSave,
  onCancel,
  saving,
}: {
  draft: Draft;
  setField: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-3">
      <textarea
        className="input min-h-20 resize-y font-medium"
        value={draft.assignment}
        onChange={(e) => setField("assignment", e.target.value)}
        placeholder="Текст поручения"
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Ответственный">
          <input className="input" value={draft.responsible} onChange={(e) => setField("responsible", e.target.value)} />
        </Field>
        <Field label="Направление">
          <input className="input" value={draft.department} onChange={(e) => setField("department", e.target.value)} />
        </Field>
        <Field label="Срок">
          <DeadlineField value={draft.deadline} onChange={(v) => setField("deadline", v)} />
        </Field>
        <Field label="Статус">
          <select className="input" value={draft.status} onChange={(e) => setField("status", e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Приоритет">
          <select className="input" value={draft.priority} onChange={(e) => setField("priority", e.target.value)}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Локация">
          <input className="input" value={draft.location} onChange={(e) => setField("location", e.target.value)} />
        </Field>
        <Field label="Объект">
          <input className="input" value={draft.object} onChange={(e) => setField("object", e.target.value)} />
        </Field>
        <Field label="Тема">
          <input className="input" value={draft.theme} onChange={(e) => setField("theme", e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>
          <X className="h-4 w-4" /> Отмена
        </button>
        <button className="btn-primary" onClick={onSave} disabled={saving}>
          {saving ? <Spinner /> : <Save className="h-4 w-4" />} Сохранить
        </button>
      </div>
    </div>
  );
}

/** Составное поле срока: нативные date/time-пикеры + свободный текст + бейдж распознавания.
 *  При выборе даты пишем каноничный «ДД.ММ.ГГГГ [ЧЧ:ММ]», который backend разберёт в deadline_at. */
function DeadlineField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { date, time } = deadlineToInputs(value);
  const recognized = deadlineDate(value) !== null;
  const trimmed = value.trim();
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <input
          type="date"
          className="input"
          value={date}
          onChange={(e) => onChange(inputsToDeadline(e.target.value, time))}
          aria-label="Дата срока"
        />
        <input
          type="time"
          className="input w-28 shrink-0"
          value={time}
          disabled={!date}
          onChange={(e) => onChange(inputsToDeadline(date, e.target.value))}
          aria-label="Время срока"
        />
      </div>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="или свободный текст (напр. «до конца недели»)"
      />
      {trimmed &&
        (recognized ? (
          <p className="text-xs font-medium text-success">
            ✓ распознан: {inputsToDeadline(date, time) || trimmed}
          </p>
        ) : (
          <p className="flex items-center gap-1 text-xs font-medium text-warning">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> срок не распознан — напоминание не сработает
          </p>
        ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="section-label mb-1 block">{label}</span>
      {children}
    </label>
  );
}
