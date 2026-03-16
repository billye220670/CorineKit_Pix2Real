import FormData from 'form-data';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import type { QueueResponse, HistoryEntry } from '../types/index.js';

const COMFYUI_URL = 'http://127.0.0.1:8188';
const COMFYUI_WS_URL = 'ws://127.0.0.1:8188';

export async function uploadImage(buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append('image', buffer, { filename });
  form.append('overwrite', 'true');

  const res = await fetch(`${COMFYUI_URL}/upload/image`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { name: string; subfolder: string; type: string };
  return data.name;
}

export async function uploadVideo(buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append('image', buffer, { filename });
  form.append('overwrite', 'true');
  form.append('subfolder', '');
  form.append('type', 'input');

  const res = await fetch(`${COMFYUI_URL}/upload/image`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Upload video failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { name: string; subfolder: string; type: string };
  return data.name;
}

export async function queuePrompt(prompt: object, clientId: string): Promise<QueueResponse> {
  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: clientId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Queue prompt failed: ${res.status} ${text}`);
  }

  return (await res.json()) as QueueResponse;
}

export async function getHistory(promptId: string): Promise<HistoryEntry> {
  const res = await fetch(`${COMFYUI_URL}/history/${promptId}`);

  if (!res.ok) {
    throw new Error(`Get history failed: ${res.status}`);
  }

  const data = (await res.json()) as Record<string, HistoryEntry>;
  return data[promptId];
}

export async function getImageBuffer(filename: string, subfolder: string, type: string): Promise<Buffer> {
  const params = new URLSearchParams({ filename, subfolder, type });
  const res = await fetch(`${COMFYUI_URL}/view?${params}`);

  if (!res.ok) {
    throw new Error(`Get image failed: ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export interface ComfyUIProgress {
  value: number;
  max: number;
}

export async function deleteQueueItem(promptId: string): Promise<void> {
  const res = await fetch(`${COMFYUI_URL}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] }),
  });
  if (!res.ok) {
    throw new Error(`Delete queue item failed: ${res.status}`);
  }
}

export interface SystemStats {
  vram: number | null;   // used percentage 0–100, null if no GPU
  ram: number;           // used percentage 0–100
}

export async function getSystemStats(): Promise<SystemStats> {
  const res = await fetch(`${COMFYUI_URL}/system_stats`);
  if (!res.ok) throw new Error(`system_stats failed: ${res.status}`);

  const data = (await res.json()) as {
    system: { ram_total: number; ram_free: number };
    devices: Array<{ vram_total: number; vram_free: number }>;
  };

  const ramTotal = data.system?.ram_total ?? 0;
  const ramFree = data.system?.ram_free ?? 0;
  const ram = ramTotal > 0 ? Math.round((1 - ramFree / ramTotal) * 100) : 0;

  const device = data.devices?.[0];
  const vramTotal = device?.vram_total ?? 0;
  const vramFree = device?.vram_free ?? 0;
  const vram = vramTotal > 0 ? Math.round((1 - vramFree / vramTotal) * 100) : null;

  return { vram, ram };
}

export function connectWebSocket(
  clientId: string,
  callbacks: {
    onProgress?: (promptId: string, progress: ComfyUIProgress) => void;
    onExecutionStart?: (promptId: string) => void;
    onComplete?: (promptId: string) => void;
    onError?: (promptId: string, message: string) => void;
  }
): WebSocket {
  const ws = new WebSocket(`${COMFYUI_WS_URL}/ws?clientId=${clientId}`);

  // Track which prompts have already fired onExecutionStart (per connection)
  const startedPrompts = new Set<string>();
  // Guard against double-firing onComplete (executing:null + execution_success may both arrive)
  const completedPrompts = new Set<string>();

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const { type, data } = msg;

      if (type === 'progress' && callbacks.onProgress) {
        callbacks.onProgress(data.prompt_id, {
          value: data.value,
          max: data.max,
        });
      }

      if (type === 'executing') {
        // Use loose equality so both null and undefined (missing key) are treated as "done"
        if (data.node != null && !startedPrompts.has(data.prompt_id)) {
          startedPrompts.add(data.prompt_id);
          callbacks.onExecutionStart?.(data.prompt_id);
        }
        if (data.node == null && !completedPrompts.has(data.prompt_id)) {
          completedPrompts.add(data.prompt_id);
          startedPrompts.delete(data.prompt_id);
          callbacks.onComplete?.(data.prompt_id);
        }
      }

      // Newer ComfyUI versions also send execution_success as an explicit completion signal
      if (type === 'execution_success' && !completedPrompts.has(data.prompt_id)) {
        completedPrompts.add(data.prompt_id);
        startedPrompts.delete(data.prompt_id);
        callbacks.onComplete?.(data.prompt_id);
      }

      if (type === 'execution_error' && callbacks.onError) {
        callbacks.onError(data.prompt_id, data.exception_message || 'Unknown error');
      }
    } catch {
      // ignore non-JSON messages (binary preview frames etc.)
    }
  });

  ws.on('error', (err) => {
    console.error(`[ComfyUI WS] Error for client ${clientId}:`, err.message);
  });

  return ws;
}

export interface ComfyQueueItem {
  queueNumber: number;
  promptId: string;
  prompt: object;
  clientId: string;
}

export interface ComfyQueue {
  running: ComfyQueueItem[];
  pending: ComfyQueueItem[];
}

export async function getQueue(): Promise<ComfyQueue> {
  const res = await fetch(`${COMFYUI_URL}/queue`);
  if (!res.ok) throw new Error(`Get queue failed: ${res.status}`);
  const data = (await res.json()) as {
    queue_running: Array<[number, string, object, Record<string, string>, string[]]>;
    queue_pending: Array<[number, string, object, Record<string, string>, string[]]>;
  };
  const mapItem = (
    item: [number, string, object, Record<string, string>, string[]],
  ): ComfyQueueItem => ({
    queueNumber: item[0],
    promptId: item[1],
    prompt: item[2],
    clientId: item[3]?.client_id ?? '',
  });
  return {
    running: (data.queue_running ?? []).map(mapItem),
    pending: (data.queue_pending ?? []).map(mapItem),
  };
}

export interface PromptIdRemap {
  oldPromptId: string;
  newPromptId: string;
}

export async function getCheckpointModels(): Promise<string[]> {
  const res = await fetch(`${COMFYUI_URL}/object_info/CheckpointLoaderSimple`);
  if (!res.ok) throw new Error(`object_info failed: ${res.status}`);
  const data = (await res.json()) as {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [string[]] } } };
  };
  return data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
}

export async function prioritizeQueueItem(targetPromptId: string): Promise<PromptIdRemap[]> {
  const queue = await getQueue();
  const allPending = queue.pending;
  const targetIdx = allPending.findIndex((i) => i.promptId === targetPromptId);
  if (targetIdx <= 0) return []; // already first or not found

  // Delete all pending items at once
  const pendingIds = allPending.map((i) => i.promptId);
  const deleteRes = await fetch(`${COMFYUI_URL}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: pendingIds }),
  });
  if (!deleteRes.ok) throw new Error(`Delete queue failed: ${deleteRes.status}`);

  const mapping: PromptIdRemap[] = [];

  // Re-queue target first, then the rest in original order
  const target = allPending[targetIdx];
  const targetResult = await queuePrompt(target.prompt, target.clientId);
  mapping.push({ oldPromptId: target.promptId, newPromptId: targetResult.prompt_id });

  for (const item of allPending) {
    if (item.promptId === targetPromptId) continue;
    const result = await queuePrompt(item.prompt, item.clientId);
    mapping.push({ oldPromptId: item.promptId, newPromptId: result.prompt_id });
  }

  return mapping;
}
