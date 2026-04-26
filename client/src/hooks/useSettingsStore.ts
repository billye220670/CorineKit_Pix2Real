import { create } from 'zustand';

export type ReversePromptModel = 'Qwen3VL' | 'Florence' | 'WD-14' | 'Grok';
export type StartupBehavior = 'restore' | 'new' | 'welcome';
export type DropdownMenuStyle = 'classic' | 'fast';

interface SettingsState {
  reversePromptModel: ReversePromptModel;
  startupBehavior: StartupBehavior;
  dropdownMenuStyle: DropdownMenuStyle;
  settingsOpen: boolean;
  setReversePromptModel: (model: ReversePromptModel) => void;
  setStartupBehavior: (behavior: StartupBehavior) => void;
  setDropdownMenuStyle: (style: DropdownMenuStyle) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  reversePromptModel: (localStorage.getItem('settings_reversePromptModel') as ReversePromptModel | null) ?? 'Qwen3VL',
  startupBehavior: (localStorage.getItem('settings_startupBehavior') as StartupBehavior | null) ?? 'restore',
  dropdownMenuStyle: (localStorage.getItem('settings_dropdownMenuStyle') as DropdownMenuStyle | null) ?? 'classic',
  settingsOpen: false,
  setReversePromptModel: (model) => {
    localStorage.setItem('settings_reversePromptModel', model);
    set({ reversePromptModel: model });
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
