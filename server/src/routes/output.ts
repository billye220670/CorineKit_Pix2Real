import express, { Router } from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sessionsBase } from '../services/sessionManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputBase = path.resolve(__dirname, '../../../output');

const router = Router();

const WORKFLOW_DIRS: Record<number, string> = {
  0: '0-二次元转真人',
  1: '1-真人精修',
  2: '2-精修放大',
  3: '3-快速生成视频',
  4: '4-视频放大',
  5: '5-解除装备',
  6: '6-真人转二次元',
  7: '7-快速出图',
  8: '8-黑兽换脸',
  9: '9-ZIT快出',
  10: '10-区域编辑',
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

// POST /api/output/open-file — open a file with the OS default application
router.post('/open-file', express.json(), (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    console.error('[Open File] Missing url, body:', req.body);
    res.status(400).json({ error: 'url is required' });
    return;
  }

  let filePath: string;
  try {
    if (url.startsWith('/api/session-files/')) {
      filePath = path.resolve(sessionsBase, decodeURIComponent(url.slice('/api/session-files/'.length)));
    } else if (url.startsWith('/output/')) {
      filePath = path.resolve(outputBase, decodeURIComponent(url.slice('/output/'.length)));
    } else if (url.startsWith('/api/output/')) {
      const parts = url.slice('/api/output/'.length).split('/');
      const workflowId = parseInt(parts[0], 10);
      const filename = decodeURIComponent(parts.slice(1).join('/'));
      const dirName = WORKFLOW_DIRS[workflowId];
      if (!dirName) {
        res.status(400).json({ error: `Unknown workflow: ${workflowId}` });
        return;
      }
      filePath = path.resolve(outputBase, dirName, filename);
    } else {
      console.error('[Open File] Unsupported URL:', url);
      res.status(400).json({ error: `Unsupported URL: ${url}` });
      return;
    }
  } catch (err) {
    console.error('[Open File] URL decode error:', url, err);
    res.status(400).json({ error: 'Invalid URL encoding' });
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const platform = process.platform;
  let cmd: string;
  if (platform === 'win32') {
    cmd = `start "" "${filePath}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${filePath}"`;
  } else {
    cmd = `xdg-open "${filePath}"`;
  }

  exec(cmd, (err) => {
    if (err) console.error('[Open File Error]', err);
  });

  res.json({ ok: true });
});

export default router;
