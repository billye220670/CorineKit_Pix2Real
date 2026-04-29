import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 收藏目录位于项目根目录 favorites/faces/（与 output/ 同级）
const favoritesBase = path.resolve(__dirname, '../../../favorites');
const facesBase = path.join(favoritesBase, 'faces');
const metadataPath = path.join(facesBase, 'metadata.json');

// Ensure directories exist on module load
if (!fs.existsSync(facesBase)) {
  fs.mkdirSync(facesBase, { recursive: true });
}

export { favoritesBase };

interface FaceMeta {
  originalName: string;
  addedAt: string;
  ext: string;
}

function readMetadata(): Record<string, FaceMeta> {
  if (!fs.existsSync(metadataPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeMetadata(data: Record<string, FaceMeta>) {
  fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2));
}

function toFavoriteFace(id: string, meta: FaceMeta) {
  return {
    id,
    originalName: meta.originalName,
    url: `/favorites/faces/${id}${meta.ext}`,
    addedAt: meta.addedAt,
  };
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/favorites/faces — 列出所有收藏的面容
router.get('/faces', (_req, res) => {
  const metadata = readMetadata();
  const list = Object.entries(metadata)
    .map(([id, meta]) => toFavoriteFace(id, meta))
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
  res.json(list);
});

// POST /api/favorites/faces — 收藏一张面容（以 SHA-256 内容哈希为 id，自动去重）
router.post('/faces', upload.single('image'), (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No image provided' });
    return;
  }
  const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const metadata = readMetadata();

  // 已收藏则直接返回已有条目
  if (metadata[hash]) {
    res.json(toFavoriteFace(hash, metadata[hash]));
    return;
  }

  const ext = (path.extname(file.originalname) || '.png').toLowerCase();
  const filepath = path.join(facesBase, `${hash}${ext}`);
  fs.writeFileSync(filepath, file.buffer);

  const meta: FaceMeta = {
    originalName: file.originalname || `${hash}${ext}`,
    addedAt: new Date().toISOString(),
    ext,
  };
  metadata[hash] = meta;
  writeMetadata(metadata);
  res.json(toFavoriteFace(hash, meta));
});

// DELETE /api/favorites/faces/:id — 取消收藏
router.delete('/faces/:id', (req, res) => {
  const id = req.params.id;
  const metadata = readMetadata();
  const meta = metadata[id];
  if (!meta) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const filepath = path.join(facesBase, `${id}${meta.ext}`);
  if (fs.existsSync(filepath)) {
    try {
      fs.unlinkSync(filepath);
    } catch (err) {
      console.error('[favorites] Failed to delete file:', err);
    }
  }
  delete metadata[id];
  writeMetadata(metadata);
  res.json({ success: true });
});

export default router;
