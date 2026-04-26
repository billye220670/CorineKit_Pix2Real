import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import {
  ensureSessionDirs,
  saveInputImage,
  saveMask,
  saveState,
  loadSession,
  listSessions,
  deleteSession,
  pruneOldSessions,
  saveCover,
} from '../services/sessionManager.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/session/:sessionId/images
// Body: multipart — field "image" (file), field "tabId" (number), field "imageId" (string)
router.post('/:sessionId/images', upload.single('image'), (req, res) => {
  const sessionId = String(req.params.sessionId);
  const tabId = parseInt(String(req.body.tabId), 10);
  const imageId = String(req.body.imageId ?? '');

  if (!req.file || isNaN(tabId) || !imageId) {
    res.status(400).json({ error: 'Missing required fields: image, tabId, imageId' });
    return;
  }

  const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
  const url = saveInputImage(sessionId, tabId, imageId, ext, req.file.buffer);
  res.json({ url });
});

// POST /api/session/:sessionId/masks
// Body: multipart — field "mask" (file PNG), field "tabId" (number), field "maskKey" (string)
router.post('/:sessionId/masks', upload.single('mask'), (req, res) => {
  const sessionId = String(req.params.sessionId);
  const tabId = parseInt(String(req.body.tabId), 10);
  const maskKey = String(req.body.maskKey ?? '');

  if (!req.file || isNaN(tabId) || !maskKey) {
    res.status(400).json({ error: 'Missing required fields: mask, tabId, maskKey' });
    return;
  }

  saveMask(sessionId, tabId, maskKey, req.file.buffer);
  res.json({ ok: true });
});

// PUT /api/session/:sessionId/state  (normal saves)
// POST /api/session/:sessionId/state (sendBeacon on page close)
function handleSaveState(req: import('express').Request, res: import('express').Response): void {
  const sessionId = String(req.params.sessionId);
  const body = req.body as { activeTab: number; tabData: Record<number, unknown> };

  if (!body || body.activeTab === undefined || !body.tabData) {
    res.status(400).json({ error: 'Invalid state body' });
    return;
  }

  ensureSessionDirs(sessionId);
  saveState(sessionId, { activeTab: body.activeTab, tabData: body.tabData as never });
  res.json({ ok: true });
}

router.put('/:sessionId/state', handleSaveState);
router.post('/:sessionId/state', handleSaveState);

// GET /api/session/:sessionId
router.get('/:sessionId', (req, res) => {
  const sessionId = String(req.params.sessionId);
  const session = loadSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

// GET /api/sessions
router.get('/', (_req, res) => {
  const sessions = listSessions();
  res.json(sessions);
});

// POST /api/session/:sessionId/cover
// Body: JSON { sourceUrl: string }
router.post('/:sessionId/cover', (req, res) => {
  const sessionId = String(req.params.sessionId);
  const { sourceUrl } = req.body as { sourceUrl: string };
  if (!sourceUrl) {
    res.status(400).json({ error: 'Missing sourceUrl' });
    return;
  }
  try {
    const result = saveCover(sessionId, sourceUrl);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

// DELETE /api/session/:sessionId
router.delete('/:sessionId', (req, res) => {
  const sessionId = String(req.params.sessionId);
  deleteSession(sessionId);
  res.json({ ok: true });
});

export default router;
