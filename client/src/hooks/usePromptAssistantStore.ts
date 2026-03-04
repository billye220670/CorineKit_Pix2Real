import { create } from 'zustand';

export type PromptMode = 'convert' | 'variations' | 'detailer' | 'nextScene' | 'storyboarder' | 'tagAssemble';

interface PromptAssistantStore {
  isOpen: boolean;
  activeMode: PromptMode;
  initialText: string;
  sessionKey: number;
  openPanel: (opts?: { initialText?: string }) => void;
  closePanel: () => void;
  setMode: (mode: PromptMode) => void;
}

export const usePromptAssistantStore = create<PromptAssistantStore>((set) => ({
  isOpen: false,
  activeMode: 'convert',
  initialText: '',
  sessionKey: 0,

  openPanel: (opts?) =>
    set((state) => ({
      isOpen: true,
      initialText: opts?.initialText || '',
      activeMode: 'convert',
      sessionKey: state.sessionKey + 1,
    })),

  closePanel: () => set({ isOpen: false }),

  setMode: (mode) => set({ activeMode: mode }),
}));
