import { create } from 'zustand';

export type PromptMode = 'convert' | 'variations' | 'detailer' | 'nextScene' | 'storyboarder' | 'tagAssemble';

interface PromptAssistantStore {
  isOpen: boolean;
  activeMode: PromptMode;
  initialText: string;
  openPanel: (opts?: { initialText?: string }) => void;
  closePanel: () => void;
  setMode: (mode: PromptMode) => void;
}

export const usePromptAssistantStore = create<PromptAssistantStore>((set) => ({
  isOpen: false,
  activeMode: 'convert',
  initialText: '',

  openPanel: (opts?) =>
    set({
      isOpen: true,
      initialText: opts?.initialText || '',
      activeMode: 'convert',
    }),

  closePanel: () => set({ isOpen: false }),

  setMode: (mode) => set({ activeMode: mode }),
}));
