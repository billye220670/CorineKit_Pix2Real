import { useEffect, useCallback } from 'react';
import { useWorkflowStore } from './useWorkflowStore.js';
import { useAgentStore } from './useAgentStore.js';
import { useSettingsStore } from './useSettingsStore.js';
import { notifyTaskComplete, notifyTaskError } from '../services/desktopNotify.js';
import type { Text2ImgConfig, ZitConfig } from '../services/sessionService.js';
import type { WSMessage } from '../types/index.js';

// Singleton WebSocket management — shared across all hook instances
let globalWs: WebSocket | null = null;
let globalReconnectTimer: number | undefined;
let connectionCount = 0;

// Dedup guard: prevent the same external_image_push stagingId from being consumed twice
// (e.g. due to HMR orphaned WebSocket or StrictMode double-mount race)
const processedStagingIds = new Set<string>();
const STAGING_ID_TTL_MS = 60_000;

/** 根据 promptId 在 tabData 中查找归属的 tabId 与工作流名，用于桌面通知文案。 */
function resolveWorkflowLabel(promptId: string): { tabId: number | null; workflowName: string } {
  const state = useWorkflowStore.getState();
  for (const [tabKey, tabVal] of Object.entries(state.tabData)) {
    if (!tabVal) continue;
    const found = Object.entries(tabVal.imagePromptMap || {}).find(([, pid]) => pid === promptId);
    if (found) {
      const tabId = Number(tabKey);
      const workflowName = state.workflows.find((w) => w.id === tabId)?.name ?? '工作流';
      return { tabId, workflowName };
    }
  }
  return { tabId: null, workflowName: '工作流' };
}

function getOrCreateConnection(): WebSocket {
  if (globalWs && (globalWs.readyState === WebSocket.OPEN || globalWs.readyState === WebSocket.CONNECTING)) {
    return globalWs;
  }

  // Clear any pending reconnect
  clearTimeout(globalReconnectTimer);

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connected');
  };

  ws.onmessage = (event) => {
    try {
      const msg: WSMessage = JSON.parse(event.data);
      const store = useWorkflowStore.getState();

      switch (msg.type) {
        case 'connected':
          store.setClientId(msg.clientId);
          break;
        case 'execution_start':
          store.markTaskStarted(msg.promptId);
          break;
        case 'progress':
          store.updateProgress(msg.promptId, msg.percentage, msg.stage, msg.stepIndex, msg.stepTotal);
          break;
        case 'complete':
          store.completeTask(msg.promptId, msg.outputs);
          // 自动记录生成日志（仅 Tab 7/9）
          try {
            const fullState = useWorkflowStore.getState();
            for (const [tabKey, tabVal] of Object.entries(fullState.tabData)) {
              if (!tabVal) continue;
              const tabId = Number(tabKey);
              if (tabId !== 7 && tabId !== 9) continue;

              const entry = Object.entries(tabVal.imagePromptMap || {}).find(
                ([, pid]) => pid === msg.promptId
              );
              if (!entry) continue;
              const imageId = entry[0];

              const config = tabId === 7
                ? tabVal.text2imgConfigs?.[imageId]
                : tabVal.zitConfigs?.[imageId];
              if (!config) continue;

              const isText2Img = tabId === 7;
              const imageSource = fullState.imageSourceMap[imageId] ?? 'manual';
              const record = {
                id: crypto.randomUUID(),
                sessionId: fullState.sessionId,
                timestamp: Date.now(),
                workflowId: tabId,
                workflowName: isText2Img ? '快速出图' : 'ZIT快出',
                tabId,
                source: imageSource,
                config: isText2Img ? {
                  model: (config as Text2ImgConfig).model,
                  loras: (config as Text2ImgConfig).loras || [],
                  prompt: (config as Text2ImgConfig).prompt || '',
                  negativePrompt: (config as Text2ImgConfig).negativePrompt,
                  params: {
                    width: config.width,
                    height: config.height,
                    steps: config.steps,
                    cfg: config.cfg,
                    sampler: config.sampler,
                    scheduler: config.scheduler,
                  },
                } : {
                  model: '',
                  unetModel: (config as ZitConfig).unetModel,
                  loras: (config as ZitConfig).loras || [],
                  prompt: (config as ZitConfig).prompt || '',
                  shiftEnabled: (config as ZitConfig).shiftEnabled,
                  shift: (config as ZitConfig).shift,
                  params: {
                    width: config.width,
                    height: config.height,
                    steps: config.steps,
                    cfg: config.cfg,
                    sampler: config.sampler,
                    scheduler: config.scheduler,
                  },
                },
                result: {
                  imageId,
                  outputs: msg.outputs,
                },
                metadata: {
                  isFavorited: false,
                },
              };

              // 异步发送，不阻塞 UI
              // 隐私模式开启时跳过上报，避免本次生成进入 generation-log / 用户画像 / 统计
              if (!useSettingsStore.getState().privacyMode) {
                fetch('/api/agent/log-generation', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(record),
                }).catch(err => console.error('[Agent] Failed to log generation:', err));
              }

              break; // 找到即退出
            }
          } catch (logErr) {
            console.error('[Agent] Generation log error:', logErr);
          }
          // 桌面通知（任务完成）
          try {
            if (useSettingsStore.getState().desktopNotifyOnComplete) {
              const { workflowName } = resolveWorkflowLabel(msg.promptId);
              const count = Array.isArray(msg.outputs) ? msg.outputs.length : 0;
              notifyTaskComplete(workflowName, count, `workflow-${msg.promptId}-${Date.now()}`);
            }
          } catch { /* noop */ }
          break;
        case 'error':
          store.failTask(msg.promptId, msg.message);
          try {
            if (useSettingsStore.getState().desktopNotifyOnComplete) {
              const { workflowName } = resolveWorkflowLabel(msg.promptId);
              notifyTaskError(workflowName, msg.message, `workflow-${msg.promptId}-${Date.now()}`);
            }
          } catch { /* noop */ }
          break;
        case 'external_image_push': {
          // Precise multi-window routing: if a target session is specified and it
          // does not match this window's session, ignore. Undefined → accept.
          if (msg.targetSessionId && msg.targetSessionId !== store.sessionId) {
            break;
          }
          const { tabId, stagingId, originalName } = msg;
          // Dedup: skip if this stagingId was already processed (HMR / double-mount guard)
          if (processedStagingIds.has(stagingId)) {
            console.debug('[WS] external_image_push dedup: skipping already-processed stagingId', stagingId);
            break;
          }
          processedStagingIds.add(stagingId);
          setTimeout(() => processedStagingIds.delete(stagingId), STAGING_ID_TTL_MS);

          // onmessage is not async — fetch bytes and hand off in an async IIFE.
          void (async () => {
            try {
              const res = await fetch(`/api/external-image-push/${stagingId}`);
              if (!res.ok) throw new Error(`Failed to fetch external image: ${res.status}`);
              const blob = await res.blob();
              const file = new File([blob], originalName ?? 'pushed.png', { type: blob.type });
              store.addImagesToTab(tabId, [file]);
              store.setActiveTab(tabId);

              // autoStart: automatically trigger workflow execution after image is added
              if (msg.autoStart) {
                try {
                  const currentState = useWorkflowStore.getState();
                  const clientId = currentState.clientId;
                  if (!clientId) {
                    console.warn('[WS] autoStart skipped: no clientId available');
                    return;
                  }
                  // Find the newly added image (last in the tab's images array)
                  const tabImages = currentState.tabData[tabId]?.images;
                  if (!tabImages || tabImages.length === 0) {
                    console.warn('[WS] autoStart skipped: no images found in tab', tabId);
                    return;
                  }
                  const newImage = tabImages[tabImages.length - 1];

                  // Reuse the already-fetched `file` — never re-fetch stagingId
                  const formData = new FormData();
                  formData.append('image', file);
                  formData.append('clientId', clientId);
                  formData.append('prompt', '');

                  console.log('[WS] autoStart: triggering workflow execution for tab', tabId, 'imageId', newImage.id);
                  const execRes = await fetch(`/api/workflow/${tabId}/execute?clientId=${clientId}`, {
                    method: 'POST',
                    body: formData,
                  });
                  if (!execRes.ok) {
                    console.error('[WS] autoStart execute failed:', await execRes.text());
                    return;
                  }
                  const data = await execRes.json() as { promptId: string };
                  store.startTaskInTab(tabId, newImage.id, data.promptId);
                  // Register promptId for progress tracking via WS
                  if (globalWs?.readyState === WebSocket.OPEN) {
                    globalWs.send(JSON.stringify({
                      type: 'register',
                      promptId: data.promptId,
                      workflowId: tabId,
                      sessionId: currentState.sessionId,
                      tabId,
                    }));
                  }
                  console.log('[WS] autoStart: workflow execution triggered, promptId:', data.promptId);
                } catch (autoErr) {
                  console.error('[WS] autoStart execution error:', autoErr);
                }
              }
            } catch (err) {
              console.warn('[WS] external_image_push failed:', err);
            }
          })();
          break;
        }
      }
    } catch {
      // ignore
    }

    // Agent execution 进度同步（在 switch 之外，独立追踪）
    try {
      const msg: WSMessage = JSON.parse(event.data);
      const agentExec = useAgentStore.getState().agentExecution;
      if (agentExec && agentExec.promptId && msg.type !== 'connected' && msg.type !== 'external_image_push') {
        // 支持多 promptId 匹配（批量生成模式）
        const isAgentPrompt = agentExec.promptId === msg.promptId ||
          agentExec.allPromptIds?.includes(msg.promptId);

        if (isAgentPrompt) {
          const agentStore = useAgentStore.getState();
          switch (msg.type) {
            case 'execution_start':
              agentStore.setAgentExecution({ ...agentExec, status: 'executing' });
              break;
            case 'progress':
              agentStore.updateAgentProgress(msg.percentage);
              break;
            case 'complete': {
              const isBatch = (agentExec.batchTotal ?? 1) > 1;
              if (isBatch) {
                // 批量模式：通过 incrementBatchCompleted 逐张收集，自动判断全部完成
                const outputUrls = (msg.outputs || []).map((o: { url: string }) => o.url);
                agentStore.incrementBatchCompleted(outputUrls);
                // 同时仍然记录 outputs 以保持兼容
                const currentExec = useAgentStore.getState().agentExecution;
                if (currentExec && currentExec.status === 'complete') {
                  // 全部完成，将所有 batchOutputs 转为 outputs 格式
                  const allOutputs = (currentExec.batchOutputs ?? []).map(url => ({ filename: url.split('/').pop() || '', url }));
                  agentStore.setAgentExecution({ ...currentExec, outputs: allOutputs });
                  // 桌面通知（仅在全部完成时触发一次）
                  try {
                    if (useSettingsStore.getState().desktopNotifyOnComplete) {
                      const name = currentExec.generationContext?.workflowName ?? '智能生成';
                      notifyTaskComplete(name, allOutputs.length, `agent-${currentExec.promptId}-${Date.now()}`);
                    }
                  } catch { /* noop */ }
                }
              } else {
                // 单次生成：沿用现有逻辑
                agentStore.completeAgentExecution(msg.outputs);
                try {
                  if (useSettingsStore.getState().desktopNotifyOnComplete) {
                    const name = agentExec.generationContext?.workflowName ?? '智能生成';
                    const count = Array.isArray(msg.outputs) ? msg.outputs.length : 0;
                    notifyTaskComplete(name, count, `agent-${agentExec.promptId}-${Date.now()}`);
                  }
                } catch { /* noop */ }
              }
              break;
            }
            case 'error':
              agentStore.failAgentExecution(msg.message || 'Unknown error');
              try {
                if (useSettingsStore.getState().desktopNotifyOnComplete) {
                  const name = agentExec.generationContext?.workflowName ?? '智能生成';
                  notifyTaskError(name, msg.message, `agent-${agentExec.promptId}-${Date.now()}`);
                }
              } catch { /* noop */ }
              break;
          }
        }
      }
    } catch {
      // ignore
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected');
    globalWs = null;
    // Only reconnect if there are active subscribers
    if (connectionCount > 0) {
      console.log('[WS] Reconnecting in 2s...');
      globalReconnectTimer = window.setTimeout(() => {
        if (connectionCount > 0) {
          getOrCreateConnection();
        }
      }, 2000);
    }
  };

  ws.onerror = () => {
    // onclose will fire after this
  };

  globalWs = ws;
  return ws;
}

export function useWebSocket() {
  useEffect(() => {
    connectionCount++;
    getOrCreateConnection();

    return () => {
      connectionCount--;
      if (connectionCount <= 0) {
        connectionCount = 0;
        clearTimeout(globalReconnectTimer);
        globalWs?.close();
        globalWs = null;
      }
    };
  }, []); // No dependencies — only runs once per mount

  const sendMessage = useCallback((data: object) => {
    if (globalWs?.readyState === WebSocket.OPEN) {
      globalWs.send(JSON.stringify(data));
    }
  }, []);

  return { sendMessage };
}
