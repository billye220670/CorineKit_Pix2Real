import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputBase = path.resolve(__dirname, '../../../output');

const router = Router();

const WORKFLOW_DIRS: Record<number, string> = {
  0: '0-二次元转真人',
  1: '1-真人精修',
  2: '2-精修放大',
  3: '3-快速生成视频',
  4: '4-视频放大',
};

// GET /api/output/:workflowId - list output files
router.get('/:workflowId', (req, res) => {
  const workflowId = parseInt(req.params.workflowId, 10);
  const dirName = WORKFLOW_DIRS[workflowId];

  if (!dirName) {
    res.status(400).json({ error: `Unknown workflow: ${workflowId}` });
    return;
  }

  const dirPath = path.join(outputBase, dirName);

  if (!fs.existsSync(dirPath)) {
    res.json([]);
    return;
  }

  const files = fs.readdirSync(dirPath)
    .filter((f) => !f.startsWith('.'))
    .map((f) => {
      const stat = fs.statSync(path.join(dirPath, f));
      return {
        filename: f,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        url: `/api/output/${workflowId}/${encodeURIComponent(f)}`,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(files);
});

// GET /api/output/:workflowId/:filename - serve single file
router.get('/:workflowId/:filename', (req, res) => {
  const workflowId = parseInt(req.params.workflowId, 10);
  const dirName = WORKFLOW_DIRS[workflowId];

  if (!dirName) {
    res.status(400).json({ error: `Unknown workflow: ${workflowId}` });
    return;
  }

  const filePath = path.join(outputBase, dirName, req.params.filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.sendFile(filePath);
});

export default router;
