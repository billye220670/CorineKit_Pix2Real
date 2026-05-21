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
import { connectWebSocket, getHistory, getImageBuffer, getPromptNodeInfo, getPromptTotalNodes, getPromptTotalWeight, clearPromptNodeInfo, SAMPLER_STEP_WEIGHT } from './services/comfyui.js';
import { saveOutputFile } from './services/sessionManager.js';
import { loadConfigFromDisk, getSessionsBase } from './config/paths.js';
import { ensureComfyUI, isComfyUIRunning } from './services/comfyuiLauncher.js';

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
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
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

function generateClientId(): string {
  // Simple UUID-like ID without external dependency
  return `pix2real_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

// Track prompt -> workflow/session mapping for output downloading
const promptWorkflowMap = new Map<string, { workflowId: number; sessionId: string; tabId: number }>();

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

  function emitProgress(promptId: string, p: PromptProgressState) {
    // 权重化全局百分比，封顶 99%，100% 留给 complete 确认
    let percentage: number;
    if (p.totalWeight > 0) {
      // 节点内部进度：多轮模式用 tick 计数，单轮用 value/max
      let nodeProgress: number;
      if (p.nodeIsTiledSampler || p.nodeIsMultiRound) {
        // Tiled sampler 或多轮节点：用 tick 数 / 预期 tick 数，线性递增不受 max 重置影响
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
    bufferAndSend(promptId, {
      type: 'progress',
      promptId,
      value: p.currentValue,
      max: p.currentMax,
      percentage,
      stage: p.currentStage,
      stepIndex: p.stepIndex,
      stepTotal: p.totalNodes,
    });
  }
  // Connect to ComfyUI WebSocket with this clientId
  const comfyWs = connectWebSocket(clientId, {
    onExecutionStart(promptId) {
      getOrInitProgress(promptId);
      bufferAndSend(promptId, { type: 'execution_start', promptId });
    },

    onExecutionCached(promptId, cachedNodes) {
      // 缓存命中的节点直接跳过，将其权重计入 completedWeight（进度条会顺势推进）
      const p = getOrInitProgress(promptId);
      for (const nodeId of cachedNodes) {
        const info = getPromptNodeInfo(promptId, nodeId);
        p.completedWeight += info?.weight ?? 0;
      }
      p.stepIndex = Math.min(p.totalNodes || Number.MAX_SAFE_INTEGER, p.stepIndex + cachedNodes.length);
    },

    onExecutingNode(promptId, nodeId) {
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
      emitProgress(promptId, p);
    },

    onProgress(promptId, progress) {
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
      emitProgress(promptId, p);
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

        // Cleanup
        promptWorkflowMap.delete(promptId);
        eventBuffer.delete(promptId);
        promptProgressMap.delete(promptId);
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
        promptProgressMap.delete(promptId);
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
      promptWorkflowMap.delete(promptId);
      promptProgressMap.delete(promptId);
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
  });
}

startServer();
