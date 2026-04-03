import { create } from 'zustand';

export type ReversePromptModel = 'Qwen3VL' | 'Florence' | 'WD-14' | 'Grok';
export type StartupBehavior = 'restore' | 'new' | 'welcome';

interface SettingsState {
  reversePromptModel: ReversePromptModel;
  startupBehavior: StartupBehavior;
  settingsOpen: boolean;
  setReversePromptModel: (model: ReversePromptModel) => void;
  setStartupBehavior: (behavior: StartupBehavior) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  reversePromptModel: (localStorage.getItem('settings_reversePromptModel') as ReversePromptModel | null) ?? 'Qwen3VL',
  startupBehavior: (localStorage.getItem('settings_startupBehavior') as StartupBehavior | null) ?? 'restore',
  settingsOpen: false,
  setReversePromptModel: (model) => {
    localStorage.setItem('settings_reversePromptModel', model);
    set({ reversePromptModel: model });
  },
  setStartupBehavior: (behavior) => {
    localStorage.setItem('settings_startupBehavior', behavior);
    set({ startupBehavior: behavior });
  },
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
