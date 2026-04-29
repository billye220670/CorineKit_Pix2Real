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

// ── 阶段化进度追踪所需：prompt_id → 节点 ID → 节点信息 ───────────────────────
// 由 queuePrompt 在任务入队时登记每个节点的 class_type、_meta.title 和 weight，
// WebSocket 中继依此生成友好的阶段名与权重化的全局百分比，
// complete/error 时清理。
export interface PromptNodeInfo {
  classType: string;
  title: string;
  weight: number;
  isTiledSampler: boolean;
}

// 节点权重表：基于时间开销的相对值（1 权重 ≈ 1 个采样步的耗时）
const STATIC_NODE_WEIGHTS: Record<string, number> = {
  // 模型加载（磁盘 I/O，较慢）
  'CheckpointLoaderSimple': 15,
  'CheckpointLoader': 15,
  'UNETLoader': 15,
  'UNETLoaderGGUF': 15,
  'VAELoader': 5,
  'CLIPLoader': 5,
  'DualCLIPLoader': 8,
  'ControlNetLoader': 8,
  'UpscaleModelLoader': 5,
  'CLIPVisionLoader': 5,
  // LoRA 加载
  'LoraLoader': 5,
  'LoraLoaderModelOnly': 5,
  'LoraLoader|pysssss': 5,
  // 文本编码
  'CLIPTextEncode': 2,
  'BNK_CLIPTextEncodeAdvanced': 2,
  'CLIPTextEncodeSDXL': 2,
  // VAE
  'VAEEncode': 3,
  'VAEEncodeForInpaint': 3,
  'VAEDecode': 3,
  'VAEDecodeTiled': 4,
  // 放大
  'ImageUpscaleWithModel': 8,
  'NNLatentUpscale': 3,
  'LatentUpscale': 3,
  'LatentUpscaleBy': 3,
  // 视频
  'VHS_VideoCombine': 5,
  'VHS_LoadVideo': 3,
  // IO（快速）
  'SaveImage': 1,
  'PreviewImage': 1,
  'LoadImage': 1,
  'EmptyLatentImage': 1,
  // 换脸
  'ReActorFaceSwap': 10,
  'ReActorFaceSwapOpt': 10,
  'FaceSwapNode': 10,
  // 分割/识别
  'GroundingDinoSAMSegment (segment anything)': 8,
  'CLIPSeg': 5,
  // 反推
  'Florence2Run': 10,
  'WD14Tagger|pysssss': 8,
};

// 采样器类型：权重由 inputs.steps 动态决定
const SAMPLER_NODE_TYPES = new Set([
  'KSampler',
  'KSamplerAdvanced',
  'SamplerCustom',
  'SamplerCustomAdvanced',
  'KSampler (Efficient)',
]);

// Tiled 采样器：对图像分块重复采样，实际耗时 = steps × tile 数；
// tile 数取决于图片尺寸和放大倍率，无法静态精确计算，用经验平均值估算。
const TILED_SAMPLER_NODE_TYPES = new Set([
  'UltimateSDUpscale',
  'UltimateSDUpscaleNoUpscale',
]);
const ESTIMATED_TILE_COUNT = 8; // 保守估算：小图约 4，大图可达 100+，取偏下的中值避免过度膨胀

// 采样每步的权重系数：采样是整个工作流中 GPU 耗时最大的阶段，放大让其在进度条上占更大比重；
// 多采样器工作流（高清重绘/精修/二次元转真人）会自然按采样次数累加，总占比进一步放大。
export const SAMPLER_STEP_WEIGHT = 2.5;
const SAMPLER_DEFAULT_STEPS = 20; // 缺失 steps 时的夹保底

function getNodeWeight(classType: string, inputs?: Record<string, unknown>): number {
  if (SAMPLER_NODE_TYPES.has(classType)) {
    const steps = inputs?.steps;
    const base = typeof steps === 'number' && steps > 0 ? steps : SAMPLER_DEFAULT_STEPS;
    return base * SAMPLER_STEP_WEIGHT;
  }
  if (TILED_SAMPLER_NODE_TYPES.has(classType)) {
    // Tiled 采样：steps × 估算 tile 数 × 采样系数
    const steps = inputs?.steps;
    const base = typeof steps === 'number' && steps > 0 ? steps : 2;
    return base * ESTIMATED_TILE_COUNT * SAMPLER_STEP_WEIGHT;
  }
  return STATIC_NODE_WEIGHTS[classType] ?? 1;
}

const promptNodeInfo = new Map<string, Map<string, PromptNodeInfo>>();

export function getPromptNodeInfo(promptId: string, nodeId: string): PromptNodeInfo | undefined {
  return promptNodeInfo.get(promptId)?.get(nodeId);
}

export function getPromptTotalNodes(promptId: string): number {
  return promptNodeInfo.get(promptId)?.size ?? 0;
}

export function getPromptTotalWeight(promptId: string): number {
  const m = promptNodeInfo.get(promptId);
  if (!m) return 0;
  let total = 0;
  for (const info of m.values()) total += info.weight;
  return total;
}

export function clearPromptNodeInfo(promptId: string): void {
  promptNodeInfo.delete(promptId);
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

  const data = (await res.json()) as QueueResponse;
  // 登记每个节点的 class_type、可读标题、权重，供阶段化进度展示使用
  if (data?.prompt_id) {
    const nodeMap = new Map<string, PromptNodeInfo>();
    for (const [nodeId, node] of Object.entries(prompt as Record<string, { class_type?: string; _meta?: { title?: string }; inputs?: Record<string, unknown> }>)) {
      const classType = node?.class_type ?? '';
      nodeMap.set(nodeId, {
        classType,
        title: node?._meta?.title ?? '',
        weight: getNodeWeight(classType, node?.inputs),
        isTiledSampler: TILED_SAMPLER_NODE_TYPES.has(classType),
      });
    }
    promptNodeInfo.set(data.prompt_id, nodeMap);
  }
  return data;
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
  /** 产生此进度消息的节点 ID（ComfyUI 新版本中 progress 消息带此字段） */
  node?: string;
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
    /** 某个节点开始执行（data.node 非空时触发），用于全局进度追踪 */
    onExecutingNode?: (promptId: string, nodeId: string) => void;
    /** 被缓存跳过的节点列表（这些节点视为已完成），用于全局进度追踪 */
    onExecutionCached?: (promptId: string, cachedNodes: string[]) => void;
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
          node: data.node != null ? String(data.node) : undefined,
        });
      }

      // 被缓存跳过的节点（这些节点直接计为已完成，用于全局进度累计）
      if (type === 'execution_cached' && callbacks.onExecutionCached) {
        const cachedNodes: string[] = Array.isArray(data?.nodes)
          ? data.nodes.map((n: unknown) => String(n))
          : [];
        callbacks.onExecutionCached(data.prompt_id, cachedNodes);
      }

      if (type === 'executing') {
        // Use loose equality so both null and undefined (missing key) are treated as "done"
        if (data.node != null) {
          // 先触发 workflow 开始（只触发一次），确保前端先收到 execution_start
          // 再触发节点切换（伴随 progress 消息）
          if (!startedPrompts.has(data.prompt_id)) {
            startedPrompts.add(data.prompt_id);
            callbacks.onExecutionStart?.(data.prompt_id);
          }
          callbacks.onExecutingNode?.(data.prompt_id, String(data.node));
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

export async function getUnetModels(): Promise<string[]> {
  const res = await fetch(`${COMFYUI_URL}/object_info/UNETLoader`);
  if (!res.ok) throw new Error(`object_info failed: ${res.status}`);
  const data = (await res.json()) as {
    UNETLoader: { input: { required: { unet_name: [string[]] } } };
  };
  return data?.UNETLoader?.input?.required?.unet_name?.[0] ?? [];
}

export async function getLoraModels(): Promise<string[]> {
  const res = await fetch(`${COMFYUI_URL}/object_info/LoraLoader`);
  if (!res.ok) throw new Error(`object_info failed: ${res.status}`);
  const data = (await res.json()) as {
    LoraLoader: { input: { required: { lora_name: [string[]] } } };
  };
  return data?.LoraLoader?.input?.required?.lora_name?.[0] ?? [];
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
