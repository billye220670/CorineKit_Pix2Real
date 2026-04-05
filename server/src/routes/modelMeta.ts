import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelMetaBase = path.resolve(__dirname, '../../../model_meta');
const metadataFile = path.join(modelMetaBase, 'metadata.json');
const thumbnailsDir = path.join(modelMetaBase, 'thumbnails');

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

// multer memory storage with image filter
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}`));
    }
  },
});

function readMetadata(): Record<string, { thumbnail?: string; nickname?: string; triggerWords?: string; category?: string }> {
  try {
    const raw = fs.readFileSync(metadataFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeMetadata(data: Record<string, { thumbnail?: string; nickname?: string; triggerWords?: string; category?: string }>): void {
  fs.writeFileSync(metadataFile, JSON.stringify(data, null, 2), 'utf-8');
}

const router = Router();

// GET /metadata — 获取全部元数据
router.get('/metadata', (_req: Request, res: Response) => {
  const metadata = readMetadata();
  res.json(metadata);
});

// POST /metadata/thumbnail — 上传缩略图
router.post('/metadata/thumbnail', upload.single('file'), (req: Request, res: Response) => {
  const { modelPath } = req.body as { modelPath?: string };
  if (!modelPath) {
    res.status(400).json({ error: 'modelPath is required' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'file is required' });
    return;
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  const filename = `${crypto.randomUUID()}${ext}`;
  const filePath = path.join(thumbnailsDir, filename);

  fs.writeFileSync(filePath, req.file.buffer);

  const metadata = readMetadata();
  // 如果已有旧缩略图，删除旧文件
  if (metadata[modelPath]?.thumbnail) {
    const oldPath = path.join(thumbnailsDir, metadata[modelPath].thumbnail!);
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    }
  }

  if (!metadata[modelPath]) {
    metadata[modelPath] = {};
  }
  metadata[modelPath].thumbnail = filename;
  writeMetadata(metadata);

  res.json({ ok: true, thumbnail: filename });
});

// POST /metadata/nickname — 设置昵称
router.post('/metadata/nickname', (req: Request, res: Response) => {
  const { modelPath, nickname } = req.body as { modelPath?: string; nickname?: string };
  if (!modelPath || nickname === undefined) {
    res.status(400).json({ error: 'modelPath and nickname are required' });
    return;
  }

  const metadata = readMetadata();
  if (!metadata[modelPath]) {
    metadata[modelPath] = {};
  }
  metadata[modelPath].nickname = nickname;
  writeMetadata(metadata);

  res.json({ ok: true });
});

// DELETE /metadata/thumbnail — 删除缩略图
router.delete('/metadata/thumbnail', (req: Request, res: Response) => {
  const { modelPath } = req.body as { modelPath?: string };
  if (!modelPath) {
    res.status(400).json({ error: 'modelPath is required' });
    return;
  }

  const metadata = readMetadata();
  if (metadata[modelPath]?.thumbnail) {
    const filePath = path.join(thumbnailsDir, metadata[modelPath].thumbnail!);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    delete metadata[modelPath].thumbnail;
    // 如果该模型没有任何元数据了，清理掉整个条目
    if (!metadata[modelPath].nickname && !metadata[modelPath].triggerWords && !metadata[modelPath].category) {
      delete metadata[modelPath];
    }
    writeMetadata(metadata);
  }

  res.json({ ok: true });
});

// DELETE /metadata/nickname — 删除昵称
router.delete('/metadata/nickname', (req: Request, res: Response) => {
  const { modelPath } = req.body as { modelPath?: string };
  if (!modelPath) {
    res.status(400).json({ error: 'modelPath is required' });
    return;
  }

  const metadata = readMetadata();
  if (metadata[modelPath]) {
    delete metadata[modelPath].nickname;
    // 如果该模型没有任何元数据了，清理掉整个条目
    if (!metadata[modelPath].thumbnail && !metadata[modelPath].triggerWords && !metadata[modelPath].category) {
      delete metadata[modelPath];
    }
    writeMetadata(metadata);
  }

  res.json({ ok: true });
});

// POST /metadata/trigger-words — 设置触发词
router.post('/metadata/trigger-words', (req: Request, res: Response) => {
  const { modelPath, triggerWords } = req.body as { modelPath?: string; triggerWords?: string };
  if (!modelPath || triggerWords === undefined) {
    res.status(400).json({ error: 'modelPath and triggerWords are required' });
    return;
  }

  const metadata = readMetadata();
  if (!metadata[modelPath]) {
    metadata[modelPath] = {};
  }
  metadata[modelPath].triggerWords = triggerWords;
  writeMetadata(metadata);

  res.json({ ok: true });
});

// DELETE /metadata/trigger-words — 删除触发词
router.delete('/metadata/trigger-words', (req: Request, res: Response) => {
  const { modelPath } = req.body as { modelPath?: string };
  if (!modelPath) {
    res.status(400).json({ error: 'modelPath is required' });
    return;
  }

  const metadata = readMetadata();
  if (metadata[modelPath]) {
    delete metadata[modelPath].triggerWords;
    // 如果该模型没有任何元数据了，清理掉整个条目
    if (!metadata[modelPath].thumbnail && !metadata[modelPath].nickname && !metadata[modelPath].category) {
      delete metadata[modelPath];
    }
    writeMetadata(metadata);
  }

  res.json({ ok: true });
});

// POST /metadata/category — 设置分类
router.post('/metadata/category', (req: Request, res: Response) => {
  const { modelPath, category } = req.body as { modelPath?: string; category?: string };
  if (!modelPath || category === undefined) {
    res.status(400).json({ error: 'modelPath and category are required' });
    return;
  }

  const metadata = readMetadata();
  if (!metadata[modelPath]) {
    metadata[modelPath] = {};
  }
  metadata[modelPath].category = category;
  writeMetadata(metadata);

  res.json({ ok: true });
});

// DELETE /metadata/category — 删除分类
router.delete('/metadata/category', (req: Request, res: Response) => {
  const { modelPath } = req.body as { modelPath?: string };
  if (!modelPath) {
    res.status(400).json({ error: 'modelPath is required' });
    return;
  }

  const metadata = readMetadata();
  if (metadata[modelPath]) {
    delete metadata[modelPath].category;
    // 如果该模型没有任何元数据了，清理掉整个条目
    if (!metadata[modelPath].thumbnail && !metadata[modelPath].nickname && !metadata[modelPath].triggerWords) {
      delete metadata[modelPath];
    }
    writeMetadata(metadata);
  }

  res.json({ ok: true });
});

export default router;
