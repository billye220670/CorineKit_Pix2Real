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

export function connectWebSocket(
  clientId: string,
  callbacks: {
    onProgress?: (promptId: string, progress: ComfyUIProgress) => void;
    onComplete?: (promptId: string) => void;
    onError?: (promptId: string, message: string) => void;
  }
): WebSocket {
  const ws = new WebSocket(`${COMFYUI_WS_URL}/ws?clientId=${clientId}`);

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
        if (data.node === null && callbacks.onComplete) {
          callbacks.onComplete(data.prompt_id);
        }
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
