import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SelectionState {
  // Выбранный scope для Q&A (хранится между сессиями).
  protocolIds: string[];
  transcriptionIds: string[];
  toggleProtocol: (id: string) => void;
  toggleTranscription: (id: string) => void;
  clear: () => void;
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
      clear: () => set({ protocolIds: [], transcriptionIds: [] }),
    }),
    { name: "do-selection" },
  ),
);

interface PlayerState {
  // Команда «перемотать на секунду N» для аудиоплеера на странице транскрипта.
  seekTo: number | null;
  requestSeek: (s: number) => void;
  consumeSeek: () => void;
}

export const usePlayer = create<PlayerState>((set) => ({
  seekTo: null,
  requestSeek: (s) => set({ seekTo: s }),
  consumeSeek: () => set({ seekTo: null }),
}));
