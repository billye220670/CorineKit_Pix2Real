import { create } from 'zustand';

export type ReversePromptModel = 'Qwen3VL' | 'Florence' | 'WD-14' | 'Grok';
export type LlmModel = 'local' | 'grok';
export type StartupBehavior = 'restore' | 'new' | 'welcome';
export type DropdownMenuStyle = 'classic' | 'fast';
export type DiceMixPreset = 'preference' | 'balanced' | 'exploration';
/** 随机生成 · 参考图行为：auto=若 sidebar 有参考图则一并使用；none=忽略 sidebar 的参考图 */
export type DiceRefMode = 'auto' | 'none';
/** 随机生成 · 比例模式：manual=跟随 sidebar；auto=由 LLM 为每条 item 建议合适比例 */
export type DiceRatioMode = 'manual' | 'auto';
/** 随机生成 · 内容限制：sfw=强制安全向；mixed=不加约束由 AI 自由发挥；nsfw=倾向成人向 */
export type DiceContentPolicy = 'sfw' | 'mixed' | 'nsfw';
/** 任务执行模式：manual=按数量一次性提交；autoLoop=持续循环直到手动停止 */
export type TaskExecutionMode = 'manual' | 'autoLoop';

interface SettingsState {
  reversePromptModel: ReversePromptModel;
  llmModel: LlmModel;
  startupBehavior: StartupBehavior;
  dropdownMenuStyle: DropdownMenuStyle;
  desktopNotifyOnComplete: boolean;
  diceMixPreset: DiceMixPreset;
  diceRefMode: DiceRefMode;
  diceRatioMode: DiceRatioMode;
  diceContentPolicy: DiceContentPolicy;
  taskExecutionMode: TaskExecutionMode;
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
  setDiceMixPreset: (preset: DiceMixPreset) => void;
  setDiceRefMode: (mode: DiceRefMode) => void;
  setDiceRatioMode: (mode: DiceRatioMode) => void;
  setDiceContentPolicy: (policy: DiceContentPolicy) => void;
  setTaskExecutionMode: (mode: TaskExecutionMode) => void;
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
  diceMixPreset: (() => {
    const v = localStorage.getItem('settings_diceMixPreset');
    return v === 'preference' || v === 'balanced' || v === 'exploration' ? v : 'balanced';
  })(),
  diceRefMode: (() => {
    const v = localStorage.getItem('settings_diceRefMode');
    return v === 'auto' || v === 'none' ? v : 'auto';
  })(),
  diceRatioMode: (() => {
    const v = localStorage.getItem('settings_diceRatioMode');
    return v === 'manual' || v === 'auto' ? v : 'auto';
  })(),
  diceContentPolicy: (() => {
    const v = localStorage.getItem('settings_diceContentPolicy');
    return v === 'sfw' || v === 'mixed' || v === 'nsfw' ? v : 'mixed';
  })(),
  taskExecutionMode: (() => {
    const v = localStorage.getItem('settings_taskExecutionMode');
    return v === 'autoLoop' ? 'autoLoop' : 'manual';
  })(),
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
  setDiceMixPreset: (preset) => {
    localStorage.setItem('settings_diceMixPreset', preset);
    set({ diceMixPreset: preset });
  },
  setDiceRefMode: (mode) => {
    localStorage.setItem('settings_diceRefMode', mode);
    set({ diceRefMode: mode });
  },
  setDiceRatioMode: (mode) => {
    localStorage.setItem('settings_diceRatioMode', mode);
    set({ diceRatioMode: mode });
  },
  setDiceContentPolicy: (policy) => {
    localStorage.setItem('settings_diceContentPolicy', policy);
    set({ diceContentPolicy: policy });
  },
  setTaskExecutionMode: (mode) => {
    localStorage.setItem('settings_taskExecutionMode', mode);
    set({ taskExecutionMode: mode });
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
