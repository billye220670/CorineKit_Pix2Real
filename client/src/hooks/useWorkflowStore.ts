import { create } from 'zustand';
import type { ImageItem, TaskInfo, TaskStatus } from '../types/index.js';

const WORKFLOWS = [
  { id: 0, name: '二次元转真人', needsPrompt: true },
  { id: 1, name: '真人精修', needsPrompt: true },
  { id: 2, name: '精修放大', needsPrompt: false },
  { id: 3, name: '快速生成视频', needsPrompt: true },
  { id: 4, name: '视频放大', needsPrompt: false },
];

interface TabData {
  images: ImageItem[];
  prompts: Record<string, string>;
  tasks: Record<string, TaskInfo>;
  imagePromptMap: Record<string, string>;
}

function emptyTabData(): TabData {
  return { images: [], prompts: {}, tasks: {}, imagePromptMap: {} };
}

interface WorkflowStore {
  activeTab: number;
  workflows: typeof WORKFLOWS;
  tabData: Record<number, TabData>;
  clientId: string | null;

  setActiveTab: (tab: number) => void;
  addImages: (files: File[]) => void;
  removeImage: (id: string) => void;
  clearCurrentImages: () => void;
  setPrompt: (imageId: string, prompt: string) => void;
  setClientId: (id: string) => void;

  // Task management
  startTask: (imageId: string, promptId: string) => void;
  updateProgress: (promptId: string, percentage: number) => void;
  completeTask: (promptId: string, outputs: Array<{ filename: string; url: string }>) => void;
  failTask: (promptId: string, error: string) => void;

  // Computed helpers
  needsPrompt: () => boolean;
  isProcessing: () => boolean;
}

let imageCounter = 0;

function getTab(state: { activeTab: number; tabData: Record<number, TabData> }): TabData {
  return state.tabData[state.activeTab] || emptyTabData();
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  activeTab: 0,
  workflows: WORKFLOWS,
  tabData: {
    0: emptyTabData(),
    1: emptyTabData(),
    2: emptyTabData(),
    3: emptyTabData(),
    4: emptyTabData(),
  },
  clientId: null,

  setActiveTab: (tab) => set({ activeTab: tab }),

  addImages: (files) => {
    const newImages: ImageItem[] = files.map((file) => ({
      id: `img_${Date.now()}_${imageCounter++}`,
      file,
      previewUrl: URL.createObjectURL(file),
      originalName: file.name,
    }));
    set((state) => {
      const tab = state.activeTab;
      const prev = state.tabData[tab] || emptyTabData();
      return {
        tabData: {
          ...state.tabData,
          [tab]: { ...prev, images: [...prev.images, ...newImages] },
        },
      };
    });
  },

  removeImage: (id) => {
    set((state) => {
      const tab = state.activeTab;
      const prev = state.tabData[tab] || emptyTabData();
      const img = prev.images.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.previewUrl);
      const { [id]: _p, ...restPrompts } = prev.prompts;
      const { [id]: _t, ...restTasks } = prev.tasks;
      const { [id]: _m, ...restMap } = prev.imagePromptMap;
      return {
        tabData: {
          ...state.tabData,
          [tab]: {
            images: prev.images.filter((i) => i.id !== id),
            prompts: restPrompts,
            tasks: restTasks,
            imagePromptMap: restMap,
          },
        },
      };
    });
  },

  clearCurrentImages: () => {
    set((state) => {
      const tab = state.activeTab;
      const prev = state.tabData[tab] || emptyTabData();
      prev.images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return {
        tabData: {
          ...state.tabData,
          [tab]: emptyTabData(),
        },
      };
    });
  },

  setPrompt: (imageId, prompt) => {
    set((state) => {
      const tab = state.activeTab;
      const prev = state.tabData[tab] || emptyTabData();
      return {
        tabData: {
          ...state.tabData,
          [tab]: { ...prev, prompts: { ...prev.prompts, [imageId]: prompt } },
        },
      };
    });
  },

  setClientId: (id) => set({ clientId: id }),

  startTask: (imageId, promptId) => {
    set((state) => {
      const tab = state.activeTab;
      const prev = state.tabData[tab] || emptyTabData();
      return {
        tabData: {
          ...state.tabData,
          [tab]: {
            ...prev,
            tasks: {
              ...prev.tasks,
              [imageId]: { promptId, status: 'processing' as TaskStatus, progress: 0, outputs: [] },
            },
            imagePromptMap: { ...prev.imagePromptMap, [imageId]: promptId },
          },
        },
      };
    });
  },

  updateProgress: (promptId, percentage) => {
    set((state) => {
      const newTabData = { ...state.tabData };
      // Search all tabs for the promptId since progress can arrive on any tab
      for (const tabKey of Object.keys(newTabData)) {
        const tab = Number(tabKey);
        const prev = newTabData[tab];
        if (!prev) continue;
        let changed = false;
        const newTasks = { ...prev.tasks };
        for (const [imageId, task] of Object.entries(newTasks)) {
          if (task.promptId === promptId) {
            newTasks[imageId] = { ...task, progress: percentage };
            changed = true;
          }
        }
        if (changed) {
          newTabData[tab] = { ...prev, tasks: newTasks };
        }
      }
      return { tabData: newTabData };
    });
  },

  completeTask: (promptId, outputs) => {
    set((state) => {
      const newTabData = { ...state.tabData };
      for (const tabKey of Object.keys(newTabData)) {
        const tab = Number(tabKey);
        const prev = newTabData[tab];
        if (!prev) continue;
        let changed = false;
        const newTasks = { ...prev.tasks };
        for (const [imageId, task] of Object.entries(newTasks)) {
          if (task.promptId === promptId) {
            newTasks[imageId] = { ...task, status: 'done', progress: 100, outputs };
            changed = true;
          }
        }
        if (changed) {
          newTabData[tab] = { ...prev, tasks: newTasks };
        }
      }
      return { tabData: newTabData };
    });
  },

  failTask: (promptId, error) => {
    set((state) => {
      const newTabData = { ...state.tabData };
      for (const tabKey of Object.keys(newTabData)) {
        const tab = Number(tabKey);
        const prev = newTabData[tab];
        if (!prev) continue;
        let changed = false;
        const newTasks = { ...prev.tasks };
        for (const [imageId, task] of Object.entries(newTasks)) {
          if (task.promptId === promptId) {
            newTasks[imageId] = { ...task, status: 'error', error };
            changed = true;
          }
        }
        if (changed) {
          newTabData[tab] = { ...prev, tasks: newTasks };
        }
      }
      return { tabData: newTabData };
    });
  },

  needsPrompt: () => {
    const { activeTab, workflows } = get();
    return workflows[activeTab]?.needsPrompt ?? false;
  },

  isProcessing: () => {
    const { activeTab, tabData } = get();
    const tab = tabData[activeTab];
    if (!tab) return false;
    return Object.values(tab.tasks).some((t) => t.status === 'processing');
  },
}));
