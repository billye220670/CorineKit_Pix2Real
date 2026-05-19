import express, { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import multer from 'multer';
import fetch from 'node-fetch';
import { getAdapter, adapters } from '../adapters/index.js';
import { workflow5Adapter } from '../adapters/Workflow5Adapter.js';
import { workflow10Adapter } from '../adapters/Workflow10Adapter.js';
import { uploadImage, uploadVideo, queuePrompt, deleteQueueItem, getSystemStats, getQueue, prioritizeQueueItem, getHistory, getImageBuffer, getCheckpointModels, getUnetModels, getLoraModels } from '../services/comfyui.js';
import { getSessionsBase } from '../services/sessionManager.js';
import { callLLM, buildSmartLoraPrompt, buildTriggerInsertPrompt, PROXY_AGENT } from '../services/llmService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseMemoryTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-释放内存.json');
const removeEquipTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-解除装备Fixed.json');
const text2imgTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-二次元生成.json');
const promptAssistantTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-提示词助手.json');
const faceSwapTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-换面.json');
const kleinTemplatePath    = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-高清重绘.json');
const kleinProTemplatePath  = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-Klein重绘Pro.json');
const sdUpscaleTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-SD放大.json');
const zitTemplatePath      = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-ZIT文生图NEW2.json');
const text2imgProTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/二次元生成 (PRO).json');
const zitRefDir            = path.resolve(__dirname, '../../../zit_ref');

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * 处理 LoRA 节点的赋值和动态重连
 * @param template - 工作流 JSON 模板
 * @param loraNodeIds - LoRA 节点 ID 数组
 * @param loras - 用户的 LoRA 配置数组
 * @param checkpointNodeId - Checkpoint 节点 ID
 * @param outputNodes - 需要接收 LoRA 输出的节点映射
 */
function applyLoraChain(
  template: any,
  loraNodeIds: string[],
  loras: Array<{ model: string; enabled: boolean; strength: number }>,
  checkpointNodeId: string,
  outputNodes: Array<{ nodeId: string; field: 'model' | 'clip'; slot: number }>
): void {
  // Set lora_name and strength for each LoRA node
  loras.forEach((lora, i) => {
    if (i < loraNodeIds.length) {
      template[loraNodeIds[i]].inputs.lora_name = lora.model;
      template[loraNodeIds[i]].inputs.strength_model = lora.strength;
      template[loraNodeIds[i]].inputs.strength_clip = lora.strength;
    }
  });

  // Find enabled LoRA indices
  const modelSource: [string, number] = [checkpointNodeId, 0];
  const clipSource: [string, number] = [checkpointNodeId, 1];
  const enabledIndices = loras.map((l, i) => l.enabled ? i : -1).filter(i => i >= 0 && i < loraNodeIds.length);

  if (enabledIndices.length === 0) {
    // All disabled: output nodes connect directly to Checkpoint
    for (const out of outputNodes) {
      template[out.nodeId].inputs[out.field] = out.slot === 0 ? modelSource : clipSource;
    }
  } else {
    // First enabled LoRA connects to Checkpoint
    const firstIdx = enabledIndices[0];
    template[loraNodeIds[firstIdx]].inputs.model = modelSource;
    template[loraNodeIds[firstIdx]].inputs.clip = clipSource;

    // Chain enabled LoRAs together
    for (let k = 1; k < enabledIndices.length; k++) {
      const curr = enabledIndices[k];
      const prev = enabledIndices[k - 1];
      template[loraNodeIds[curr]].inputs.model = [loraNodeIds[prev], 0];
      template[loraNodeIds[curr]].inputs.clip = [loraNodeIds[prev], 1];
    }

    // Last enabled LoRA outputs to downstream nodes
    const lastIdx = enabledIndices[enabledIndices.length - 1];
    for (const out of outputNodes) {
      template[out.nodeId].inputs[out.field] = [loraNodeIds[lastIdx], out.slot];
    }
  }
}

// ── 从图片 Buffer 解析宽高（支持 PNG / JPEG / WebP）───────────────
function getImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  // PNG: 签名 89 50，IHDR 从第 16 字节开始，宽高各 4 字节大端序
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }
  // JPEG: 找 SOF 标记 (0xFF 0xC0–0xCF, 排除 0xC4/0xC8/0xCC)
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2;
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 0xFF) { offset++; continue; }
      const marker = buffer[offset + 1];
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height };
      }
      const len = buffer.readUInt16BE(offset + 2);
      offset += 2 + len;
    }
  }
  // WebP: RIFF header
  if (buffer.length > 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    if (buffer.toString('ascii', 12, 16) === 'VP8 ') {
      const width = buffer.readUInt16LE(26) & 0x3FFF;
      const height = buffer.readUInt16LE(28) & 0x3FFF;
      return { width, height };
    }
  }
  return null;
}
const uploadFields = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 },
]);

// ── ComfyUI 错误到用户友好提示的统一映射 ───────────────────────
// ComfyUI 校验失败时报 value_not_in_list，此处识别出具体字段（ckpt/lora/unet）并折算成中文提示。
// 其他未知错误回落原始 message，保留调试能力。
function toFriendlyComfyError(err: any): string {
  const errStr = err?.message || String(err);
  if (errStr.includes('value_not_in_list') && errStr.includes('ckpt_name')) {
    return '模型文件未找到，请检查 ComfyUI 模型是否已正确安装';
  }
  if (errStr.includes('value_not_in_list') && errStr.includes('lora_name')) {
    return 'LoRA 文件未找到，请检查 LoRA 是否已正确安装';
  }
  if (errStr.includes('value_not_in_list') && errStr.includes('unet_name')) {
    return 'UNET 模型文件未找到，请检查模型是否已正确安装';
  }
  if (errStr.includes('value_not_in_list') && errStr.includes('vae_name')) {
    return 'VAE 文件未找到，请检查 VAE 是否已正确安装';
  }
  if (errStr.includes('value_not_in_list') && errStr.includes('control_net_name')) {
    return 'ControlNet 模型未找到，请检查是否已正确安装';
  }
  if (errStr.includes('Queue prompt failed')) {
    return '工作流提交失败，请检查 ComfyUI 是否正常运行';
  }
  return errStr || 'Internal server error';
}

// GET /api/workflows - list all workflows
router.get('/', (_req, res) => {
  const list = Object.values(adapters).map((a) => ({
    id: a.id,
    name: a.name,
    needsPrompt: a.needsPrompt,
    basePrompt: a.basePrompt,
  }));
  res.json(list);
});

// POST /api/workflow/5/execute — 解除装备: requires both original image and mask
router.post('/5/execute', uploadFields, async (req, res) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const imageFile = files?.['image']?.[0];
    const maskFile  = files?.['mask']?.[0];

    if (!imageFile) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }
    if (!maskFile) {
      res.status(400).json({ error: 'No mask file provided' });
      return;
    }

    const clientId = (req.query.clientId as string | undefined) || req.body.clientId;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    const backPose  = req.body.backPose === 'true';
    const userPrompt: string = req.body.prompt || '';

    // Upload both files to ComfyUI
    const originalFilename = await uploadImage(imageFile.buffer, imageFile.originalname);
    const maskFilename     = await uploadImage(maskFile.buffer,  maskFile.originalname);

    // Patch template
    const template = JSON.parse(fs.readFileSync(removeEquipTemplatePath, 'utf-8'));
    template['313'].inputs.image   = originalFilename;
    template['385'].inputs.image   = maskFilename;
    template['389'].inputs.boolean = backPose;
    template['315'].inputs.seed    = Math.floor(Math.random() * 1125899906842624);
    // Prompt: user text replaces default entirely; empty = keep JSON default
    if (userPrompt.trim()) {
      template['314'].inputs.text = userPrompt.trim();
    }

    const result = await queuePrompt(template, clientId);

    res.json({
      promptId:     result.prompt_id,
      clientId,
      workflowId:   5,
      workflowName: workflow5Adapter.name,
    });
  } catch (err: any) {
    console.error('[Workflow 5 Execute Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// POST /api/workflow/10/execute — 区域编辑: requires both original image and mask
router.post('/10/execute', uploadFields, async (req, res) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const imageFile = files?.['image']?.[0];
    const maskFile  = files?.['mask']?.[0];

    if (!imageFile) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }
    if (!maskFile) {
      res.status(400).json({ error: 'No mask file provided' });
      return;
    }

    const clientId = (req.query.clientId as string | undefined) || req.body.clientId;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    const backPose  = req.body.backPose === 'true';
    const userPrompt: string = req.body.prompt || '';

    // Upload both files to ComfyUI
    const originalFilename = await uploadImage(imageFile.buffer, imageFile.originalname);
    const maskFilename     = await uploadImage(maskFile.buffer,  maskFile.originalname);

    // Patch template
    const template = JSON.parse(fs.readFileSync(removeEquipTemplatePath, 'utf-8'));
    template['313'].inputs.image   = originalFilename;
    template['385'].inputs.image   = maskFilename;
    template['389'].inputs.boolean = backPose;
    template['315'].inputs.seed    = Math.floor(Math.random() * 1125899906842624);
    // Prompt: always set, even if empty (区域编辑 specific behavior)
    template['314'].inputs.text = userPrompt;

    const result = await queuePrompt(template, clientId);

    res.json({
      promptId:     result.prompt_id,
      clientId,
      workflowId:   10,
      workflowName: workflow10Adapter.name,
    });
  } catch (err: any) {
    console.error('[Workflow 10 Execute Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// POST /api/workflow/7/execute — 快速出图: text-to-image, JSON body (no file upload)
router.post('/7/execute', express.json(), async (req, res) => {
  try {
    const { clientId, model, loras, prompt, negativePrompt, width, height, steps, cfg, sampler, scheduler, name, seed: clientSeed } = req.body as {
      clientId: string;
      model: string;
      loras?: Array<{ model: string; enabled: boolean; strength: number }>;
      prompt: string;
      negativePrompt?: string;
      width: number;
      height: number;
      steps: number;
      cfg: number;
      sampler: string;
      scheduler: string;
      name?: string;
      seed?: number;
    };

    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    // ── PRO 工作流分支：当包含 referenceImage 时使用二次元生成 (PRO) 模板 ──
    const referenceImage: string | undefined = req.body.referenceImage;
    if (referenceImage) {
      const refPath = path.join(zitRefDir, path.basename(referenceImage));
      if (!fs.existsSync(refPath)) {
        res.status(400).json({ error: '参考图文件不存在' });
        return;
      }
      const refBuffer = fs.readFileSync(refPath);
      const comfyRefFilename = await uploadImage(refBuffer, referenceImage);

      const proTemplate = JSON.parse(fs.readFileSync(text2imgProTemplatePath, 'utf-8'));
      proTemplate['4'].inputs.ckpt_name = model;
      proTemplate['3'].inputs.seed = Number.isFinite(clientSeed) ? Math.floor(clientSeed as number) : Math.floor(Math.random() * 2 ** 32);
      proTemplate['3'].inputs.steps = steps;
      proTemplate['3'].inputs.cfg = cfg;
      proTemplate['3'].inputs.sampler_name = sampler;
      proTemplate['3'].inputs.scheduler = scheduler;
      proTemplate['39'].inputs.prompt = prompt;
      proTemplate['64'].inputs.prompt = negativePrompt || '';
      proTemplate['50'].inputs.image = comfyRefFilename;
      proTemplate['49'].inputs.strength = req.body.depthStrength ?? 0.3;
      proTemplate['57'].inputs.strength = req.body.poseStrength ?? 0.5;
      // 当用户选择了非原图比例时，用指定的 width/height 覆盖 Node #5
      if (!req.body.useOriginalRatio && width && height) {
        proTemplate['5'].inputs.width = width;
        proTemplate['5'].inputs.height = height;
      }
      if (name) {
        // ComfyUI SaveImage 把 filename_prefix 中的 "/" 与 "\" 视为 subfolder 分隔符，
        // 多条 prompt 若 "/" 后字段相同会产生同名输出文件（subfolder 不同但本地 saveOutputFile
        // 只用 filename），导致后写者覆盖先写者，前端呈现为"一模一样"。这里统一替换为 "-"。
        proTemplate['45'].inputs.filename_prefix = name.replace(/[/\\]/g, '-');
      }

      // LoRA handling for PRO workflow (nodes 70-74)
      const proLoras = loras && loras.length > 0 ? loras : [];
      applyLoraChain(
        proTemplate,
        ['70', '71', '72', '73', '74'],
        proLoras,
        '4',
        [
          { nodeId: '3', field: 'model', slot: 0 },
          { nodeId: '6', field: 'clip', slot: 1 },
          { nodeId: '7', field: 'clip', slot: 1 },
        ]
      );

      const result = await queuePrompt(proTemplate, clientId);
      res.json({
        promptId: result.prompt_id,
        clientId,
        workflowId: 7,
        workflowName: '快速出图(PRO)',
      });
      return;
    }

    const template = JSON.parse(fs.readFileSync(text2imgTemplatePath, 'utf-8'));

    // Node 4: checkpoint model
    template['4'].inputs.ckpt_name = model;
    // Node 5: image dimensions
    template['5'].inputs.width = width;
    template['5'].inputs.height = height;
    // Node 3: sampler settings + random seed (前端可传 seed 确保批量生成时不重复)
    template['3'].inputs.seed = Number.isFinite(clientSeed) ? Math.floor(clientSeed as number) : Math.floor(Math.random() * 1125899906842624);
    template['3'].inputs.steps = steps;
    template['3'].inputs.cfg = cfg;
    template['3'].inputs.sampler_name = sampler;
    template['3'].inputs.scheduler = scheduler;
    // Node 39: user prompt (replaces default; empty = keep JSON default)
    if (prompt !== undefined) {
      template['39'].inputs.prompt = prompt;
    }
    // 节点 7：负面提示词（用户额外负面提示词追加到默认文本前面）
    if (negativePrompt && negativePrompt.trim()) {
      template['7'].inputs.text = negativePrompt.trim() + ', ' + template['7'].inputs.text;
    }
    // Node 45: output filename prefix
    if (name) {
      // 同上 PRO 分支说明：防止 "/" 被 ComfyUI 当作 subfolder 分隔符导致输出文件名碰撞、本地覆盖。
      template['45'].inputs.filename_prefix = name.replace(/[/\\]/g, '-');
    }

    // LoRA handling: nodes 50, 51, 52, 53, 54 chained from Checkpoint #4
    const tab7Loras = loras && loras.length > 0 ? loras : [];
    applyLoraChain(
      template,
      ['50', '51', '52', '53', '54'],
      tab7Loras,
      '4',
      [
        { nodeId: '3', field: 'model', slot: 0 },
        { nodeId: '6', field: 'clip', slot: 1 },
        { nodeId: '7', field: 'clip', slot: 1 },
      ]
    );

    const result = await queuePrompt(template, clientId);

    res.json({
      promptId: result.prompt_id,
      clientId,
      workflowId: 7,
      workflowName: '快速出图',
    });
  } catch (err: any) {
    console.error('[Workflow 7 Execute Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// GET /api/workflow/models/checkpoints — list available checkpoint models from ComfyUI
router.get('/models/checkpoints', async (_req, res) => {
  try {
    const models = await getCheckpointModels();
    res.json(models);
  } catch {
    res.status(502).json([]);
  }
});

// GET /api/workflow/models/unets — list available UNET models from ComfyUI
router.get('/models/unets', async (_req, res) => {
  try {
    const models = await getUnetModels();
    res.json(models);
  } catch {
    res.status(502).json([]);
  }
});

// GET /api/workflow/models/loras — list available LoRA models from ComfyUI
router.get('/models/loras', async (_req, res) => {
  try {
    const models = await getLoraModels();
    res.json(models);
  } catch {
    res.status(502).json([]);
  }
});

// ── Tab 7 参考图管理 ─────────────────────────────────────────────
const uploadRefImage = multer({ storage: multer.memoryStorage() }).single('image');

// POST /api/workflow/7/ref-image — 上传参考图
router.post('/7/ref-image', uploadRefImage, async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }
    if (!fs.existsSync(zitRefDir)) fs.mkdirSync(zitRefDir, { recursive: true });
    const ext = path.extname(req.file.originalname) || '.png';
    const filename = `${crypto.randomUUID()}${ext}`;
    const savePath = path.join(zitRefDir, filename);
    fs.writeFileSync(savePath, req.file.buffer);
    const dims = getImageDimensions(req.file.buffer);
    res.json({ filename, url: `/api/workflow/7/ref-image/${filename}`, width: dims?.width ?? 0, height: dims?.height ?? 0 });
  } catch (err: any) {
    console.error('[Workflow 7] ref-image upload error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/workflow/7/ref-image/:filename — 提供参考图访问
router.get('/7/ref-image/:filename', (req, res) => {
  const filePath = path.join(zitRefDir, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  };
  res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
  res.send(fs.readFileSync(filePath));
});

// DELETE /api/workflow/7/ref-image/:filename — 删除参考图
router.delete('/7/ref-image/:filename', (req, res) => {
  const filePath = path.join(zitRefDir, path.basename(req.params.filename));
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* ignore */ }
  res.json({ ok: true });
});

// POST /api/workflow/9/execute — ZIT快出: text-to-image with UNet + LoRA, JSON body (no file upload)
router.post('/9/execute', express.json(), async (req, res) => {
  try {
    const { clientId, unetModel, loras, shiftEnabled, shift, prompt, width, height, steps, cfg, sampler, scheduler, name } = req.body as {
      clientId: string;
      unetModel: string;
      loras?: Array<{ model: string; enabled: boolean; strength: number }>;
      shiftEnabled: boolean;
      shift: number;
      prompt: string;
      width: number;
      height: number;
      steps: number;
      cfg: number;
      sampler: string;
      scheduler: string;
      name?: string;
    };

    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    const template = JSON.parse(fs.readFileSync(zitTemplatePath, 'utf-8'));

    // Node 25: UNET model
    template['25'].inputs.unet_name = unetModel;
    // Node 45: AuraFlow shift value
    template['45'].inputs.shift = shift ?? 3;
    // Node 7: image dimensions
    template['7'].inputs.width = width;
    template['7'].inputs.height = height;
    // Node 4: sampler settings + random seed
    template['4'].inputs.seed = Math.floor(Math.random() * 1125899906842624);
    template['4'].inputs.steps = steps;
    template['4'].inputs.cfg = cfg;
    template['4'].inputs.sampler_name = sampler;
    template['4'].inputs.scheduler = scheduler;
    // Node 5: prompt text
    if (prompt !== undefined) {
      template['5'].inputs.text = prompt;
    }
    // NEW2: #47(ifElse) 控制 shift 开关: true→#45(shift), false→最后启用的LoRA
    // KSampler #4 始终从 #47 取模型
    template['47'].inputs.boolean = shiftEnabled;

    // LoRA handling: nodes 36, 50, 51, 52, 53 chained from UNet #25 (model) and CLIP #26 (clip)
    const tab9LoraNodeIds = ['36', '50', '51', '52', '53'];
    const tab9Loras = loras && loras.length > 0 ? loras : [];

    // Set lora_name and strength for each LoRA node
    tab9Loras.forEach((lora, i) => {
      if (i < tab9LoraNodeIds.length) {
        template[tab9LoraNodeIds[i]].inputs.lora_name = lora.model;
        template[tab9LoraNodeIds[i]].inputs.strength_model = lora.strength;
        template[tab9LoraNodeIds[i]].inputs.strength_clip = lora.strength;
      }
    });

    // Dynamic reconnection: bypass disabled LoRAs
    const tab9ModelSource: [string, number] = ['25', 0];
    const tab9ClipSource: [string, number] = ['26', 0];
    const tab9EnabledIndices = tab9Loras.map((l, i) => l.enabled ? i : -1).filter(i => i >= 0 && i < tab9LoraNodeIds.length);

    if (tab9EnabledIndices.length === 0) {
      // All disabled: downstream nodes connect directly to UNet/CLIP sources
      template['45'].inputs.model = tab9ModelSource;
      template['5'].inputs.clip = tab9ClipSource;
      template['47'].inputs.on_false = tab9ModelSource;
    } else {
      // First enabled LoRA connects to source
      const firstIdx = tab9EnabledIndices[0];
      template[tab9LoraNodeIds[firstIdx]].inputs.model = tab9ModelSource;
      template[tab9LoraNodeIds[firstIdx]].inputs.clip = tab9ClipSource;

      // Chain enabled LoRAs together
      for (let k = 1; k < tab9EnabledIndices.length; k++) {
        const curr = tab9EnabledIndices[k];
        const prev = tab9EnabledIndices[k - 1];
        template[tab9LoraNodeIds[curr]].inputs.model = [tab9LoraNodeIds[prev], 0];
        template[tab9LoraNodeIds[curr]].inputs.clip = [tab9LoraNodeIds[prev], 1];
      }

      // Last enabled LoRA outputs to ModelSampling, CLIPTextEncode, and ifElse
      const lastIdx = tab9EnabledIndices[tab9EnabledIndices.length - 1];
      template['45'].inputs.model = [tab9LoraNodeIds[lastIdx], 0];
      template['5'].inputs.clip = [tab9LoraNodeIds[lastIdx], 1];
      template['47'].inputs.on_false = [tab9LoraNodeIds[lastIdx], 0];
    }

    // Node 24: output filename prefix
    if (name) {
      template['24'].inputs.filename_prefix = name;
    }

    const result = await queuePrompt(template, clientId);

    res.json({
      promptId: result.prompt_id,
      clientId,
      workflowId: 9,
      workflowName: 'ZIT快出',
    });
  } catch (err: any) {
    console.error('[Workflow 9 Execute Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// POST /api/workflow/8/execute — 黑兽换脸: targetImage + faceImage
const uploadFaceSwapFields = multer({ storage: multer.memoryStorage() })
  .fields([{ name: 'targetImage', maxCount: 1 }, { name: 'faceImage', maxCount: 1 }]);

router.post('/8/execute', uploadFaceSwapFields, async (req, res) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const targetFile = files?.['targetImage']?.[0];
    const faceFile = files?.['faceImage']?.[0];

    if (!targetFile) {
      res.status(400).json({ error: 'No targetImage file provided' });
      return;
    }
    if (!faceFile) {
      res.status(400).json({ error: 'No faceImage file provided' });
      return;
    }

    const clientId = (req.query.clientId as string | undefined) || req.body.clientId;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    // Upload both images to ComfyUI
    const targetFilename = await uploadImage(targetFile.buffer, targetFile.originalname);
    const faceFilename = await uploadImage(faceFile.buffer, faceFile.originalname);

    // Patch template
    const template = JSON.parse(fs.readFileSync(faceSwapTemplatePath, 'utf-8'));
    template['91'].inputs.image = targetFilename;
    template['20'].inputs.image = faceFilename;
    template['158'].inputs.seed = Math.floor(Math.random() * 1125899906842624);

    const result = await queuePrompt(template, clientId);

    res.json({
      promptId: result.prompt_id,
      clientId,
      workflowId: 8,
      workflowName: '黑兽换脸',
    });
  } catch (err: any) {
    console.error('[Workflow 8 Execute Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// POST /api/workflow/0/execute — 二次元转真人: supports qwen (default) and klein draw models
router.post('/0/execute', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }

    const clientId = (req.query.clientId as string | undefined) || req.body.clientId;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    const model: string = req.body.model || 'qwen';
    const userPrompt: string = req.body.prompt || '';
    const comfyFilename = await uploadImage(req.file.buffer, req.file.originalname);

    let promptJson: object;
    if (model === 'klein') {
      const kleinDefaultPrompt = 'realistic, 将画面变为真实的照片，将动漫角色真人化，补充细节，修复画面。超高清，极致细节，高对比度，清晰的光影细节，保持画面色调不变，8K画质。亚洲人。';
      const template = JSON.parse(fs.readFileSync(kleinTemplatePath, 'utf-8'));
      template['46'].inputs.image = comfyFilename;
      template['304'].inputs.prompt = userPrompt.trim() || kleinDefaultPrompt;
      template['370'].inputs.seed = Math.floor(Math.random() * 4294967295);
      promptJson = template;
    } else {
      const adapter = getAdapter(0)!;
      promptJson = adapter.buildPrompt(comfyFilename, userPrompt);
    }

    const result = await queuePrompt(promptJson, clientId);

    res.json({
      promptId:     result.prompt_id,
      clientId,
      workflowId:   0,
      workflowName: '二次元转真人',
    });
  } catch (err: any) {
    console.error('[Workflow 0 Execute Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// POST /api/workflow/2/execute — 精修放大: supports seedvr2 (default) and klein upscale models
router.post('/2/execute', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }

    const clientId = (req.query.clientId as string | undefined) || req.body.clientId;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    const model: string = req.body.model || 'seedvr2';
    const comfyFilename = await uploadImage(req.file.buffer, req.file.originalname);

    let promptJson: object;
    if (model === 'klein') {
      const kleinDefaultPrompt = 'realistic，补充细节，修复画面。超高清，极致细节，高对比度，清晰的光影细节，保持画面色调不变，8K画质。亚洲人。';
      const template = JSON.parse(fs.readFileSync(kleinTemplatePath, 'utf-8'));
      template['46'].inputs.image = comfyFilename;
      template['304'].inputs.prompt = kleinDefaultPrompt;
      template['370'].inputs.seed = Math.floor(Math.random() * 4294967295);
      promptJson = template;
    } else if (model === 'kleinpro') {
      const template = JSON.parse(fs.readFileSync(kleinProTemplatePath, 'utf-8'));
      template['31'].inputs.image = comfyFilename;
      template['13'].inputs.seed = Math.floor(Math.random() * 4294967295);
      promptJson = template;
    } else if (model === 'sd') {
      const template = JSON.parse(fs.readFileSync(sdUpscaleTemplatePath, 'utf-8'));
      template['483'].inputs.image = comfyFilename;
      template['170'].inputs.seed = Math.floor(Math.random() * 1125899906842624);
      promptJson = template;
    } else if (model === 'remacri') {
      const template = JSON.parse(fs.readFileSync(sdUpscaleTemplatePath, 'utf-8'));
      template['483'].inputs.image = comfyFilename;
      template['170'].inputs.seed = Math.floor(Math.random() * 1125899906842624);
      template['171'].inputs.model_name = 'remacri_original.safetensors';
      promptJson = template;
    } else {
      // seedvr2 (default)
      const adapter = getAdapter(2)!;
      promptJson = adapter.buildPrompt(comfyFilename, '');
    }

    const result = await queuePrompt(promptJson, clientId);

    res.json({
      promptId:     result.prompt_id,
      clientId,
      workflowId:   2,
      workflowName: '精修放大',
    });
  } catch (err: any) {
    console.error('[Workflow 2 Execute Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// POST /api/workflow/:id/execute - execute single image
router.post('/:id/execute', upload.single('image'), async (req, res) => {
  try {
    const workflowId = parseInt(req.params.id as string, 10);
    const adapter = getAdapter(workflowId);

    if (!adapter) {
      res.status(400).json({ error: `Unknown workflow: ${workflowId}` });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }

    const clientId = (req.query.clientId as string | undefined) || req.body.clientId;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    const userPrompt = req.body.prompt || '';
    const options = req.body.options ? JSON.parse(req.body.options) : undefined;

    // Upload to ComfyUI
    let comfyFilename: string;
    if (workflowId === 4) {
      comfyFilename = await uploadVideo(req.file.buffer, req.file.originalname);
    } else {
      comfyFilename = await uploadImage(req.file.buffer, req.file.originalname);
    }

    // Build prompt JSON
    const prompt = adapter.buildPrompt(comfyFilename, userPrompt, options);

    // Queue it
    const result = await queuePrompt(prompt, clientId);

    res.json({
      promptId: result.prompt_id,
      clientId,
      workflowId,
      workflowName: adapter.name,
    });
  } catch (err: any) {
    console.error('[Workflow Execute Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// POST /api/workflow/:id/batch - batch execute multiple images
router.post('/:id/batch', upload.array('images', 50), async (req, res) => {
  try {
    const workflowId = parseInt(req.params.id as string, 10);
    const adapter = getAdapter(workflowId);

    if (!adapter) {
      res.status(400).json({ error: `Unknown workflow: ${workflowId}` });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No image files provided' });
      return;
    }

    const clientId = (req.query.clientId as string | undefined) || req.body.clientId;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    // Parse per-image prompts: JSON array or single prompt for all
    let prompts: string[] = [];
    try {
      prompts = req.body.prompts ? JSON.parse(req.body.prompts) : [];
    } catch {
      prompts = [];
    }
    const options = req.body.options ? JSON.parse(req.body.options) : undefined;

    const results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const userPrompt = prompts[i] || req.body.prompt || '';

      let comfyFilename: string;
      if (workflowId === 4) {
        comfyFilename = await uploadVideo(file.buffer, file.originalname);
      } else {
        comfyFilename = await uploadImage(file.buffer, file.originalname);
      }

      const prompt = adapter.buildPrompt(comfyFilename, userPrompt, options);
      const result = await queuePrompt(prompt, clientId);

      results.push({
        promptId: result.prompt_id,
        originalName: file.originalname,
      });
    }

    res.json({
      clientId,
      workflowId,
      workflowName: adapter.name,
      tasks: results,
    });
  } catch (err: any) {
    console.error('[Workflow Batch Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// POST /api/workflow/cancel-queue/:promptId - remove a pending item from ComfyUI queue
router.post('/cancel-queue/:promptId', async (req, res) => {
  try {
    await deleteQueueItem(req.params.promptId as string);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// GET /api/workflow/system-stats - VRAM and RAM usage from ComfyUI
router.get('/system-stats', async (_req, res) => {
  try {
    const stats = await getSystemStats();
    res.json(stats);
  } catch {
    res.status(502).json({ error: 'ComfyUI unavailable' });
  }
});

// POST /api/workflow/release-memory - release GPU/RAM memory
router.post('/release-memory', async (req, res) => {
  try {
    const clientId = (req.query.clientId as string | undefined) || req.body.clientId;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    const template = JSON.parse(fs.readFileSync(releaseMemoryTemplatePath, 'utf-8'));
    const result = await queuePrompt(template, clientId);

    res.json({ promptId: result.prompt_id, clientId });
  } catch (err: any) {
    console.error('[Release Memory Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// GET /api/workflow/queue - get current ComfyUI queue
router.get('/queue', async (_req, res) => {
  try {
    const queue = await getQueue();
    res.json(queue);
  } catch {
    res.status(502).json({ error: 'ComfyUI unavailable' });
  }
});

// POST /api/workflow/queue/prioritize/:promptId - move pending item to front of queue
router.post('/queue/prioritize/:promptId', async (req, res) => {
  try {
    const mapping = await prioritizeQueueItem(req.params.promptId as string);
    res.json({ ok: true, mapping });
  } catch (err: any) {
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// POST /api/workflow/:id/open-folder - open session output folder in OS file explorer
router.post('/:id/open-folder', express.json(), (req, res) => {
  const workflowId = parseInt(req.params.id as string, 10);
  const { sessionId, tabId } = req.body as { sessionId?: string; tabId?: number };

  let outputDir: string;
  if (sessionId && tabId !== undefined) {
    outputDir = path.resolve(getSessionsBase(), sessionId, `tab-${tabId}`, 'output');
  } else {
    // Legacy fallback: open workflow output dir
    const adapter = getAdapter(workflowId);
    if (!adapter) {
      res.status(400).json({ error: `Unknown workflow: ${workflowId}` });
      return;
    }
    outputDir = path.resolve(__dirname, '../../../output', adapter.outputDir);
  }

  // Ensure directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Open in OS file explorer (cross-platform)
  const platform = process.platform;
  let cmd: string;
  if (platform === 'win32') {
    cmd = `explorer "${outputDir}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${outputDir}"`;
  } else {
    cmd = `xdg-open "${outputDir}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.error('[Open Folder Error]', err);
      // Don't fail the response - explorer might return non-zero even on success on Windows
    }
  });

  res.json({ ok: true, path: outputDir });
});


// POST /api/workflow/export-blend — save Mode B blended result to session output dir
router.post('/export-blend', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { sessionId, tabId, filename, imageDataBase64 } = req.body as {
      sessionId: string;
      tabId: number;
      filename: string;
      imageDataBase64: string;
    };

    if (!sessionId || tabId === undefined) {
      res.status(400).json({ error: 'sessionId and tabId are required' });
      return;
    }

    // Sanitise filename — allow alphanumeric, underscore, hyphen, dot, space, and CJK characters
    const safeName = path.basename(filename).replace(/[^\w\-. \u4e00-\u9fff]/g, '_');
    const outputDir = path.resolve(getSessionsBase(), sessionId, `tab-${tabId}`, 'output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const filePath = path.join(outputDir, safeName);
    const buffer = Buffer.from(imageDataBase64, 'base64');
    fs.writeFileSync(filePath, buffer);

    res.json({ ok: true, savedPath: filePath });
  } catch (err) {
    console.error('[export-blend]', err);
    res.status(500).json({ error: String(err) });
  }
});

const autoRecognizeTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-自动识别Fixed.json');

const reversePromptConfigs: Record<string, { templatePath: string; saveTextNode: string }> = {
  'Qwen3VL': {
    templatePath: path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-提示词反推Q3.json'),
    saveTextNode: '66',
  },
  'Florence': {
    templatePath: path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-提示词反推Flo.json'),
    saveTextNode: '67',
  },
  'WD-14': {
    templatePath: path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-提示词反推WD14.json'),
    saveTextNode: '67',
  },
};

// POST /api/workflow/reverse-prompt?model=Qwen3VL|Florence|WD-14
// Runs LLM/tagger captioning and returns generated prompt text
router.post('/reverse-prompt', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }

    const model = (req.query.model as string) || 'Qwen3VL';

    // Grok 模型直接调用云 API，不走 ComfyUI 工作流
    if (model === 'Grok') {
      try {
        const mimeType = req.file.mimetype;
        const base64Data = req.file.buffer.toString('base64');
        const imageDataUrl = `data:${mimeType};base64,${base64Data}`;

        const grokResponse = await fetch('https://api.jiekou.ai/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sk_4kPU46GrW4F-GLsGzOygbmDVA8hoinn4b1PmgiQFB6s',
          },
          body: JSON.stringify({
            model: 'grok-4-fast-non-reasoning',
            messages: [
              {
                role: 'system',
                content: '根据图片反推提示词。规则：\n1. 二次元/卡通图片 → 输出英文 tag 风格标签，逗号分隔\n2. 真实照片 → 输出中文自然语言描述\n3. 混合风格（半写实半二次元）→ 按主要风格判断，标注"混合风格"\n4. 无法识别图片内容时 → 输出"无法识别图片内容，请上传更清晰的图片"\n5. 输出不超过 200 字，仅输出提示词本身，不包含任何解释性文字\n6. 标签数量控制在 15-40 个之间',
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: imageDataUrl,
                    },
                  },
                  {
                    type: 'text',
                    text: '请根据这张图片反推提示词。',
                  },
                ],
              },
            ],
            max_tokens: 4096,
            temperature: 1,
          }),
          agent: PROXY_AGENT,
        } as any);

        if (!grokResponse.ok) {
          const errorText = await grokResponse.text();
          console.error('[Grok API Error]', grokResponse.status, errorText);
          res.status(502).json({ error: `Grok API 错误: ${grokResponse.status}` });
          return;
        }

        const grokData = await grokResponse.json() as {
          choices?: { message?: { content?: string } }[];
        };
        const text = grokData.choices?.[0]?.message?.content?.trim();

        if (!text) {
          res.status(500).json({ error: 'Grok API 未返回提示词文本' });
          return;
        }

        res.json({ text });
        return;
      } catch (grokErr: any) {
        console.error('[Grok Reverse Prompt Error]', grokErr);
        res.status(500).json({ error: grokErr.message || 'Grok API 调用失败' });
        return;
      }
    }

    const cfg = reversePromptConfigs[model];
    if (!cfg) {
      res.status(400).json({ error: `Unknown model: ${model}` });
      return;
    }

    const internalClientId = `reverse-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const comfyFilename = await uploadImage(req.file.buffer, req.file.originalname);

    const template = JSON.parse(fs.readFileSync(cfg.templatePath, 'utf-8'));
    template['1'].inputs.image = comfyFilename;

    // Patch easy saveText with an absolute path so we can read it directly from disk.
    const rpTempDir = path.resolve(__dirname, '../../../rp_temp');
    if (!fs.existsSync(rpTempDir)) fs.mkdirSync(rpTempDir, { recursive: true });
    const tempName = `rp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    template[cfg.saveTextNode].inputs.output_file_path = rpTempDir;
    template[cfg.saveTextNode].inputs.file_name = tempName;
    template[cfg.saveTextNode].inputs.file_extension = 'txt';
    template[cfg.saveTextNode].inputs.overwrite = true;

    const queued = await queuePrompt(template, internalClientId);
    const promptId = queued.prompt_id;

    // Poll history until ComfyUI marks it complete (timeout 180 s — LLM inference is slow)
    const deadline = Date.now() + 180_000;
    let history;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const h = await getHistory(promptId);
        if (h?.status?.completed) { history = h; break; }
      } catch { /* not ready yet */ }
    }

    if (!history) {
      res.status(504).json({ error: '反推提示词超时，请重试' });
      return;
    }

    // Read text directly from the file written by easy saveText
    const txtPath = path.join(rpTempDir, `${tempName}.txt`);
    if (!fs.existsSync(txtPath)) {
      console.error('[Reverse Prompt] file not found:', txtPath);
      res.status(500).json({ error: 'ComfyUI 未返回提示词文本' });
      return;
    }
    const text = fs.readFileSync(txtPath, 'utf-8').trim();
    fs.unlinkSync(txtPath);
    if (!text) {
      res.status(500).json({ error: 'ComfyUI 未返回提示词文本' });
      return;
    }

    res.json({ text });
  } catch (err: any) {
    console.error('[Reverse Prompt Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// POST /api/workflow/prompt-assistant
// Calls Pix2Real-提示词助手.json workflow with systemPrompt and userPrompt, returns generated text
router.post('/prompt-assistant', express.json(), async (req, res) => {
  try {
    const { systemPrompt, userPrompt } = req.body;
    if (!systemPrompt || !userPrompt) {
      res.status(400).json({ error: 'systemPrompt and userPrompt are required' });
      return;
    }

    const internalClientId = `prompt-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const template = JSON.parse(fs.readFileSync(promptAssistantTemplatePath, 'utf-8'));
    template['62'].inputs.system_prompt = systemPrompt;
    template['62'].inputs.custom_prompt = userPrompt;
    template['62'].inputs.seed = Math.floor(Math.random() * 1125899906842624);

    // Patch saveText output path
    const paTempDir = path.resolve(__dirname, '../../../pa_temp');
    if (!fs.existsSync(paTempDir)) fs.mkdirSync(paTempDir, { recursive: true });
    const tempName = `pa_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    template['66'].inputs.output_file_path = paTempDir;
    template['66'].inputs.file_name = tempName;
    template['66'].inputs.file_extension = 'txt';
    template['66'].inputs.overwrite = true;

    const queued = await queuePrompt(template, internalClientId);
    const promptId = queued.prompt_id;

    // Poll history until ComfyUI marks it complete (timeout 180 s)
    const deadline = Date.now() + 180_000;
    let history;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const h = await getHistory(promptId);
        if (h?.status?.completed) { history = h; break; }
      } catch { /* not ready yet */ }
    }

    if (!history) {
      res.status(504).json({ error: '提示词助理超时，请重试' });
      return;
    }

    // Read text from file
    const txtPath = path.join(paTempDir, `${tempName}.txt`);
    if (!fs.existsSync(txtPath)) {
      console.error('[Prompt Assistant] file not found:', txtPath);
      res.status(500).json({ error: 'ComfyUI 未返回结果文本' });
      return;
    }
    const text = fs.readFileSync(txtPath, 'utf-8').trim();
    fs.unlinkSync(txtPath);
    if (!text) {
      res.status(500).json({ error: 'ComfyUI 未返回结果文本' });
      return;
    }

    res.json({ text });
  } catch (err: any) {
    console.error('[Prompt Assistant Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// POST /api/workflow/smart-lora
// Calls Grok LLM to recommend LoRA models based on user prompt
router.post('/smart-lora', express.json(), async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.json({ loras: [] });
    }

    // 1. 构建系统提示词（含LoRA目录）
    const systemPrompt = await buildSmartLoraPrompt();

    // 2. 调用 Grok
    const result = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt.trim() },
      ],
      temperature: 0.3,  // 低温度确保精准匹配
    });

    // 3. 解析返回的 JSON
    let text = result.content || '';

    // 容错：尝试从 markdown code block 中提取 JSON
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      text = codeBlockMatch[1].trim();
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error('[smart-lora] Failed to parse LLM response:', text);
      return res.json({ loras: [] });
    }

    // 4. 验证返回的 model 路径在元数据中确实存在
    const metadata = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../model_meta/metadata.json'), 'utf-8'));
    const validLoras = (parsed.loras || [])
      .filter((l: any) => l.model && metadata[l.model])
      .map((l: any) => ({
        model: l.model,
        strength: typeof l.strength === 'number' ? l.strength : (metadata[l.model]?.recommendedStrength || 0.8),
      }))
      .slice(0, 5);  // 最多5个

    res.json({ loras: validLoras, modifiedPrompt: parsed.modifiedPrompt || prompt });
  } catch (err: any) {
    console.error('[smart-lora] Error:', err.message);
    res.status(500).json({ error: '智能LoRA推荐失败', loras: [] });
  }
});

// POST /api/workflow/smart-trigger-insert
// Calls LLM to insert trigger words into user prompt
router.post('/smart-trigger-insert', express.json(), async (req, res) => {
  try {
    const { prompt, triggerWords, loraName } = req.body;
    if (!prompt || !triggerWords) {
      return res.json({ modifiedPrompt: prompt || '' });
    }

    const systemPrompt = buildTriggerInsertPrompt(triggerWords);

    const result = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt.trim() },
      ],
      temperature: 0.2,
    });

    let modifiedPrompt = result.content || prompt;
    // 清理可能的 markdown 包裹
    const codeBlockMatch = modifiedPrompt.match(/```(?:\w*)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      modifiedPrompt = codeBlockMatch[1].trim();
    }
    // 去掉可能的引号包裹
    if (modifiedPrompt.startsWith('"') && modifiedPrompt.endsWith('"')) {
      modifiedPrompt = modifiedPrompt.slice(1, -1);
    }

    // 规范化：确保逗号分隔格式正确
    modifiedPrompt = modifiedPrompt
      .replace(/,\s*/g, ', ')        // 统一逗号后的空格
      .replace(/\s+,/g, ',')         // 移除逗号前的多余空格
      .replace(/,\s*,/g, ',')        // 移除连续逗号
      .replace(/^\s*,\s*/, '')       // 移除开头逗号
      .replace(/\s*,\s*$/, '')       // 移除末尾逗号
      .trim();

    res.json({ modifiedPrompt });
  } catch (err: any) {
    console.error('[smart-trigger-insert] Error:', err.message);
    res.status(500).json({ error: '触发词插入失败', modifiedPrompt: req.body?.prompt || '' });
  }
});

// POST /api/workflow/prompt-assistant-grok
// Calls Grok cloud API directly for prompt assistant (no ComfyUI dependency)
router.post('/prompt-assistant-grok', express.json(), async (req, res) => {
  try {
    const { systemPrompt, userPrompt } = req.body;
    if (!systemPrompt || !userPrompt) {
      res.status(400).json({ error: '缺少 systemPrompt 或 userPrompt 参数' });
      return;
    }

    const grokResponse = await fetch('https://api.jiekou.ai/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk_4kPU46GrW4F-GLsGzOygbmDVA8hoinn4b1PmgiQFB6s',
      },
      body: JSON.stringify({
        model: 'grok-4-fast-non-reasoning',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 4096,
        temperature: 0.7,
      }),
      agent: PROXY_AGENT,
    } as any);

    if (!grokResponse.ok) {
      const errorText = await grokResponse.text();
      console.error('[Grok Prompt Assistant Error]', grokResponse.status, errorText);
      res.status(502).json({ error: `Grok API 错误: ${grokResponse.status}` });
      return;
    }

    const data = await grokResponse.json() as {
      choices?: { message?: { content?: string } }[];
    };
    const resultText = data.choices?.[0]?.message?.content || '';

    res.json({ text: resultText });
  } catch (error: any) {
    console.error('[Grok Prompt Assistant Error]', error);
    res.status(500).json({ error: error.message || 'Grok 提示词助手请求失败' });
  }
});

// POST /api/workflow/mask/auto-recognize — run SAM segmentation and return mask PNG
router.post('/mask/auto-recognize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }

    const internalClientId = `mask-auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const comfyFilename = await uploadImage(req.file.buffer, req.file.originalname);

    const template = JSON.parse(fs.readFileSync(autoRecognizeTemplatePath, 'utf-8'));
    template['247'].inputs.image = comfyFilename;

    const queued = await queuePrompt(template, internalClientId);
    const promptId = queued.prompt_id;

    // Poll history until ComfyUI marks it complete (timeout 120 s)
    const deadline = Date.now() + 120_000;
    let history;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 800));
      try {
        const h = await getHistory(promptId);
        if (h?.status?.completed) { history = h; break; }
      } catch { /* not ready yet */ }
    }

    if (!history) {
      res.status(504).json({ error: '自动识别超时，请重试' });
      return;
    }

    const outputFile = history.outputs['394']?.images?.[0];
    if (!outputFile) {
      res.status(500).json({ error: 'ComfyUI 未返回蒙版图像' });
      return;
    }

    const imgBuffer = await getImageBuffer(outputFile.filename, outputFile.subfolder, outputFile.type);
    res.setHeader('Content-Type', 'image/png');
    res.send(imgBuffer);
  } catch (err: any) {
    console.error('[Mask Auto-recognize Error]', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

export default router;
