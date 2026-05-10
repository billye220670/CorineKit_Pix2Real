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
  desktopNotifyOnComplete: boolean;
  settingsOpen: boolean;
  // 服务端托管的设置
  sessionsBase: string | null;          // 当前生效的 sessions 根目录（绝对路径）
  defaultSessionsBase: string | null;   // 默认 sessions 根目录
  sessionsPathLoaded: boolean;
  setReversePromptModel: (model: ReversePromptModel) => void;
  setLlmModel: (model: LlmModel) => void;
  setStartupBehavior: (behavior: StartupBehavior) => void;
  setDropdownMenuStyle: (style: DropdownMenuStyle) => void;
  setDesktopNotifyOnComplete: (enabled: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
  // 会话路径相关
  loadSessionsPath: () => Promise<void>;
  updateSessionsPath: (value: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  reversePromptModel: (localStorage.getItem('settings_reversePromptModel') as ReversePromptModel | null) ?? 'Qwen3VL',
  llmModel: (localStorage.getItem('settings_llmModel') as LlmModel | null) ?? 'local',
  startupBehavior: (localStorage.getItem('settings_startupBehavior') as StartupBehavior | null) ?? 'restore',
  dropdownMenuStyle: (localStorage.getItem('settings_dropdownMenuStyle') as DropdownMenuStyle | null) ?? 'classic',
  desktopNotifyOnComplete: localStorage.getItem('settings_desktopNotifyOnComplete') !== '0',
  settingsOpen: false,
  sessionsBase: null,
  defaultSessionsBase: null,
  sessionsPathLoaded: false,
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
  setDesktopNotifyOnComplete: (enabled) => {
    localStorage.setItem('settings_desktopNotifyOnComplete', enabled ? '1' : '0');
    set({ desktopNotifyOnComplete: enabled });
  },
  openSettings: () => {
    // 打开面板时若尚未加载 sessions 路径，顺便拉一次
    if (!get().sessionsPathLoaded) {
      void get().loadSessionsPath();
    }
    set({ settingsOpen: true });
  },
  closeSettings: () => set({ settingsOpen: false }),
  loadSessionsPath: async () => {
    try {
      const resp = await fetch('/api/settings');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { sessionsBase: string; defaultSessionsBase: string };
      set({
        sessionsBase: data.sessionsBase,
        defaultSessionsBase: data.defaultSessionsBase,
        sessionsPathLoaded: true,
      });
    } catch (err) {
      console.error('[useSettingsStore] 加载 sessions 路径失败:', err);
      set({ sessionsPathLoaded: true });
    }
  },
  updateSessionsPath: async (value) => {
    try {
      const resp = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionsBase: value }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        return { ok: false, error: typeof data?.error === 'string' ? data.error : `HTTP ${resp.status}` };
      }
      set({
        sessionsBase: data.sessionsBase,
        defaultSessionsBase: data.defaultSessionsBase,
        sessionsPathLoaded: true,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
}));
