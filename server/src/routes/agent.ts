import { Router } from 'express';
import { readGenerationLog, appendGenerationLog } from '../services/agentService.js';
import type { GenerationRecord } from '../services/agentService.js';

const router = Router();

// POST /api/agent/log-generation - 记录生成日志
router.post('/log-generation', (req, res) => {
  try {
    const record = req.body as GenerationRecord;
    if (!record.sessionId || !record.id) {
      res.status(400).json({ error: 'Missing required fields: sessionId, id' });
      return;
    }
    // 异步写入，不阻塞响应
    setImmediate(() => {
      try {
        appendGenerationLog(record.sessionId, record);
      } catch (err) {
        console.error('[Agent] Failed to write generation log:', err);
      }
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[Agent] log-generation error:', err);
    res.status(500).json({ error: message });
  }
});

// GET /api/agent/generation-history - 获取生成历史
router.get('/generation-history', (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing required query param: sessionId' });
      return;
    }
    const logs = readGenerationLog(sessionId);
    res.json(logs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[Agent] generation-history error:', err);
    res.status(500).json({ error: message });
  }
});

export default router;
