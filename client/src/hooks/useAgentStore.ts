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
  } | null;

  setAgentExecution: (exec: AgentState['agentExecution']) => void;
  updateAgentProgress: (percentage: number) => void;
  completeAgentExecution: (outputs: Array<{ filename: string; url: string }>) => void;
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

  failAgentExecution: (error) => set((s) => {
    if (!s.agentExecution) return s;
    return { agentExecution: { ...s.agentExecution, status: 'error', error } };
  }),

  clearAgentExecution: () => set({ agentExecution: null }),
}));
