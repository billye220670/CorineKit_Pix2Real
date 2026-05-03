import { create } from 'zustand';

export type ReversePromptModel = 'Qwen3VL' | 'Florence' | 'WD-14' | 'Grok';
export type LlmModel = 'local' | 'grok';
export type StartupBehavior = 'restore' | 'new' | 'welcome';
export type DropdownMenuStyle = 'classic' | 'fast';

interface SettingsState {
  reversePromptModel: ReversePromptModel;
  llmModel: LlmModel;
  startupBehavior: StartupBehavior;
  dropdownMenuStyle: DropdownMenuStyle;
  settingsOpen: boolean;
  setReversePromptModel: (model: ReversePromptModel) => void;
  setLlmModel: (model: LlmModel) => void;
  setStartupBehavior: (behavior: StartupBehavior) => void;
  setDropdownMenuStyle: (style: DropdownMenuStyle) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  reversePromptModel: (localStorage.getItem('settings_reversePromptModel') as ReversePromptModel | null) ?? 'Qwen3VL',
  llmModel: (localStorage.getItem('settings_llmModel') as LlmModel | null) ?? 'local',
  startupBehavior: (localStorage.getItem('settings_startupBehavior') as StartupBehavior | null) ?? 'restore',
  dropdownMenuStyle: (localStorage.getItem('settings_dropdownMenuStyle') as DropdownMenuStyle | null) ?? 'classic',
  settingsOpen: false,
  setReversePromptModel: (model) => {
    localStorage.setItem('settings_reversePromptModel', model);
    set({ reversePromptModel: model });
  },
  setLlmModel: (model) => {
    localStorage.setItem('settings_llmModel', model);
    set({ llmModel: model });
  },
  setStartupBehavior: (behavior) => {
    localStorage.setItem('settings_startupBehavior', behavior);
    set({ startupBehavior: behavior });
  },
  setDropdownMenuStyle: (style) => {
    localStorage.setItem('settings_dropdownMenuStyle', style);
    set({ dropdownMenuStyle: style });
  },
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
