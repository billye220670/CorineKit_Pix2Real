// server/src/routes/external.ts
// 对外 API（/api/v1）路由：面向第三方调用方，提供任务提交 / 状态轮询 / 结果下载 /
// 取消 / 工作流契约查询。整体设计：
//   - 统一经 apiKeyAuth 中间件鉴权（内部处理开关与 key 校验）。
//   - 提交任务复用现有 ComfyUI 上传/构建/入队能力（uploadImage/uploadVideo/queuePrompt/
//     getAdapter/buildWorkflowXPrompt），不重复实现工作流逻辑。
//   - 任务生命周期由 externalTaskManager 维护；进度/完成/失败由 index.ts 的 WebSocket
//     回调桥接（通过 promptId 反查外部任务）驱动。
//   - 结果文件由本模块在 onComplete 桥接时落盘到独立目录 output/_external/<taskId>/，
//     result 下载接口据 taskId + index 反查真实文件，与对外 url 一一对齐。

import { Router } from 'express';
import type { Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';
import { uploadImage, uploadVideo, queuePrompt, deleteQueueItem } from '../services/comfyui.js';
import { getAdapter } from '../adapters/index.js';
import {
  buildWorkflow5Prompt,
  buildWorkflow7Prompt,
  buildWorkflow8Prompt,
  buildWorkflow9Prompt,
  buildWorkflow10Prompt,
} from '../services/workflowExec.js';
import { WORKFLOW_SCHEMAS } from '../services/externalSchemas.js';
import {
  createTask,
  getTask,
  type ExternalTaskOutput,
} from '../services/externalTaskManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 对外任务结果落盘目录 ─────────────────────────────────────────────
// 结果文件独立存放于 output/_external/<taskId>/，与前端会话产物目录（sessions/）互不干扰。
// 命名采用 <index>__<filename> 以避免同一任务多产物文件名碰撞，并让 result 下载接口
// 仅凭 taskId + index + 记录中的 filename 即可稳定定位真实文件。
export const EXTERNAL_OUTPUT_BASE = path.resolve(__dirname, '../../../output/_external');

/** 返回指定外部任务的结果目录路径。 */
export function externalTaskDir(taskId: string): string {
  return path.join(EXTERNAL_OUTPUT_BASE, taskId);
}

/** 落盘单个外部任务产物文件（供 index.ts 的 onComplete 桥接调用）。 */
export function saveExternalOutput(taskId: string, index: number, filename: string, buffer: Buffer): void {
  const dir = externalTaskDir(taskId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${index}__${filename}`), buffer);
}

/** 构造对外结果下载 url，指向本模块 GET /tasks/:taskId/result/:index。 */
export function buildExternalResultUrl(taskId: string, index: number): string {
  return `/api/v1/tasks/${taskId}/result/${index}`;
}

// ── ComfyUI 错误友好化（与 workflow.ts 保持一致的对外提示）────────────
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

const router = Router();

// ── 数值参数校验 helper ───────────────────────────────────
// 对指定字段逐个 Number 转换并用 Number.isFinite 判断；非法时向客户端返回 400
// 并返回 false（调用方据此 return）。错误信息不汄露内部实现细节。
function validateFiniteNumbers(
  res: Response,
  parameters: Record<string, any>,
  fields: string[]
): boolean {
  for (const field of fields) {
    if (!Number.isFinite(Number(parameters[field]))) {
      res.status(400).json({ error: `参数 ${field} 不是合法数字` });
      return false;
    }
  }
  return true;
}

// ── multer：内存存储 + 单文件上限 ───────────────────────────────────
// 上限取视频体量（200MB）以放行视频；图片类字段在解析后手动限制 20MB。
const IMAGE_LIMIT = 20 * 1024 * 1024;   // 20MB
const VIDEO_LIMIT = 200 * 1024 * 1024;  // 200MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_LIMIT },
});

// 支持的上传字段（覆盖各工作流 inputFiles）
const UPLOAD_FIELDS = ['image', 'mask', 'video', 'targetImage', 'faceImage'] as const;

// 统一鉴权
router.use(apiKeyAuth);

// ── GET /workflows：返回工作流参数契约 ───────────────────────────────
router.get('/workflows', (_req, res) => {
  res.json(WORKFLOW_SCHEMAS);
});

// ── 工具：从 upload.any() 的文件数组中按字段名取文件 ─────────────────
function pickFile(files: Express.Multer.File[] | undefined, field: string): Express.Multer.File | undefined {
  if (!files) return undefined;
  return files.find((f) => f.fieldname === field);
}

// 工作流友好名称（用于响应体展示）
const WORKFLOW_NAMES: Record<number, string> = {
  0: '二次元转真人',
  1: '真人精修',
  2: '精修放大',
  3: '图生视频',
  4: '视频补帧',
  5: '解除装备',
  6: '真人转二次元',
  7: '快速出图',
  8: '黑兽换脸',
  9: 'ZIT快出',
  10: '区域编辑',
};

// ── POST /tasks：提交任务 ────────────────────────────────────────────
router.post('/tasks', upload.any(), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;

    // 1. 解析并校验 workflowId（兼容旧字段 workflowType，优先 workflowId）
    const rawId = req.body.workflowId ?? req.body.workflowType;
    const workflowId = Number(rawId);
    if (!Number.isInteger(workflowId) || !(workflowId in WORKFLOW_SCHEMAS)) {
      res.status(400).json({ error: `Invalid workflowId: ${rawId}` });
      return;
    }
    const schema = WORKFLOW_SCHEMAS[workflowId];

    // 2. 解析 parameters（可能是 JSON 字符串，也可能已是对象）
    let parameters: Record<string, any> = {};
    if (req.body.parameters !== undefined) {
      if (typeof req.body.parameters === 'string') {
        try {
          parameters = req.body.parameters.trim() ? JSON.parse(req.body.parameters) : {};
        } catch {
          res.status(400).json({ error: 'parameters 不是合法的 JSON' });
          return;
        }
      } else if (typeof req.body.parameters === 'object' && req.body.parameters !== null) {
        parameters = req.body.parameters;
      }
    }

    // 3. 校验单文件大小（视频 200MB / 其它 20MB）
    for (const f of files ?? []) {
      const limit = f.fieldname === 'video' ? VIDEO_LIMIT : IMAGE_LIMIT;
      if (f.size > limit) {
        res.status(400).json({ error: `文件 ${f.fieldname} 超过大小上限` });
        return;
      }
      if (!UPLOAD_FIELDS.includes(f.fieldname as typeof UPLOAD_FIELDS[number])) {
        res.status(400).json({ error: `不支持的文件字段: ${f.fieldname}` });
        return;
      }
    }

    // 4. 校验必需输入文件
    for (const field of schema.inputFiles) {
      if (!pickFile(files, field)) {
        res.status(400).json({ error: `缺少必需文件: ${field}` });
        return;
      }
    }

    // 5. 校验必需参数
    for (const [key, def] of Object.entries(schema.parameters)) {
      if (def.required && (parameters[key] === undefined || parameters[key] === null || parameters[key] === '')) {
        res.status(400).json({ error: `缺少必需参数: ${key}` });
        return;
      }
    }

    // 6. 固定 clientId：必须与 index.ts 常驻桥接连接的 clientId 完全一致，
    //    这样外部任务的 ComfyUI 定向消息才能被那条常驻连接接收并桥接（否则任务永远 queued）。
    const clientId = 'pix2real_external_api';

    // 7. 按 workflowId 分派：上传输入文件 + 构建 prompt
    let prompt: object;

    if (workflowId === 5 || workflowId === 10) {
      const imageFile = pickFile(files, 'image')!;
      const maskFile = pickFile(files, 'mask')!;
      const imageName = await uploadImage(imageFile.buffer, imageFile.originalname);
      const maskName = await uploadImage(maskFile.buffer, maskFile.originalname);
      const opts = { backPose: parameters.backPose === true || parameters.backPose === 'true', prompt: String(parameters.prompt ?? '') };
      prompt = workflowId === 5
        ? buildWorkflow5Prompt(imageName, maskName, opts)
        : buildWorkflow10Prompt(imageName, maskName, opts);
    } else if (workflowId === 8) {
      const targetFile = pickFile(files, 'targetImage')!;
      const faceFile = pickFile(files, 'faceImage')!;
      const targetName = await uploadImage(targetFile.buffer, targetFile.originalname);
      const faceName = await uploadImage(faceFile.buffer, faceFile.originalname);
      prompt = buildWorkflow8Prompt(targetName, faceName);
    } else if (workflowId === 7) {
      // 数值参数校验：非法输入应 400 而非 500
      if (!validateFiniteNumbers(res, parameters, ['width', 'height', 'steps', 'cfg'])) return;
      // loras 类型校验：非数组则视为未提供，避免下游 TypeError
      const lorasParam = Array.isArray(parameters.loras) ? parameters.loras : undefined;
      prompt = buildWorkflow7Prompt({
        model: parameters.model,
        loras: lorasParam,
        prompt: parameters.prompt,
        negativePrompt: parameters.negativePrompt,
        width: Number(parameters.width),
        height: Number(parameters.height),
        steps: Number(parameters.steps),
        cfg: Number(parameters.cfg),
        sampler: parameters.sampler,
        scheduler: parameters.scheduler,
        name: parameters.name,
        seed: parameters.seed !== undefined ? Number(parameters.seed) : undefined,
      });
    } else if (workflowId === 9) {
      // 数值参数校验：width/height/steps/cfg 必校；shift 提供时才校验
      if (!validateFiniteNumbers(res, parameters, ['width', 'height', 'steps', 'cfg'])) return;
      if (parameters.shift !== undefined && !validateFiniteNumbers(res, parameters, ['shift'])) return;
      // loras 类型校验：非数组则视为未提供，避免下游 TypeError
      const lorasParam = Array.isArray(parameters.loras) ? parameters.loras : undefined;
      prompt = buildWorkflow9Prompt({
        unetModel: parameters.unetModel,
        loras: lorasParam,
        shiftEnabled: parameters.shiftEnabled === true || parameters.shiftEnabled === 'true',
        shift: Number(parameters.shift ?? 3),
        prompt: parameters.prompt,
        width: Number(parameters.width),
        height: Number(parameters.height),
        steps: Number(parameters.steps),
        cfg: Number(parameters.cfg),
        sampler: parameters.sampler,
        scheduler: parameters.scheduler,
        name: parameters.name,
      });
    } else {
      // adapter 型工作流：0/1/2/3/4/6
      const adapter = getAdapter(workflowId);
      if (!adapter) {
        res.status(400).json({ error: `Unknown workflow: ${workflowId}` });
        return;
      }
      const inputFile = pickFile(files, workflowId === 4 ? 'video' : 'image')!;
      const comfyFilename = workflowId === 4
        ? await uploadVideo(inputFile.buffer, inputFile.originalname)
        : await uploadImage(inputFile.buffer, inputFile.originalname);
      prompt = adapter.buildPrompt(comfyFilename, String(parameters.prompt ?? ''), parameters);
    }

    // 8. 入队并创建任务记录（记录所属 API Key 以防越权）
    const result = await queuePrompt(prompt, clientId);
    const promptId = result.prompt_id;
    const ownerApiKey = (req as any).externalApiKey as string;
    const taskId = createTask(promptId, workflowId, clientId, ownerApiKey);

    res.json({
      taskId,
      workflowId,
      workflowName: WORKFLOW_NAMES[workflowId],
      status: 'queued',
    });
  } catch (err: any) {
    console.error('[External API] POST /tasks error:', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

// ── GET /tasks/:taskId：查询任务状态（含 ETag / 304）────────────────
router.get('/tasks/:taskId', (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  // 任务归属校验：仅创建者的 API Key 可访问（防越权）
  if ((req as any).externalApiKey !== task.ownerApiKey) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // ETag：对核心字段（status + percentage）算简单 hash
  const etagSource = `${task.status}:${task.progress.percentage}`;
  const etag = `"${crypto.createHash('sha1').update(etagSource).digest('hex')}"`;
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader('ETag', etag);

  const body: Record<string, any> = {
    taskId: task.taskId,
    workflowId: task.workflowId,
    workflowName: WORKFLOW_NAMES[task.workflowId],
    status: task.status,
    progress: {
      percentage: task.progress.percentage,
      stage: task.progress.stage,
    },
    createdAt: task.createdAt.toISOString(),
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
  };
  if (task.status === 'completed' && task.outputs) {
    body.results = { outputs: task.outputs };
  }
  if (task.status === 'error' && task.error) {
    body.error = task.error;
  }
  res.json(body);
});

// ── GET /tasks/:taskId/result/:index：下载结果文件 ───────────────────
router.get('/tasks/:taskId/result/:index', (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  // 任务归属校验：仅创建者的 API Key 可下载（防越权）
  if ((req as any).externalApiKey !== task.ownerApiKey) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (task.status !== 'completed' || !task.outputs) {
    res.status(404).json({ error: 'Task result not available' });
    return;
  }
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= task.outputs.length) {
    res.status(404).json({ error: 'Result index out of range' });
    return;
  }
  const output: ExternalTaskOutput = task.outputs[index];
  const filePath = path.join(externalTaskDir(task.taskId), `${index}__${output.filename}`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Result file not found' });
    return;
  }
  res.sendFile(filePath);
});

// ── POST /tasks/:taskId/cancel：取消排队中的任务 ─────────────────────
router.post('/tasks/:taskId/cancel', async (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  // 任务归属校验：仅创建者的 API Key 可取消（防越权）
  if ((req as any).externalApiKey !== task.ownerApiKey) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  try {
    await deleteQueueItem(task.promptId);
    res.json({ ok: true, taskId: task.taskId });
  } catch (err: any) {
    console.error('[External API] cancel error:', err);
    res.status(500).json({ error: toFriendlyComfyError(err) });
  }
});

export default router;
