import { create } from 'zustand';

export type ReversePromptModel = 'Qwen3VL' | 'Florence' | 'WD-14';

interface SettingsState {
  reversePromptModel: ReversePromptModel;
  settingsOpen: boolean;
  setReversePromptModel: (model: ReversePromptModel) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  reversePromptModel: (localStorage.getItem('settings_reversePromptModel') as ReversePromptModel | null) ?? 'Qwen3VL',
  settingsOpen: false,
  setReversePromptModel: (model) => {
    localStorage.setItem('settings_reversePromptModel', model);
    set({ reversePromptModel: model });
  },
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
