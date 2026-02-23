import { useEffect, useCallback } from 'react';
import { useWorkflowStore } from './useWorkflowStore.js';
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
