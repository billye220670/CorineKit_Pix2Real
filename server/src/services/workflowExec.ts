import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── 模板路径 ─────────────────────────────────────────────────────
// services/ 与 routes/ 同为 src 下一级目录，相对 ComfyUI_API 的层级一致。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const removeEquipTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-解除装备Fixed.json');
const text2imgTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-二次元生成.json');
const faceSwapTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-换面.json');
const zitTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-ZIT文生图NEW2.json');
const text2imgProTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/二次元生成 (PRO).json');

export interface LoraConfig {
  model: string;
  enabled: boolean;
  strength: number;
}

/**
 * 处理 LoRA 节点的赋值和动态重连
 * @param template - 工作流 JSON 模板
 * @param loraNodeIds - LoRA 节点 ID 数组
 * @param loras - 用户的 LoRA 配置数组
 * @param checkpointNodeId - Checkpoint 节点 ID
 * @param outputNodes - 需要接收 LoRA 输出的节点映射
 */
export function applyLoraChain(
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

// ── 工作流 5 解除装备 ────────────────────────────────────────────
export interface Workflow5Opts {
  backPose: boolean;
  prompt: string;
}

/**
 * 构建工作流 5（解除装备）prompt JSON。
 * 接收已上传到 ComfyUI 的原图与蒙版文件名 + 参数，返回 prompt JSON。
 */
export function buildWorkflow5Prompt(imageName: string, maskName: string, opts: Workflow5Opts): object {
  const template = JSON.parse(fs.readFileSync(removeEquipTemplatePath, 'utf-8'));
  template['313'].inputs.image   = imageName;
  template['385'].inputs.image   = maskName;
  template['389'].inputs.boolean = opts.backPose;
  template['315'].inputs.seed    = Math.floor(Math.random() * 1125899906842624);
  // Prompt: user text replaces default entirely; empty = keep JSON default
  if (opts.prompt.trim()) {
    template['314'].inputs.text = opts.prompt.trim();
  }
  return template;
}

// ── 工作流 10 区域编辑 ───────────────────────────────────────────
export interface Workflow10Opts {
  backPose: boolean;
  prompt: string;
}

/**
 * 构建工作流 10（区域编辑）prompt JSON。
 * 与工作流 5 共用模板，区别在于 prompt 始终写入（即便为空）。
 */
export function buildWorkflow10Prompt(imageName: string, maskName: string, opts: Workflow10Opts): object {
  const template = JSON.parse(fs.readFileSync(removeEquipTemplatePath, 'utf-8'));
  template['313'].inputs.image   = imageName;
  template['385'].inputs.image   = maskName;
  template['389'].inputs.boolean = opts.backPose;
  template['315'].inputs.seed    = Math.floor(Math.random() * 1125899906842624);
  // Prompt: always set, even if empty (区域编辑 specific behavior)
  template['314'].inputs.text = opts.prompt;
  return template;
}

// ── 工作流 7 快速出图 ────────────────────────────────────────────
export interface Workflow7Opts {
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
  // ── PRO 工作流分支参数 ──
  // referenceComfyName 存在时走 二次元生成 (PRO) 模板（该文件名须为已上传到 ComfyUI 的参考图名）。
  referenceComfyName?: string;
  depthStrength?: number;
  poseStrength?: number;
  useOriginalRatio?: boolean;
}

/**
 * 构建工作流 7（快速出图）prompt JSON。
 * - 当 opts.referenceComfyName 存在时走 PRO 模板分支；
 * - 否则走普通 二次元生成 模板分支。
 * 参考图的上传须在调用方完成后，将 ComfyUI 文件名通过 referenceComfyName 传入。
 */
export function buildWorkflow7Prompt(opts: Workflow7Opts): object {
  const { model, loras, prompt, negativePrompt, width, height, steps, cfg, sampler, scheduler, name } = opts;
  const clientSeed = opts.seed;
  // loras 防护：非数组一律视为空，避免后续 .length/.map 引发 TypeError
  const safeLoras = Array.isArray(loras) ? loras : [];

  // ── PRO 工作流分支：当包含 referenceImage 时使用二次元生成 (PRO) 模板 ──
  if (opts.referenceComfyName) {
    const comfyRefFilename = opts.referenceComfyName;
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
    proTemplate['49'].inputs.strength = opts.depthStrength ?? 0.3;
    proTemplate['57'].inputs.strength = opts.poseStrength ?? 0.5;
    // 当用户选择了非原图比例时，用指定的 width/height 覆盖 Node #5
    if (!opts.useOriginalRatio && width && height) {
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
    const proLoras = safeLoras.length > 0 ? safeLoras : [];
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

    return proTemplate;
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
  const tab7Loras = safeLoras.length > 0 ? safeLoras : [];
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

  return template;
}

// ── 工作流 9 ZIT快出 ─────────────────────────────────────────────
export interface Workflow9Opts {
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
}

/**
 * 构建工作流 9（ZIT快出）prompt JSON。
 * UNet + LoRA 文生图，LoRA 动态重连逻辑区别于工作流 7（含 #47 ifElse 的 on_false 处理）。
 */
export function buildWorkflow9Prompt(opts: Workflow9Opts): object {
  const { unetModel, loras, shiftEnabled, shift, prompt, width, height, steps, cfg, sampler, scheduler, name } = opts;
  // loras 防护：非数组一律视为空，避免后续 .length/.map 引发 TypeError
  const safeLoras = Array.isArray(loras) ? loras : [];

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
  const tab9Loras = safeLoras.length > 0 ? safeLoras : [];

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

  return template;
}

// ── 工作流 8 黑兽换脸 ────────────────────────────────────────────
export interface Workflow8Opts {}

/**
 * 构建工作流 8（黑兽换脸）prompt JSON。
 * 接收已上传到 ComfyUI 的目标图与人脸图文件名，返回 prompt JSON。
 */
export function buildWorkflow8Prompt(targetImageName: string, faceImageName: string, _opts?: Workflow8Opts): object {
  const template = JSON.parse(fs.readFileSync(faceSwapTemplatePath, 'utf-8'));
  template['91'].inputs.image = targetImageName;
  template['20'].inputs.image = faceImageName;
  template['158'].inputs.seed = Math.floor(Math.random() * 1125899906842624);
  return template;
}
