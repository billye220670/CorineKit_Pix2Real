import { create } from 'zustand';

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

  // Messages
  messages: ChatMessage[];
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;

  // Execution state
  isExecuting: boolean;
  executionStatus: string;
  setExecutionStatus: (status: string) => void;
  setIsExecuting: (executing: boolean) => void;

  // Uploaded images
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

  // Messages
  messages: [],
  addMessage: (msg) => set((s) => ({
    messages: [...s.messages, {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }],
  })),
  updateMessage: (id, updates) => set((s) => ({
    messages: s.messages.map((m) => m.id === id ? { ...m, ...updates } : m),
  })),
  removeMessage: (id) => set((s) => ({
    messages: s.messages.filter((m) => m.id !== id),
  })),
  clearMessages: () => set({ messages: [] }),

  // Execution state
  isExecuting: false,
  executionStatus: '',
  setExecutionStatus: (status) => set({ executionStatus: status }),
  setIsExecuting: (executing) => set({ isExecuting: executing }),

  // Uploaded images
  uploadedImages: [],
  addUploadedImage: (img) => set((s) => ({
    uploadedImages: [...s.uploadedImages, img],
  })),
  removeUploadedImage: (id) => set((s) => ({
    uploadedImages: s.uploadedImages.filter((i) => i.id !== id),
  })),
  clearUploadedImages: () => set({ uploadedImages: [] }),

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
}));
