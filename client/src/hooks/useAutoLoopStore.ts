import { create } from 'zustand';
import { useWorkflowStore } from './useWorkflowStore';

/** 自动循环归属的 Tab：7=快速出图，9=ZIT 快出 */
export type AutoLoopTabId = 7 | 9;
/** 循环种类：normal=生成按钮，random=骰子按钮 */
export type AutoLoopKind = 'normal' | 'random';

/**
 * 跨 tab 打断请求：当用户在其它 tab 试图提交任务时，通过此对象向 UI 层申请弹出模态框。
 * - fromTabId：申请方 tab（即非循环 tab）
 * - resolve：UI 点完按钮后调用；true=已停止循环可继续提交，false=用户取消
 */
export interface AutoLoopInterruptRequest {
  fromTabId: number;
  resolve: (shouldProceed: boolean) => void;
}

interface AutoLoopState {
  active: boolean;
  tabId: AutoLoopTabId | null;
  kind: AutoLoopKind | null;
  interruptRequest: AutoLoopInterruptRequest | null;
  startLoop: (tabId: AutoLoopTabId, kind: AutoLoopKind) => void;
  stopLoop: () => void;
  /**
   * 提交任务前调用。返回 true 表示允许提交（无冲突或用户已确认停止循环）；
   * 返回 false 表示用户取消、调用方应终止本次提交。
   */
  guardBeforeSubmit: (fromTabId: number) => Promise<boolean>;
  /** UI 层响应模态框按钮点击后调用 */
  resolveInterrupt: (shouldProceed: boolean) => void;
}

export const useAutoLoopStore = create<AutoLoopState>((set, get) => ({
  active: false,
  tabId: null,
  kind: null,
  interruptRequest: null,
  startLoop: (tabId, kind) => {
    set({ active: true, tabId, kind });
  },
  stopLoop: () => {
    set({ active: false, tabId: null, kind: null });
  },
  guardBeforeSubmit: (fromTabId) => {
    const { active, tabId } = get();
    if (!active || tabId === fromTabId) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      set({ interruptRequest: { fromTabId, resolve } });
    });
  },
  resolveInterrupt: (shouldProceed) => {
    const req = get().interruptRequest;
    if (!req) return;
    if (shouldProceed) {
      // 停止循环后再放行
      set({ active: false, tabId: null, kind: null });
    }
    set({ interruptRequest: null });
    req.resolve(shouldProceed);
  },
}));

/**
 * 等待某个 promptId 的任务抵达终态（done/error）。
 * 通过 zustand subscribe 订阅 workflow store 的 tabData 变化实现，订阅会在终态到达时自动解除。
 */
export function waitPromptComplete(promptId: string): Promise<void> {
  return new Promise((resolve) => {
    // 订阅前先检查一次当前状态，避免错过已经完成的任务
    const checkOnce = (state: ReturnType<typeof useWorkflowStore.getState>) => {
      for (const tabData of Object.values(state.tabData)) {
        if (!tabData) continue;
        for (const task of Object.values(tabData.tasks)) {
          if (task.promptId === promptId && (task.status === 'done' || task.status === 'error')) {
            return true;
          }
        }
      }
      return false;
    };

    if (checkOnce(useWorkflowStore.getState())) {
      resolve();
      return;
    }

    const unsub = useWorkflowStore.subscribe((state) => {
      if (checkOnce(state)) {
        unsub();
        resolve();
      }
    });
  });
}
