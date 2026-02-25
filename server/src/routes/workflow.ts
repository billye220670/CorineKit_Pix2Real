import express, { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import multer from 'multer';
import { getAdapter, adapters } from '../adapters/index.js';
import { workflow5Adapter } from '../adapters/Workflow5Adapter.js';
import { uploadImage, uploadVideo, queuePrompt, deleteQueueItem, getSystemStats, getQueue, prioritizeQueueItem, getHistory, getImageBuffer } from '../services/comfyui.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseMemoryTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-释放内存.json');
const removeEquipTemplatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-解除装备Fixed.json');

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const uploadFields = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 },
]);

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
    res.status(500).json({ error: err.message || 'Internal server error' });
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

    // Upload to ComfyUI
    let comfyFilename: string;
    if (workflowId === 4) {
      comfyFilename = await uploadVideo(req.file.buffer, req.file.originalname);
    } else {
      comfyFilename = await uploadImage(req.file.buffer, req.file.originalname);
    }

    // Build prompt JSON
    const prompt = adapter.buildPrompt(comfyFilename, userPrompt);

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
    res.status(500).json({ error: err.message || 'Internal server error' });
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

      const prompt = adapter.buildPrompt(comfyFilename, userPrompt);
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
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/workflow/cancel-queue/:promptId - remove a pending item from ComfyUI queue
router.post('/cancel-queue/:promptId', async (req, res) => {
  try {
    await deleteQueueItem(req.params.promptId as string);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' });
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
    res.status(500).json({ error: err.message || 'Internal server error' });
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
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/workflow/:id/open-folder - open output folder in OS file explorer
router.post('/:id/open-folder', (req, res) => {
  const workflowId = parseInt(req.params.id as string, 10);
  const adapter = getAdapter(workflowId);

  if (!adapter) {
    res.status(400).json({ error: `Unknown workflow: ${workflowId}` });
    return;
  }

  const outputDir = path.resolve(__dirname, '../../../output', adapter.outputDir);

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


// POST /api/workflow/export-blend — save Mode B blended result to output dir
router.post('/export-blend', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { tabId, filename, imageDataBase64 } = req.body as {
      tabId: number;
      filename: string;
      imageDataBase64: string;
    };

    const adapter = getAdapter(tabId);
    if (!adapter) {
      res.status(400).json({ error: 'Unknown workflow: ' + tabId });
      return;
    }

    // Sanitise filename — allow alphanumeric, underscore, hyphen, dot, space, and CJK characters
    const safeName = path.basename(filename).replace(/[^\w\-. \u4e00-\u9fff]/g, '_');
    const outputDir = path.resolve(__dirname, '../../../output', adapter.outputDir);
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
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

export default router;
