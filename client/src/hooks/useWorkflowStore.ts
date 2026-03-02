import { create } from 'zustand';
import type { ImageItem, TaskInfo, TaskStatus } from '../types/index.js';
import type { SerializedTabData, Text2ImgConfig } from '../services/sessionService.js';
export type { Text2ImgConfig };

const WORKFLOWS = [
  { id: 0, name: '二次元转真人', needsPrompt: true },
  { id: 1, name: '真人精修', needsPrompt: true },
  { id: 2, name: '精修放大', needsPrompt: false },
  { id: 3, name: '快速生成视频', needsPrompt: true },
  { id: 4, name: '视频放大', needsPrompt: false },
  { id: 5, name: '解除装备', needsPrompt: true },
  { id: 6, name: '真人转二次元', needsPrompt: true },
  { id: 7, name: '快速出图', needsPrompt: false },
];

interface TabData {
  images: ImageItem[];
  prompts: Record<string, string>;
  tasks: Record<string, TaskInfo>;
  imagePromptMap: Record<string, string>;
  selectedOutputIndex: Record<string, number>;
  backPoseToggles: Record<string, boolean>;
  text2imgConfigs: Record<string, Text2ImgConfig>;
}

function emptyTabData(): TabData {
  return { images: [], prompts: {}, tasks: {}, imagePromptMap: {}, selectedOutputIndex: {}, backPoseToggles: {}, text2imgConfigs: {} };
}

interface WorkflowStore {
  activeTab: number;
  workflows: typeof WORKFLOWS;
  tabData: Record<number, TabData>;
  clientId: string | null;
  sessionId: string | null;
  selectedImageIds: string[];

  setActiveTab: (tab: number) => void;
  addImages: (files: File[]) => void;
  addImagesToTab: (tabId: number, files: File[]) => void;
  removeImage: (id: string) => void;
  removeImages: (ids: string[]) => void;
  clearCurrentImages: () => void;
  setPrompt: (imageId: string, prompt: string) => void;
  setPrompts: (updates: Record<string, string>) => void;
  setClientId: (id: string) => void;
  setSessionId: (id: string) => void;
  enterMultiSelect: (id: string) => void;
  toggleImageSelection: (id: string) => void;
  setSelectedImageIds: (ids: string[]) => void;
  clearSelection: () => void;
  toggleBackPose: (imageId: string) => void;

  flashingImageId: string | null;
  setFlashingImage: (id: string | null) => void;
  remapTaskPromptIds: (mapping: Array<{ oldPromptId: string; newPromptId: string }>) => void;

  setSelectedOutputIndex: (imageId: string, index: number) => void;

  // Task management
  startTask: (imageId: string, promptId: string) => void;
  markTaskStarted: (promptId: string) => void;
  updateProgress: (promptId: string, percentage: number) => void;
  completeTask: (promptId: string, outputs: Array<{ filename: string; url: string }>) => void;
  failTask: (promptId: string, error: string) => void;
  resetTask: (imageId: string) => void;
  removeOutput: (imageId: string, outputIndex: number) => void;

  // Text2Img card creation (Tab 7)
  addText2ImgCard: (config: Text2ImgConfig, displayName?: string) => string;

  // Computed helpers
  needsPrompt: () => boolean;
  isProcessing: () => boolean;

  // Session restore
  restoreSession: (activeTab: number, tabData: Record<number, SerializedTabData>, restoredImages: Record<number, ImageItem[]>) => void;
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
    5: emptyTabData(),
    6: emptyTabData(),
    7: emptyTabData(),
  },
  clientId: null,
  sessionId: null,
  selectedImageIds: [],

  setActiveTab: (tab) => set({ activeTab: tab, selectedImageIds: [] }),

  enterMultiSelect: (id) => set({ selectedImageIds: [id] }),

  toggleImageSelection: (id) => set((state) => {
    const current = state.selectedImageIds;
    if (current.includes(id)) {
      return { selectedImageIds: current.filter((i) => i !== id) };
    }
    return { selectedImageIds: [...current, id] };
  }),

  setSelectedImageIds: (ids) => set({ selectedImageIds: ids }),

  clearSelection: () => set({ selectedImageIds: [] }),

  toggleBackPose: (imageId) => {
    set((state) => {
      const tab = state.activeTab;
      const prev = state.tabData[tab] || emptyTabData();
      const current = prev.backPoseToggles[imageId] ?? false;
      return {
        tabData: {
          ...state.tabData,
          [tab]: {
            ...prev,
            backPoseToggles: { ...prev.backPoseToggles, [imageId]: !current },
          },
        },
      };
    });
  },

  flashingImageId: null,
  setFlashingImage: (id) => set({ flashingImageId: id }),

  remapTaskPromptIds: (mapping) => {
    if (!mapping.length) return;
    const oldToNew: Record<string, string> = {};
    for (const { oldPromptId, newPromptId } of mapping) {
      oldToNew[oldPromptId] = newPromptId;
    }
    set((state) => {
      const newTabData = { ...state.tabData };
      for (const tabKey of Object.keys(newTabData)) {
        const tab = Number(tabKey);
        const prev = newTabData[tab];
        if (!prev) continue;
        let changed = false;
        const newTasks = { ...prev.tasks };
        const newImagePromptMap = { ...prev.imagePromptMap };
        for (const [imageId, task] of Object.entries(newTasks)) {
          const newId = oldToNew[task.promptId];
          if (newId) {
            newTasks[imageId] = { ...task, promptId: newId };
            newImagePromptMap[imageId] = newId;
            changed = true;
          }
        }
        if (changed) {
          newTabData[tab] = { ...prev, tasks: newTasks, imagePromptMap: newImagePromptMap };
        }
      }
      return { tabData: newTabData };
    });
  },

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

  addImagesToTab: (tabId, files) => {
    const newImages: ImageItem[] = files.map((file) => ({
      id: `img_${Date.now()}_${imageCounter++}`,
      file,
      previewUrl: URL.createObjectURL(file),
      originalName: file.name,
    }));
    set((state) => {
      const prev = state.tabData[tabId] || emptyTabData();
      return {
        tabData: {
          ...state.tabData,
          [tabId]: { ...prev, images: [...prev.images, ...newImages] },
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
      const { [id]: _s, ...restSelectedOutputIndex } = prev.selectedOutputIndex;
      const { [id]: _b, ...restBackPoseToggles } = prev.backPoseToggles;
      const { [id]: _c, ...restText2ImgConfigs } = prev.text2imgConfigs;
      return {
        tabData: {
          ...state.tabData,
          [tab]: {
            images: prev.images.filter((i) => i.id !== id),
            prompts: restPrompts,
            tasks: restTasks,
            imagePromptMap: restMap,
            selectedOutputIndex: restSelectedOutputIndex,
            backPoseToggles: restBackPoseToggles,
            text2imgConfigs: restText2ImgConfigs,
          },
        },
      };
    });
  },

  removeImages: (ids) => {
    set((state) => {
      const tab = state.activeTab;
      const prev = state.tabData[tab] || emptyTabData();
      const idSet = new Set(ids);
      prev.images.forEach((img) => { if (idSet.has(img.id)) URL.revokeObjectURL(img.previewUrl); });
      return {
        tabData: {
          ...state.tabData,
          [tab]: {
            ...prev,
            images: prev.images.filter((i) => !idSet.has(i.id)),
            prompts: Object.fromEntries(Object.entries(prev.prompts).filter(([k]) => !idSet.has(k))),
            tasks: Object.fromEntries(Object.entries(prev.tasks).filter(([k]) => !idSet.has(k))),
            imagePromptMap: Object.fromEntries(Object.entries(prev.imagePromptMap).filter(([k]) => !idSet.has(k))),
            selectedOutputIndex: Object.fromEntries(Object.entries(prev.selectedOutputIndex).filter(([k]) => !idSet.has(k))),
            backPoseToggles: Object.fromEntries(
              Object.entries(prev.backPoseToggles).filter(([k]) => !idSet.has(k))
            ),
            text2imgConfigs: Object.fromEntries(
              Object.entries(prev.text2imgConfigs).filter(([k]) => !idSet.has(k))
            ),
          },
        },
        selectedImageIds: state.selectedImageIds.filter((i) => !idSet.has(i)),
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

  setPrompts: (updates) => {
    set((state) => {
      const tab = state.activeTab;
      const prev = state.tabData[tab] || emptyTabData();
      return {
        tabData: {
          ...state.tabData,
          [tab]: { ...prev, prompts: { ...prev.prompts, ...updates } },
        },
      };
    });
  },

  setClientId: (id) => set({ clientId: id }),

  setSessionId: (id) => set({ sessionId: id }),

  setSelectedOutputIndex: (imageId, index) => {
    set((state) => {
      const tab = state.activeTab;
      const prev = state.tabData[tab] || emptyTabData();
      return {
        tabData: {
          ...state.tabData,
          [tab]: {
            ...prev,
            selectedOutputIndex: { ...prev.selectedOutputIndex, [imageId]: index },
          },
        },
      };
    });
  },

  startTask: (imageId, promptId) => {
    set((state) => {
      const tab = state.activeTab;
      const prev = state.tabData[tab] || emptyTabData();
      const existingOutputs = prev.tasks[imageId]?.outputs ?? [];
      return {
        tabData: {
          ...state.tabData,
          [tab]: {
            ...prev,
            tasks: {
              ...prev.tasks,
              [imageId]: { promptId, status: 'queued' as TaskStatus, progress: 0, outputs: existingOutputs },
            },
            imagePromptMap: { ...prev.imagePromptMap, [imageId]: promptId },
          },
        },
      };
    });
  },

  markTaskStarted: (promptId) => {
    set((state) => {
      const newTabData = { ...state.tabData };
      for (const tabKey of Object.keys(newTabData)) {
        const tab = Number(tabKey);
        const prev = newTabData[tab];
        if (!prev) continue;
        let changed = false;
        const newTasks = { ...prev.tasks };
        for (const [imageId, task] of Object.entries(newTasks)) {
          if (task.promptId === promptId && task.status === 'queued') {
            newTasks[imageId] = { ...task, status: 'processing' as TaskStatus };
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
        const newSelectedOutputIndex = { ...prev.selectedOutputIndex };
        for (const [imageId, task] of Object.entries(newTasks)) {
          if (task.promptId === promptId) {
            const existingOutputs = task.outputs ?? [];
            const allOutputs = [...existingOutputs, ...outputs];
            newTasks[imageId] = { ...task, status: 'done', progress: 100, outputs: allOutputs };
            // Default to the first output of the new batch; for video workflows prefer 插帧 within new batch
            let defaultIdx = existingOutputs.length;
            if ((tab === 3 || tab === 4) && outputs.length > 1) {
              const i = outputs.findIndex((o) => o.filename.includes('插帧'));
              if (i >= 0) defaultIdx = existingOutputs.length + i;
            }
            newSelectedOutputIndex[imageId] = defaultIdx;
            changed = true;
          }
        }
        if (changed) {
          newTabData[tab] = { ...prev, tasks: newTasks, selectedOutputIndex: newSelectedOutputIndex };
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

  resetTask: (imageId) => {
    set((state) => {
      const tab = state.activeTab;
      const prev = state.tabData[tab] || emptyTabData();
      const { [imageId]: _t, ...restTasks } = prev.tasks;
      const { [imageId]: _m, ...restMap } = prev.imagePromptMap;
      const { [imageId]: _s, ...restSelectedOutputIndex } = prev.selectedOutputIndex;
      return {
        tabData: {
          ...state.tabData,
          [tab]: { ...prev, tasks: restTasks, imagePromptMap: restMap, selectedOutputIndex: restSelectedOutputIndex },
        },
      };
    });
  },

  removeOutput: (imageId, outputIndex) => {
    set((state) => {
      const newTabData = { ...state.tabData };
      for (const tabKey of Object.keys(newTabData)) {
        const tab = Number(tabKey);
        const prev = newTabData[tab];
        if (!prev) continue;
        const task = prev.tasks[imageId];
        if (!task) continue;
        const newOutputs = task.outputs.filter((_, i) => i !== outputIndex);
        const prevSel = prev.selectedOutputIndex[imageId] ?? 0;
        const newSel = prevSel >= newOutputs.length ? Math.max(-1, newOutputs.length - 1) : prevSel;
        newTabData[tab] = {
          ...prev,
          tasks: {
            ...prev.tasks,
            [imageId]: { ...task, outputs: newOutputs },
          },
          selectedOutputIndex: {
            ...prev.selectedOutputIndex,
            [imageId]: newSel,
          },
        };
        break;
      }
      return { tabData: newTabData };
    });
  },

  addText2ImgCard: (config, displayName) => {
    // 1×1 white PNG as placeholder (so session upload / session restore works normally)
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    const name = displayName ?? 'text2img';
    const file = new File([blob], `${name}.png`, { type: 'image/png' });
    const id = `img_${Date.now()}_${imageCounter++}`;
    const previewUrl = URL.createObjectURL(blob);
    set((state) => {
      const prev = state.tabData[7] || emptyTabData();
      return {
        tabData: {
          ...state.tabData,
          [7]: {
            ...prev,
            images: [...prev.images, { id, file, previewUrl, originalName: `${name}.png` }],
            text2imgConfigs: { ...prev.text2imgConfigs, [id]: config },
          },
        },
      };
    });
    return id;
  },

  needsPrompt: () => {
    const { activeTab, workflows } = get();
    return workflows[activeTab]?.needsPrompt ?? false;
  },

  restoreSession: (activeTab, serializedTabData, restoredImages) => {
    const newTabData: Record<number, TabData> = {};
    for (let tab = 0; tab <= 7; tab++) {
      const ser = serializedTabData[tab];
      if (!ser) {
        newTabData[tab] = emptyTabData();
        continue;
      }
      const images = restoredImages[tab] ?? [];
      const tasks: Record<string, TaskInfo> = {};
      for (const [imageId, t] of Object.entries(ser.tasks)) {
        tasks[imageId] = {
          promptId: t.promptId,
          status: (t.status === 'done' || t.status === 'error') ? t.status as TaskStatus : 'done',
          progress: t.progress,
          outputs: t.outputs,
          error: t.error,
        };
      }
      const imagePromptMap: Record<string, string> = {};
      for (const [imageId, t] of Object.entries(ser.tasks)) {
        imagePromptMap[imageId] = t.promptId;
      }
      newTabData[tab] = {
        images,
        prompts: ser.prompts,
        tasks,
        imagePromptMap,
        selectedOutputIndex: ser.selectedOutputIndex,
        backPoseToggles: ser.backPoseToggles,
        text2imgConfigs: ser.text2imgConfigs ?? {},
      };
    }
    set({ activeTab, tabData: newTabData });
  },

  isProcessing: () => {
    const { activeTab, tabData } = get();
    const tab = tabData[activeTab];
    if (!tab) return false;
    return Object.values(tab.tasks).some((t) => t.status === 'processing' || t.status === 'queued');
  },
}));
