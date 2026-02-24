// client/src/hooks/useMaskStore.ts
import { create } from 'zustand';

export interface MaskEntry {
  data: Uint8ClampedArray; // raw RGBA pixels at working resolution
  workingWidth: number;
  workingHeight: number;
  originalWidth: number;
  originalHeight: number;
}

export interface MaskEditorOpenState {
  imageId: string;
  outputIndex: number;       // -1 for Mode A (no output), >= 0 for Mode B
  mode: 'A' | 'B';
  originalUrl: string;
  resultUrl?: string;        // Mode B only — the selected output URL
  resultFilename?: string;   // Mode B only — used for export default name
}

interface MaskStore {
  masks: Record<string, MaskEntry>;
  editorState: MaskEditorOpenState | null;
  setMask: (key: string, entry: MaskEntry) => void;
  deleteMask: (key: string) => void;
  getMask: (key: string) => MaskEntry | undefined;
  openEditor: (state: MaskEditorOpenState) => void;
  closeEditor: () => void;
}

export const useMaskStore = create<MaskStore>((set, get) => ({
  masks: {},
  editorState: null,

  setMask: (key, entry) =>
    set((s) => ({ masks: { ...s.masks, [key]: entry } })),

  deleteMask: (key) =>
    set((s) => {
      const { [key]: _removed, ...rest } = s.masks;
      return { masks: rest };
    }),

  getMask: (key) => get().masks[key],

  openEditor: (state) => set({ editorState: state }),
  closeEditor: () => set({ editorState: null }),
}));
