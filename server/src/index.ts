import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import workflowRouter from './routes/workflow.js';
import outputRouter from './routes/output.js';
import sessionRouter from './routes/session.js';
import modelMetaRouter from './routes/modelMeta.js';
import agentRouter from './routes/agent.js';
import favoritesRouter, { favoritesBase } from './routes/favorites.js';
import settingsRouter from './routes/settings.js';
import promptsRouter from './routes/prompts.js';
import externalRouter, { saveExternalOutput, buildExternalResultUrl } from './routes/external.js';
import externalImagePushRouter from './routes/externalImagePush.js';
import { registerBroadcaster } from './services/wsHub.js';
import { getExternalCorsOrigins } from './config/externalApiConfig.js';
import { getTaskByPromptId, updateProgress, complete as completeExternalTask, fail as failExternalTask } from './services/externalTaskManager.js';
import { connectWebSocket, getHistory, getImageBuffer, getPromptNodeInfo, getPromptTotalNodes, getPromptTotalWeight, clearPromptNodeInfo, SAMPLER_STEP_WEIGHT } from './services/comfyui.js';
import { saveOutputFile } from './services/sessionManager.js';
import { loadConfigFromDisk, getSessionsBase, getDeleteComfyOutputAfterDownload, getComfyOutputDir } from './config/paths.js';
import { ensureComfyUI, isComfyUIRunning } from './services/comfyuiLauncher.js';
import type { HistoryEntry } from './types/index.js';

// ── 节点 class_type → 中文阶段名映射 ───────────────────────────────
// 未映射的节点将回退到用户在 ComfyUI 中的节点标题（_meta.title）
const STAGE_NAMES: Record<string, string> = {
  // 模型加载
  'CheckpointLoaderSimple': '加载主模型',
  'CheckpointLoader': '加载主模型',
  'UNETLoader': '加载 UNET',
  'UNETLoaderGGUF': '加载 UNET',
  'VAELoader': '加载 VAE',
  'CLIPLoader': '加载 CLIP',
  'DualCLIPLoader': '加载 CLIP',
  'ControlNetLoader': '加载 ControlNet',
  'UpscaleModelLoader': '加载放大模型',
  'CLIPVisionLoader': '加载 CLIP Vision',
  // LoRA 加载
  'LoraLoader': '加载 LoRA',
  'LoraLoaderModelOnly': '加载 LoRA',
  'LoraLoader|pysssss': '加载 LoRA',
  // 文本编码
  'CLIPTextEncode': '编码提示词',
  'BNK_CLIPTextEncodeAdvanced': '编码提示词',
  'CLIPTextEncodeSDXL': '编码提示词',
  // VAE 编解
  'VAEEncode': 'VAE 编码',
  'VAEEncodeForInpaint': 'VAE 编码',
  'VAEDecode': 'VAE 解码',
  'VAEDecodeTiled': 'VAE 解码',
  // 采样
  'KSampler': '采样中',
  'KSamplerAdvanced': '采样中',
  'SamplerCustom': '采样中',
  'SamplerCustomAdvanced': '采样中',
  'KSampler (Efficient)': '采样中',
  // 放大
  'ImageUpscaleWithModel': '放大图像',
  'NNLatentUpscale': '放大潜空间',
  'LatentUpscale': '放大潜空间',
  'LatentUpscaleBy': '放大潜空间',
  'UltimateSDUpscale': 'SD 放大采样',
  'UltimateSDUpscaleNoUpscale': 'SD 放大采样',
  // 视频
  'VHS_VideoCombine': '合成视频',
  'VHS_LoadVideo': '加载视频',
  // IO
  'SaveImage': '保存图像',
  'PreviewImage': '预览图像',
  'LoadImage': '加载图像',
  'EmptyLatentImage': '准备潜空间',
  // 换脸 / 识别
  'ReActorFaceSwap': '面部交换',
  'ReActorFaceSwapOpt': '面部交换',
  'FaceSwapNode': '面部交换',
  'GroundingDinoSAMSegment (segment anything)': '智能分割',
  'CLIPSeg': '智能分割',
  // 提示词反推
  'Florence2Run': '反推提示词',
  'WD14Tagger|pysssss': '反推提示词',
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputBase = path.resolve(__dirname, '../../output');

// Ensure output directories exist
const OUTPUT_DIRS = [
  '0-二次元转真人',
  '1-真人精修',
  '2-精修放大',
  '3-图生视频',
  '4-视频补帧',
  '5-解除装备',
  '6-真人转二次元',
  '7-快速出图',
  '8-黑兽换脸',
  '9-ZIT快出',
];
for (const dir of OUTPUT_DIRS) {
  const dirPath = path.join(outputBase, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Load persisted runtime config (sessions path override etc.) before anything touches paths
loadConfigFromDisk();

// Ensure sessions directory exists
const initialSessionsBase = getSessionsBase();
if (!fs.existsSync(initialSessionsBase)) {
  fs.mkdirSync(initialSessionsBase, { recursive: true });
}

// Ensure model_meta directories exist
const modelMetaBase = path.resolve(__dirname, '../../model_meta');
const modelMetaThumbnails = path.join(modelMetaBase, 'thumbnails');
if (!fs.existsSync(modelMetaThumbnails)) {
  fs.mkdirSync(modelMetaThumbnails, { recursive: true });
}

const app = express();
const server = createServer(app);

// CORS
// 现有前端来源保持不变，追加对外 API（/api/v1）配置的允许来源（不替换）。
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', ...getExternalCorsOrigins()],
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/api/workflow', workflowRouter);
app.use('/api/output', outputRouter);
app.use('/api/session', sessionRouter);

// Static serve output and sessions directories
app.use('/output', express.static(outputBase));
// 动态指向 sessionsBase：每次请求都读取当前配置，设置面板切换后无需重启
app.use('/api/session-files', (req, res, next) => {
  express.static(getSessionsBase())(req, res, next);
});
app.use('/model_meta', express.static(modelMetaBase));
app.use('/api/models', modelMetaRouter);
app.use('/api/agent', agentRouter);
app.use('/api/favorites', favoritesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/prompts', promptsRouter);
app.use('/api/v1', externalRouter);
app.use('/api/external-image-push', externalImagePushRouter);
app.use('/favorites', express.static(favoritesBase));

// ComfyUI 状态查询
app.get('/api/comfyui/status', async (req, res) => {
  try {
    const running = await isComfyUIRunning();
    res.json({ running });
  } catch {
    res.json({ running: false });
  }
});

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

// Inject the concrete broadcast implementation into wsHub so decoupled routes
// (e.g. external-image-push) can broadcast to all frontend clients without
// importing the wss instance directly.
registerBroadcaster((event) => {
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(event));
  });
});

function generateClientId(): string {
  // Simple UUID-like ID without external dependency
  return `pix2real_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

// Track prompt -> workflow/session mapping for output downloading
const promptWorkflowMap = new Map<string, { workflowId: number; sessionId: string; tabId: number }>();

// ── 全局进度追踪状态 ──────────────────────────────────────────────────────
// 全局进度 = (已完成权重 + 当前节点权重 × 当前节点内部进度) / 总权重
// 阶段化 + 权重化：权重基于节点时间开销（采样节点权重 = steps，模型加载权重 15，编码/VAE 权重 2-3）
interface PromptProgressState {
  totalNodes: number;
  totalWeight: number;
  completedWeight: number;
  stepIndex: number;
  currentNode: string | null;
  currentStage: string;
  currentNodeWeight: number;
  currentValue: number;
  currentMax: number;
  lastPercentage: number;
  // Tick 计数：统计当前节点收到的 progress 消息总数，用于多轮场景（如 UltimateSDUpscale）
  nodeTickCount: number;
  nodeIsMultiRound: boolean;
  nodeIsTiledSampler: boolean; // 预标记：该节点是否为 tiled sampler，始终用 tick 计数
}

// 进度快照：computeSnapshot 计算所得的对外可展示字段（含棘轮保护后的百分比）。
interface ProgressSnapshot {
  percentage: number;
  stage: string;
  value: number;
  max: number;
  stepIndex: number;
  stepTotal: number;
}

// ── 进度追踪器工厂 ─────────────────────────────────────────────────────────
// 将原先内联在 wss.on('connection') 闭包中的进度追踪逻辑抽取为可复用工厂：
// 前端连接与对外 API 常驻桥接连接各自持有一个独立实例（独立 promptProgressMap），互不干扰。
// 工厂只负责“计算进度快照”，不负责发送/落盘，由调用方决定如何消费快照。
function createProgressTracker() {
  const promptProgressMap = new Map<string, PromptProgressState>();

  function getOrInitProgress(promptId: string): PromptProgressState {
    let p = promptProgressMap.get(promptId);
    if (!p) {
      p = {
        totalNodes: getPromptTotalNodes(promptId),
        totalWeight: getPromptTotalWeight(promptId),
        completedWeight: 0,
        stepIndex: 0,
        currentNode: null,
        currentStage: '',
        currentNodeWeight: 0,
        currentValue: 0,
        currentMax: 0,
        lastPercentage: 0,
        nodeTickCount: 0,
        nodeIsMultiRound: false,
        nodeIsTiledSampler: false,
      };
      promptProgressMap.set(promptId, p);
    }
    return p;
  }

  function getStageName(promptId: string, nodeId: string): string {
    const info = getPromptNodeInfo(promptId, nodeId);
    if (!info) return '处理中';
    const mapped = STAGE_NAMES[info.classType];
    if (mapped) return mapped;
    if (info.title && info.title.trim()) return info.title.trim();
    return info.classType || '处理中';
  }

  function computeSnapshot(p: PromptProgressState): ProgressSnapshot {
    // 权重化全局百分比，封顶 99%，100% 留给 complete 确认
    let percentage: number;
    if (p.totalWeight > 0) {
      // 节点内部进度：多轮模式用 tick 计数，单轮用 value/max
      let nodeProgress: number;
      if (p.nodeIsTiledSampler || p.nodeIsMultiRound) {
        const expectedTicks = p.currentNodeWeight / SAMPLER_STEP_WEIGHT;
        nodeProgress = Math.min(0.95, p.nodeTickCount / expectedTicks);
      } else {
        nodeProgress = p.currentMax > 0 ? p.currentValue / p.currentMax : 0;
      }
      const pct = ((p.completedWeight + p.currentNodeWeight * nodeProgress) / p.totalWeight) * 100;
      percentage = Math.min(99, Math.max(0, Math.round(pct)));
    } else {
      percentage = p.currentMax > 0 ? Math.round((p.currentValue / p.currentMax) * 100) : 0;
    }
    // 棘轮保护：多轮间不让用户看到回退
    if (percentage < p.lastPercentage) percentage = p.lastPercentage;
    p.lastPercentage = percentage;
    return {
      percentage,
      stage: p.currentStage,
      value: p.currentValue,
      max: p.currentMax,
      stepIndex: p.stepIndex,
      stepTotal: p.totalNodes,
    };
  }

  return {
    start(promptId: string): void {
      getOrInitProgress(promptId);
    },
    cached(promptId: string, cachedNodes: string[]): void {
      // 缓存命中的节点直接跳过，将其权重计入 completedWeight（进度条会顺势推进）
      const p = getOrInitProgress(promptId);
      for (const nodeId of cachedNodes) {
        const info = getPromptNodeInfo(promptId, nodeId);
        p.completedWeight += info?.weight ?? 0;
      }
      p.stepIndex = Math.min(p.totalNodes || Number.MAX_SAFE_INTEGER, p.stepIndex + cachedNodes.length);
    },
    executingNode(promptId: string, nodeId: string): ProgressSnapshot {
      const p = getOrInitProgress(promptId);
      // 节点切换：将上一节点的完整权重计入 completedWeight，再切换到新节点
      if (p.currentNode !== nodeId) {
        if (p.currentNode !== null) {
          p.completedWeight += p.currentNodeWeight;
        }
        p.stepIndex = Math.min(p.totalNodes || Number.MAX_SAFE_INTEGER, p.stepIndex + 1);
        p.currentNode = nodeId;
        p.currentStage = getStageName(promptId, nodeId);
        const info = getPromptNodeInfo(promptId, nodeId);
        p.currentNodeWeight = info?.weight ?? 1;
        p.nodeIsTiledSampler = info?.isTiledSampler ?? false;
        p.currentValue = 0;
        p.currentMax = 0;
        p.nodeTickCount = 0;
        p.nodeIsMultiRound = false;
      }
      return computeSnapshot(p);
    },
    progress(promptId: string, progress: { value: number; max: number; node?: string }): ProgressSnapshot {
      const p = getOrInitProgress(promptId);
      // 若 progress 带了 node 字段且与当前不一致，同步刷新阶段与权重
      if (progress.node && progress.node !== p.currentNode) {
        if (p.currentNode !== null) {
          p.completedWeight += p.currentNodeWeight;
        }
        p.currentNode = progress.node;
        p.currentStage = getStageName(promptId, progress.node);
        const info = getPromptNodeInfo(promptId, progress.node);
        p.currentNodeWeight = info?.weight ?? 1;
        p.nodeIsTiledSampler = info?.isTiledSampler ?? false;
        p.nodeTickCount = 0;
        p.nodeIsMultiRound = false;
      }
      // 多轮检测：value 回退或 max 变化表示新一轮开始
      if (p.currentMax > 0 && (progress.value < p.currentValue || progress.max !== p.currentMax)) {
        p.nodeIsMultiRound = true;
      }
      p.nodeTickCount++;
      p.currentValue = progress.value;
      p.currentMax = progress.max;
      return computeSnapshot(p);
    },
    clear(promptId: string): void {
      promptProgressMap.delete(promptId);
    },
  };
}

// ── 对外 API 桥接（可复用） ────────────────────────────────────────────────
// 以下函数封装“外部任务”与 ComfyUI WebSocket 事件之间的桥接与产物落盘逻辑，
// 供前端连接与对外 API 常驻连接共用，避免逻辑分叉。所有函数内部均以 getTaskByPromptId
// 命中为前提，命中不了则跳过，确保前端/外部互不干扰、无重复落盘。

/** 重试拉取 ComfyUI history 直到 completed=true（或超时 10s），返回最终 history。 */
async function fetchCompletedHistory(promptId: string): Promise<HistoryEntry | undefined> {
  let history = await getHistory(promptId);
  let historyRetries = 0;
  const maxHistoryRetries = 50; // 50 * 200ms = 10s
  while (
    (!history || !history.status || history.status.completed !== true) &&
    historyRetries < maxHistoryRetries
  ) {
    await new Promise((r) => setTimeout(r, 200));
    history = await getHistory(promptId);
    historyRetries++;
  }
  return history;
}

/** 外部任务进度桥接：命中则同步进度（updateProgress 内部会置为 processing）。 */
function bridgeExternalProgress(promptId: string, percentage: number, stage?: string): void {
  if (getTaskByPromptId(promptId)) {
    updateProgress(promptId, percentage, stage);
  }
}

/**
 * 外部任务完成桥接：命中则下载 ComfyUI history 产物落盘到 output/_external/<taskId>/，
 * 再 completeExternalTask。命中不了直接返回；下载/落盘异常则 failExternalTask。
 */
async function bridgeExternalComplete(promptId: string, history: HistoryEntry | undefined): Promise<void> {
  const extTask = getTaskByPromptId(promptId);
  if (!extTask) return;
  try {
    const extOutputs: Array<{ filename: string; url: string }> = [];
    if (history && history.outputs) {
      for (const nodeOutput of Object.values(history.outputs)) {
        if (nodeOutput.images) {
          for (const img of nodeOutput.images) {
            if (img.type !== 'output') continue;
            try {
              const buffer = await getImageBuffer(img.filename, img.subfolder, img.type);
              const index = extOutputs.length;
              saveExternalOutput(extTask.taskId, index, img.filename, buffer);
              extOutputs.push({ filename: img.filename, url: buildExternalResultUrl(extTask.taskId, index) });
            } catch (err) {
              console.error(`[External API] Failed to persist output ${img.filename}:`, err);
            }
          }
        }
        if (nodeOutput.gifs) {
          for (const vid of nodeOutput.gifs) {
            try {
              const buffer = await getImageBuffer(vid.filename, vid.subfolder, vid.type);
              const index = extOutputs.length;
              saveExternalOutput(extTask.taskId, index, vid.filename, buffer);
              extOutputs.push({ filename: vid.filename, url: buildExternalResultUrl(extTask.taskId, index) });
            } catch (err) {
              console.error(`[External API] Failed to persist video ${vid.filename}:`, err);
            }
          }
        }
      }
    }
    completeExternalTask(promptId, extOutputs);
  } catch (err) {
    console.error(`[External API] bridgeExternalComplete failed for ${promptId}:`, err);
    failExternalTask(promptId, err instanceof Error ? err.message : String(err));
  }
}

/** 外部任务失败桥接：命中则标记失败。 */
function bridgeExternalError(promptId: string, message: string): void {
  if (getTaskByPromptId(promptId)) {
    failExternalTask(promptId, message);
  }
}

wss.on('connection', (clientWs) => {
  const clientId = generateClientId();
  console.log(`[WS] Client connected, assigned clientId: ${clientId}`);

  // Send the clientId to the client
  clientWs.send(JSON.stringify({ type: 'connected', clientId }));

  // Buffer recent execution_start/progress events per promptId so they can be
  // replayed if the client registers AFTER ComfyUI has already started processing
  // (common for the first card in a batch — no queue delay).
  const eventBuffer = new Map<string, object[]>();
  function bufferAndSend(promptId: string, event: object) {
    if (!eventBuffer.has(promptId)) eventBuffer.set(promptId, []);
    eventBuffer.get(promptId)!.push(event);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(event));
    }
  }

  // ── 全局进度追踪状态 ──────────────────────────────────────────────────────
  // 全局进度 = (已完成权重 + 当前节点权重 × 当前节点内部进度) / 总权重
  // 阶段化 + 权重化：权重基于节点时间开销（采样节点权重 = steps，模型加载权重 15，编码/VAE 权重 2-3）
  const tracker = createProgressTracker();
  // Connect to ComfyUI WebSocket with this clientId
  const comfyWs = connectWebSocket(clientId, {
    onExecutionStart(promptId) {
      tracker.start(promptId);
      bufferAndSend(promptId, { type: 'execution_start', promptId });
    },

    onExecutionCached(promptId, cachedNodes) {
      // 缓存命中的节点直接跳过，将其权重计入 completedWeight（进度条会顺势推进）
      tracker.cached(promptId, cachedNodes);
    },

    onExecutingNode(promptId, nodeId) {
      const snap = tracker.executingNode(promptId, nodeId);
      bufferAndSend(promptId, {
        type: 'progress',
        promptId,
        value: snap.value,
        max: snap.max,
        percentage: snap.percentage,
        stage: snap.stage,
        stepIndex: snap.stepIndex,
        stepTotal: snap.stepTotal,
      });
    },

    onProgress(promptId, progress) {
      const snap = tracker.progress(promptId, progress);
      bufferAndSend(promptId, {
        type: 'progress',
        promptId,
        value: snap.value,
        max: snap.max,
        percentage: snap.percentage,
        stage: snap.stage,
        stepIndex: snap.stepIndex,
        stepTotal: snap.stepTotal,
      });

      // ── 对外 API 桥接：命中外部任务则同步进度（复用 bridgeExternalProgress） ──
      bridgeExternalProgress(promptId, snap.percentage, snap.stage || undefined);
    },

    async onComplete(promptId) {
      console.log(`[WS] onComplete received for promptId ${promptId}`);

      // Wait for register message if it hasn't arrived yet (race condition fix)
      let retries = 0;
      const maxRetries = 20; // 20 * 100ms = 2s
      while (!promptWorkflowMap.has(promptId) && retries < maxRetries) {
        await new Promise(r => setTimeout(r, 100));
        retries++;
      }
      if (retries > 0) {
        console.log(`[WS] Waited ${retries * 100}ms for promptId ${promptId} registration`);
      }

      try {
        // Defense in depth: retry getHistory until ComfyUI has committed the history.
        // Even with the executing:null → execution_success preference in comfyui.ts,
        // /history/{promptId} may briefly return empty/incomplete on slower disks.
        // Without this retry, we'd send `complete` with outputs=[] and the card
        // would appear "done but empty" while the file actually exists in ComfyUI's output/.
        let history = await getHistory(promptId);
        let historyRetries = 0;
        const maxHistoryRetries = 50; // 50 * 200ms = 10s
        while (
          (!history || !history.status || history.status.completed !== true) &&
          historyRetries < maxHistoryRetries
        ) {
          await new Promise(r => setTimeout(r, 200));
          history = await getHistory(promptId);
          historyRetries++;
        }
        if (historyRetries > 0) {
          console.log(`[WS] Waited ${historyRetries * 200}ms for history of ${promptId} to be committed`);
        }
        if (!history || !history.status || history.status.completed !== true) {
          console.warn(`[WS] History never reached completed=true for ${promptId} after ${maxHistoryRetries * 200}ms; proceeding with whatever data we have`);
        }

        // Download outputs to session output directory
        const outputs: Array<{ filename: string; url: string }> = [];
        const info = promptWorkflowMap.get(promptId);

        if (!info) {
          console.warn(`[WS] No workflow mapping found for promptId ${promptId}, outputs will not be saved to session`);
        } else if (!info.sessionId) {
          console.warn(`[WS] Workflow mapping for ${promptId} has empty sessionId; outputs will not be saved to session`);
        }

        // Skip downloading entirely when there's no session to save to — saves bandwidth
        // and avoids confusing logs about "downloaded but discarded" buffers.
        const canSave = !!(info && info.sessionId);

        if (history && history.outputs && canSave) {
          for (const nodeOutput of Object.values(history.outputs)) {
            // Handle image outputs (only type "output", skip temp/preview)
            if (nodeOutput.images) {
              for (const img of nodeOutput.images) {
                if (img.type !== 'output') continue;
                try {
                  const buffer = await getImageBuffer(img.filename, img.subfolder, img.type);
                  const url = saveOutputFile(info!.sessionId, info!.tabId, img.filename, buffer);
                  outputs.push({ filename: img.filename, url });
                  // Delete ComfyUI source if setting is enabled
                  if (getDeleteComfyOutputAfterDownload()) {
                    const comfyOutDir = getComfyOutputDir();
                    if (comfyOutDir) {
                      const srcPath = img.subfolder
                        ? path.join(comfyOutDir, img.subfolder, img.filename)
                        : path.join(comfyOutDir, img.filename);
                      try {
                        fs.unlinkSync(srcPath);
                        console.log(`[WS] Deleted ComfyUI source: ${srcPath}`);
                      } catch (delErr) {
                        console.warn(`[WS] Failed to delete ComfyUI source ${srcPath}:`, delErr);
                      }
                    }
                  }
                } catch (err) {
                  console.error(`[WS] Failed to download output ${img.filename}:`, err);
                }
              }
            }

            // Handle video outputs (gifs field from VHS_VideoCombine)
            if (nodeOutput.gifs) {
              for (const vid of nodeOutput.gifs) {
                try {
                  const buffer = await getImageBuffer(vid.filename, vid.subfolder, vid.type);
                  const url = saveOutputFile(info!.sessionId, info!.tabId, vid.filename, buffer);
                  outputs.push({ filename: vid.filename, url });
                  // Delete ComfyUI source if setting is enabled
                  if (getDeleteComfyOutputAfterDownload()) {
                    const comfyOutDir = getComfyOutputDir();
                    if (comfyOutDir) {
                      const srcPath = vid.subfolder
                        ? path.join(comfyOutDir, vid.subfolder, vid.filename)
                        : path.join(comfyOutDir, vid.filename);
                      try {
                        fs.unlinkSync(srcPath);
                        console.log(`[WS] Deleted ComfyUI source: ${srcPath}`);
                      } catch (delErr) {
                        console.warn(`[WS] Failed to delete ComfyUI source ${srcPath}:`, delErr);
                      }
                    }
                  }
                } catch (err) {
                  console.error(`[WS] Failed to download video ${vid.filename}:`, err);
                }
              }
            }
          }
        } else if (canSave) {
          // canSave but history empty — this is the "card empty" symptom.
          console.warn(`[WS] No outputs in history for ${promptId} despite completed status; card will appear empty. ComfyUI history dump:`, JSON.stringify(history));
        }

        console.log(`[WS] Sending complete for ${promptId}, outputs: ${outputs.length}`, outputs.map(o => o.filename));

        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'complete',
            promptId,
            outputs,
          }));
        }

        // ── 对外 API 桥接：命中外部任务则落盘结果并标记完成（复用 bridgeExternalComplete） ──
        // 外部任务无 register/session，不走上面的 session 保存路径；bridgeExternalComplete 独立
        // 下载 ComfyUI 产物到 output/_external/<taskId>/ 并构造对外 url，命中不了则跳过。
        await bridgeExternalComplete(promptId, history);

        // Cleanup
        promptWorkflowMap.delete(promptId);
        eventBuffer.delete(promptId);
        tracker.clear(promptId);
        clearPromptNodeInfo(promptId);
      } catch (err) {
        console.error(`[WS] Error processing completion for ${promptId}:`, err);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'complete',
            promptId,
            outputs: [],
          }));
        }
        // 对外 API 桥接：完成处理异常时，将外部任务标记为失败，避免其永久停留在处理中。
        bridgeExternalError(promptId, err instanceof Error ? err.message : String(err));
        tracker.clear(promptId);
        clearPromptNodeInfo(promptId);
      }
    },

    onError(promptId, message) {
      console.error(`[WS] Prompt ${promptId} error: ${message}`);
      eventBuffer.delete(promptId);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'error',
          promptId,
          message,
        }));
      }
      // ── 对外 API 桥接：命中外部任务则标记失败（复用 bridgeExternalError） ──
      bridgeExternalError(promptId, message);
      promptWorkflowMap.delete(promptId);
      tracker.clear(promptId);
      clearPromptNodeInfo(promptId);
    },
  });

  // Listen for messages from the client (e.g., register prompt -> workflow/session mapping)
  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'register' && msg.promptId && msg.workflowId !== undefined) {
        promptWorkflowMap.set(msg.promptId, {
          workflowId: msg.workflowId,
          sessionId: msg.sessionId || '',
          tabId: msg.tabId ?? msg.workflowId,
        });
        // Replay any buffered events the client may have missed because ComfyUI
        // started processing before the client finished registering.
        const buffered = eventBuffer.get(msg.promptId) ?? [];
        for (const event of buffered) {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify(event));
          }
        }
      }
    } catch {
      // ignore
    }
  });

  clientWs.on('close', () => {
    console.log(`[WS] Client ${clientId} disconnected`);
    comfyWs.close();
  });
});

const PORT = process.env.PORT || 3000;

// ── 对外 API 常驻 ComfyUI WebSocket 桥接连接 ──────────────────────────
// 根因：对外 API 提交任务用固定 clientId，但此前只有前端浏览器连接 /ws 时才会建立到
// ComfyUI 的监听；外部任务的 clientId 无对应连接 → ComfyUI 定向消息全部丢失 → 任务永远
// queued。这里在服务器启动后建立一条常驻连接（固定 clientId），专门桥接外部任务的
// 进度/完成/失败，复用与前端连接相同的进度追踪器与桥接函数。
const EXTERNAL_BRIDGE_CLIENT_ID = 'pix2real_external_api';
const EXTERNAL_BRIDGE_RECONNECT_MS = 3000;
let externalBridgeWs: WebSocket | null = null;
let externalBridgeReconnectTimer: NodeJS.Timeout | null = null;

function scheduleExternalBridgeReconnect(): void {
  if (externalBridgeReconnectTimer) return; // 已有待执行的重连，避免叠加
  externalBridgeReconnectTimer = setTimeout(() => {
    externalBridgeReconnectTimer = null;
    connectExternalBridge();
  }, EXTERNAL_BRIDGE_RECONNECT_MS);
}

function connectExternalBridge(): void {
  // 防重复：已有存活/正在建立的连接则不再新建，避免叠加多条常驻连接。
  if (
    externalBridgeWs &&
    (externalBridgeWs.readyState === WebSocket.OPEN || externalBridgeWs.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  // 常驻连接专属的进度追踪器（独立实例，与前端连接互不干扰）
  const tracker = createProgressTracker();
  console.log(`[External Bridge] Connecting resident ComfyUI WS (clientId=${EXTERNAL_BRIDGE_CLIENT_ID})`);

  const ws = connectWebSocket(EXTERNAL_BRIDGE_CLIENT_ID, {
    onExecutionStart(promptId) {
      tracker.start(promptId);
    },
    onExecutionCached(promptId, cachedNodes) {
      tracker.cached(promptId, cachedNodes);
    },
    onExecutingNode(promptId, nodeId) {
      const snap = tracker.executingNode(promptId, nodeId);
      bridgeExternalProgress(promptId, snap.percentage, snap.stage || undefined);
    },
    onProgress(promptId, progress) {
      const snap = tracker.progress(promptId, progress);
      bridgeExternalProgress(promptId, snap.percentage, snap.stage || undefined);
    },
    async onComplete(promptId) {
      // 仅处理命中外部任务的 promptId；前端任务走各自连接，这里不会命中。
      if (!getTaskByPromptId(promptId)) {
        tracker.clear(promptId);
        return;
      }
      console.log(`[External Bridge] onComplete for external promptId ${promptId}`);
      try {
        const history = await fetchCompletedHistory(promptId);
        await bridgeExternalComplete(promptId, history);
      } catch (err) {
        bridgeExternalError(promptId, err instanceof Error ? err.message : String(err));
      } finally {
        tracker.clear(promptId);
        clearPromptNodeInfo(promptId);
      }
    },
    onError(promptId, message) {
      bridgeExternalError(promptId, message);
      tracker.clear(promptId);
      clearPromptNodeInfo(promptId);
    },
  });

  externalBridgeWs = ws;

  ws.on('open', () => {
    console.log('[External Bridge] Resident ComfyUI WS connected');
  });

  // 断线自动重连：close/error 后延迟重建，且用单一 timer 防止重复叠加。
  ws.on('close', () => {
    console.warn('[External Bridge] Resident ComfyUI WS closed; scheduling reconnect');
    if (externalBridgeWs === ws) externalBridgeWs = null;
    scheduleExternalBridgeReconnect();
  });
  ws.on('error', () => {
    // connectWebSocket 内部已记录错误详情；这里确保出错也触发重连（close 常随其后）。
    if (externalBridgeWs === ws) externalBridgeWs = null;
    scheduleExternalBridgeReconnect();
  });
}

// 启动服务器
async function startServer() {
  // 尝试自动启动 ComfyUI
  try {
    await ensureComfyUI();
  } catch (err) {
    console.error('[ComfyUI] ⚠️ 自动启动失败，请手动启动 ComfyUI 后继续使用');
    console.error('[ComfyUI]', err instanceof Error ? err.message : err);
  }

  server.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
    console.log(`[Server] WebSocket on ws://localhost:${PORT}/ws`);
    console.log(`[Server] Output directory: ${outputBase}`);
    // 服务器就绪后建立对外 API 常驻桥接连接（修复外部任务永远 queued 的 bug）。
    connectExternalBridge();
  });
}

startServer();
