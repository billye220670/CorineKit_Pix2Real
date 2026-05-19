import { create } from 'zustand';

export type ChatMode = 'agent' | 'config_assistant' | 'smart_qa';

/**
 * Agent 面板的 tab 范围。
 * Tab 7 = 快速出图（Stable Diffusion），Tab 9 = ZIT 快出（ZImage）。
 * 两者底层模型/LoRA/提示词类型完全不通用，因此聊天历史、上传图、
 * 当前对话模式都按 tab 严格隔离，不存在"全局"概念。
 */
export type AgentTabId = 7 | 9;

export interface ConfigSnapshot {
  id: string;           // 与消息 ID 绑定
  tabId: number;        // 7 或 9
  config: any;          // Text2ImgConfig | ZitConfig（用 any 避免循环依赖）
  appliedAt: number;
}

interface FavoriteEntry {
  tabId: number;
  favoritedAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  images?: string[];
  actionButton?: {
    label: string;
    tabId: number;
    imageId: string;
  };
  isError?: boolean;
  hidden?: boolean;      // UI 不渲染，仅作为 LLM 上下文
  tabId?: number;        // 跳转目标 Tab
  imageId?: string;      // 跳转目标卡片 ID
  imageIds?: string[];   // 批量模式下每张图片对应的卡片 ID（与 images 一一对应）
  batchResultId?: string; // 批量生成结果消息标识（用于逐张追加更新）
  configAction?: {
    changes: Record<string, any>;  // AI 返回的配置变更
    snapshotId: string;            // 对应快照 ID
    status: 'applied' | 'reverted'; // 当前状态
  };
  conflictAction?: {
    status: 'pending' | 'resolved' | 'ignored';
    resolution?: 'modify_lora' | 'remove_conflict' | 'apply_prompt_only' | 'ignore';
    conflicts: Array<{ model: string; name: string; triggerWords: string; reason: string }>;
    userIntent: string;
    proposedPrompt: string;
    proposedLoras: Array<{ model: string; enabled: boolean; strength: number }>;
    lorasAfterRemoval: Array<{ model: string; enabled: boolean; strength: number }>;
    snapshotId?: string;           // 若已应用，关联配置快照 ID
  };
}

export interface UploadedImage {
  id: string;
  dataUrl: string;
  file?: File;
}

export interface ParsedIntent {
  taskType: 'generate' | 'process';
  workflowId: number;
  workflowName: string;
  prompt: string;
  negativePrompt?: string;
  character?: string;
  pose?: string;
  style?: string;
  quality?: 'fast' | 'high';
  recommendedLoras: Array<{
    model: string;
    strength: number;
  }>;
  recommendedModel?: string;
  parameters?: {
    width?: number;
    height?: number;
    steps?: number;
    cfg?: number;
  };
}

export interface CardDropResult {
  type: 'text2img' | 'img2img';
  tabId: number;
  imageId: string;
  // text2img 时
  config?: {
    prompt: string;
    model?: string;
    loras?: Array<{ model: string; strength: number }>;
    width?: number;
    height?: number;
  };
  // img2img 时
  imageUrl?: string;
}

interface AgentState {
  // Favorites
  favorites: Record<string, FavoriteEntry>;
  setFavorites: (favorites: Record<string, FavoriteEntry>) => void;
  toggleFavorite: (sessionId: string, imageId: string, tabId: number) => void;
  isFavorited: (imageId: string) => boolean;
  loadFavorites: (sessionId: string) => Promise<void>;

  // Dialog state
  isDialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  toggleDialog: () => void;

  // ── 按 tab 严格隔离的状态 ─────────────────────────────────────────────
  /** 当前激活的 agent tab（由 AgentDialog 同步 useWorkflowStore.activeTab 来设置） */
  activeAgentTab: AgentTabId;
  setActiveAgentTab: (tab: AgentTabId) => void;

  /** 按 tab 拆 bucket 的消息历史（持久化在内存，刷新清空） */
  messagesByTab: Record<AgentTabId, ChatMessage[]>;
  /** 按 tab 拆 bucket 的上传图列表 */
  uploadedImagesByTab: Record<AgentTabId, UploadedImage[]>;
  /** 按 tab 拆 bucket 的对话模式（每个 tab 独立记忆上次模式） */
  chatModeByTab: Record<AgentTabId, ChatMode>;

  // ── 当前 tab 对应的扁平访问字段（写时双写、切换时同步，订阅者无感） ──
  messages: ChatMessage[];
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;

  // Execution state（全局，因为 ComfyUI 同时只跑一个工作流）
  isExecuting: boolean;
  executionStatus: string;
  setExecutionStatus: (status: string) => void;
  setIsExecuting: (executing: boolean) => void;

  // Uploaded images（当前 tab 视图）
  uploadedImages: UploadedImage[];
  addUploadedImage: (img: UploadedImage) => void;
  removeUploadedImage: (id: string) => void;
  clearUploadedImages: () => void;

  // Last parsed intent (供 Task 9 工作流执行使用)
  lastIntent: ParsedIntent | null;
  setLastIntent: (intent: ParsedIntent | null) => void;

  // 最近一次生成的输出图片 URL 数组（供链式工作流引用）
  lastOutputImages: string[];
  setLastOutputImages: (images: string[]) => void;

  // Agent 执行状态（Task 9）
  agentExecution: {
    promptId: string;
    workflowId: number;
    tabId: number;
    imageId: string;
    status: 'preparing' | 'executing' | 'complete' | 'error';
    progress: number;
    outputs: Array<{ filename: string; url: string }>;
    error?: string;
    // 批量生成字段
    batchTotal?: number;        // 批量总数
    batchCompleted?: number;    // 已完成数
    allPromptIds?: string[];    // 所有 promptId
    batchOutputs?: string[];    // 逐张收集的输出图片 URL
    allImageIds?: string[];     // 批量模式下所有卡片 ID（与 batchOutputs 一一对应）
    // 生成参数上下文（用于多轮对话）
    generationContext?: {
      prompt: string;
      negativePrompt?: string;
      model: string;
      loras: Array<{ model: string; strength: number }>;
      workflowName: string;
      width?: number;
      height?: number;
      imageName?: string;
    };
  } | null;

  setAgentExecution: (exec: AgentState['agentExecution']) => void;
  updateAgentProgress: (percentage: number) => void;
  completeAgentExecution: (outputs: Array<{ filename: string; url: string }>) => void;
  incrementBatchCompleted: (outputs: string[]) => void;
  failAgentExecution: (error: string) => void;
  clearAgentExecution: () => void;

  // Chat mode
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;

  // Config assistant: 是否允许助理修改 LoRA 列表（关闭后仅修改提示词）
  allowLoraModification: boolean;
  setAllowLoraModification: (allow: boolean) => void;

  // Config snapshots (for config_assistant mode revert)
  configSnapshots: Record<string, ConfigSnapshot>;
  saveConfigSnapshot: (id: string, snapshot: ConfigSnapshot) => void;
  getConfigSnapshot: (id: string) => ConfigSnapshot | undefined;
}

const ALLOW_LORA_MOD_KEY = 'agent_allow_lora_modification';
function loadAllowLoraMod(): boolean {
  try {
    const raw = localStorage.getItem(ALLOW_LORA_MOD_KEY);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

export const useAgentStore = create<AgentState>((set, get) => ({
  favorites: {},

  setFavorites: (favorites) => set({ favorites }),

  toggleFavorite: (sessionId, imageId, tabId) => {
    const current = get().favorites;
    const wasF = imageId in current;
    const next = { ...current };
    if (wasF) {
      delete next[imageId];
    } else {
      next[imageId] = { tabId, favoritedAt: Date.now() };
    }
    set({ favorites: next });
    // Fire-and-forget persist
    fetch('/api/agent/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, imageId, tabId, isFavorited: !wasF }),
    }).catch((err) => console.warn('[AgentStore] Failed to persist favorite:', err));
  },

  isFavorited: (imageId) => imageId in get().favorites,

  loadFavorites: async (sessionId) => {
    try {
      const res = await fetch(`/api/agent/favorites?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = await res.json();
      set({ favorites: data });
    } catch (err) {
      console.warn('[AgentStore] Failed to load favorites:', err);
    }
  },

  // Dialog state
  isDialogOpen: false,
  openDialog: () => set({ isDialogOpen: true }),
  closeDialog: () => set({ isDialogOpen: false }),
  toggleDialog: () => set((s) => ({ isDialogOpen: !s.isDialogOpen })),

  // ── 按 tab 隔离的状态 ──────────────────────────────────────────────
  activeAgentTab: 7,
  messagesByTab: { 7: [], 9: [] },
  uploadedImagesByTab: { 7: [], 9: [] },
  chatModeByTab: { 7: 'agent', 9: 'agent' },

  /**
   * 切换当前 agent tab。把目标 tab bucket 的数据同步到扁平访问字段
   * （messages / uploadedImages / chatMode），让现有订阅 selector 无感切换。
   */
  setActiveAgentTab: (tab) => set((s) => {
    if (s.activeAgentTab === tab) return s;
    return {
      activeAgentTab: tab,
      messages: s.messagesByTab[tab] ?? [],
      uploadedImages: s.uploadedImagesByTab[tab] ?? [],
      chatMode: s.chatModeByTab[tab] ?? 'agent',
    };
  }),

  // Messages（写时双写：bucket + 扁平字段）
  messages: [],
  addMessage: (msg) => set((s) => {
    const tab = s.activeAgentTab;
    const next = [...(s.messagesByTab[tab] ?? []), {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }];
    return {
      messagesByTab: { ...s.messagesByTab, [tab]: next },
      messages: next,
    };
  }),
  updateMessage: (id, updates) => set((s) => {
    const tab = s.activeAgentTab;
    const next = (s.messagesByTab[tab] ?? []).map((m) => m.id === id ? { ...m, ...updates } : m);
    return {
      messagesByTab: { ...s.messagesByTab, [tab]: next },
      messages: next,
    };
  }),
  removeMessage: (id) => set((s) => {
    const tab = s.activeAgentTab;
    const next = (s.messagesByTab[tab] ?? []).filter((m) => m.id !== id);
    return {
      messagesByTab: { ...s.messagesByTab, [tab]: next },
      messages: next,
    };
  }),
  clearMessages: () => set((s) => {
    const tab = s.activeAgentTab;
    return {
      messagesByTab: { ...s.messagesByTab, [tab]: [] },
      messages: [],
    };
  }),

  // Execution state
  isExecuting: false,
  executionStatus: '',
  setExecutionStatus: (status) => set({ executionStatus: status }),
  setIsExecuting: (executing) => set({ isExecuting: executing }),

  // Uploaded images（写时双写：bucket + 扁平字段）
  uploadedImages: [],
  addUploadedImage: (img) => set((s) => {
    const tab = s.activeAgentTab;
    const next = [...(s.uploadedImagesByTab[tab] ?? []), img];
    return {
      uploadedImagesByTab: { ...s.uploadedImagesByTab, [tab]: next },
      uploadedImages: next,
    };
  }),
  removeUploadedImage: (id) => set((s) => {
    const tab = s.activeAgentTab;
    const next = (s.uploadedImagesByTab[tab] ?? []).filter((i) => i.id !== id);
    return {
      uploadedImagesByTab: { ...s.uploadedImagesByTab, [tab]: next },
      uploadedImages: next,
    };
  }),
  clearUploadedImages: () => set((s) => {
    const tab = s.activeAgentTab;
    return {
      uploadedImagesByTab: { ...s.uploadedImagesByTab, [tab]: [] },
      uploadedImages: [],
    };
  }),

  // Last parsed intent
  lastIntent: null,
  setLastIntent: (intent) => set({ lastIntent: intent }),

  // Last output images
  lastOutputImages: [],
  setLastOutputImages: (images) => set({ lastOutputImages: images }),

  // Agent execution state
  agentExecution: null,

  setAgentExecution: (exec) => set({ agentExecution: exec }),

  updateAgentProgress: (percentage) => set((s) => {
    if (!s.agentExecution) return s;
    return { agentExecution: { ...s.agentExecution, status: 'executing', progress: percentage } };
  }),

  completeAgentExecution: (outputs) => set((s) => {
    if (!s.agentExecution) return s;
    return { agentExecution: { ...s.agentExecution, status: 'complete', progress: 100, outputs } };
  }),

  incrementBatchCompleted: (outputs) => set((s) => {
    if (!s.agentExecution) return s;
    const newCompleted = (s.agentExecution.batchCompleted ?? 0) + 1;
    const newBatchOutputs = [...(s.agentExecution.batchOutputs ?? []), ...outputs];
    const total = s.agentExecution.batchTotal ?? 1;
    const isAllDone = newCompleted >= total;
    return {
      agentExecution: {
        ...s.agentExecution,
        batchCompleted: newCompleted,
        batchOutputs: newBatchOutputs,
        ...(isAllDone ? { status: 'complete' as const, progress: 100 } : {}),
      },
    };
  }),

  failAgentExecution: (error) => set((s) => {
    if (!s.agentExecution) return s;
    return { agentExecution: { ...s.agentExecution, status: 'error', error } };
  }),

  clearAgentExecution: () => set({ agentExecution: null }),

  // Chat mode（写时双写：bucket + 扁平字段）
  chatMode: 'agent',
  setChatMode: (mode) => set((s) => {
    const tab = s.activeAgentTab;
    return {
      chatModeByTab: { ...s.chatModeByTab, [tab]: mode },
      chatMode: mode,
    };
  }),

  // Config assistant: 允许修改 LoRA 开关（持久化到 localStorage）
  allowLoraModification: loadAllowLoraMod(),
  setAllowLoraModification: (allow) => {
    try { localStorage.setItem(ALLOW_LORA_MOD_KEY, String(allow)); } catch {}
    set({ allowLoraModification: allow });
  },

  // Config snapshots
  configSnapshots: {},
  saveConfigSnapshot: (id, snapshot) => set((s) => ({
    configSnapshots: { ...s.configSnapshots, [id]: snapshot },
  })),
  getConfigSnapshot: (id) => get().configSnapshots[id],
}));
