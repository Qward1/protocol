import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SelectionState {
  // Выбранный scope для Q&A (хранится между сессиями).
  protocolIds: string[];
  transcriptionIds: string[];
  toggleProtocol: (id: string) => void;
  toggleTranscription: (id: string) => void;
  // Убрать из выборки ID, которых больше нет (после удаления записей/протоколов).
  pruneMissing: (existingProtocolIds: string[], existingTranscriptionIds: string[]) => void;
  clear: () => void;
  // Заменить выборку единственным объектом (сценарий «Спросить по этой записи/протоколу»).
  setSingle: (kind: "protocol" | "transcription", id: string) => void;
}

export const useSelection = create<SelectionState>()(
  persist(
    (set) => ({
      protocolIds: [],
      transcriptionIds: [],
      toggleProtocol: (id) =>
        set((s) => ({
          protocolIds: s.protocolIds.includes(id)
            ? s.protocolIds.filter((x) => x !== id)
            : [...s.protocolIds, id],
        })),
      toggleTranscription: (id) =>
        set((s) => ({
          transcriptionIds: s.transcriptionIds.includes(id)
            ? s.transcriptionIds.filter((x) => x !== id)
            : [...s.transcriptionIds, id],
        })),
      pruneMissing: (existingProtocolIds, existingTranscriptionIds) =>
        set((s) => {
          const pSet = new Set(existingProtocolIds);
          const tSet = new Set(existingTranscriptionIds);
          const protocolIds = s.protocolIds.filter((id) => pSet.has(id));
          const transcriptionIds = s.transcriptionIds.filter((id) => tSet.has(id));
          // Ничего не изменилось — возвращаем прежнее состояние (без ре-рендера).
          if (
            protocolIds.length === s.protocolIds.length &&
            transcriptionIds.length === s.transcriptionIds.length
          ) {
            return s;
          }
          return { protocolIds, transcriptionIds };
        }),
      clear: () => set({ protocolIds: [], transcriptionIds: [] }),
      setSingle: (kind, id) =>
        set(kind === "protocol" ? { protocolIds: [id], transcriptionIds: [] } : { protocolIds: [], transcriptionIds: [id] }),
    }),
    { name: "do-selection" },
  ),
);
