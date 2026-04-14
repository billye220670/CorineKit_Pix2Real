import { useEffect, useCallback } from 'react';
import { useWorkflowStore } from './useWorkflowStore.js';
import type { Text2ImgConfig, ZitConfig } from '../services/sessionService.js';
import type { WSMessage } from '../types/index.js';

// Singleton WebSocket management — shared across all hook instances
let globalWs: WebSocket | null = null;
let globalReconnectTimer: number | undefined;
let connectionCount = 0;

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
          store.updateProgress(msg.promptId, msg.percentage);
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
              const record = {
                id: crypto.randomUUID(),
                sessionId: fullState.sessionId,
                timestamp: Date.now(),
                workflowId: tabId,
                workflowName: isText2Img ? '快速出图' : 'ZIT快出',
                tabId,
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
              fetch('/api/agent/log-generation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record),
              }).catch(err => console.error('[Agent] Failed to log generation:', err));

              break; // 找到即退出
            }
          } catch (logErr) {
            console.error('[Agent] Generation log error:', logErr);
          }
          break;
        case 'error':
          store.failTask(msg.promptId, msg.message);
          break;
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
