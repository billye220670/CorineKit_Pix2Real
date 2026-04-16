import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readGenerationLog, appendGenerationLog, readFavorites, writeFavorite, updateGenerationLogFavorite } from '../services/agentService.js';
import { buildUserProfile } from '../services/profileService.js';
import { callLLM, buildSystemPrompt, getAgentTools } from '../services/llmService.js';
import { parseToolCall } from '../services/intentParser.js';
import type { GenerationRecord } from '../services/agentService.js';
import type { LLMMessage } from '../services/llmService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const metadataPath = path.resolve(__dirname, '../../../model_meta/metadata.json');

// metadata 缓存 — 避免每次请求都读文件
let metadataCache: any = null;
let metadataCacheTime = 0;
const METADATA_CACHE_TTL = 60_000; // 1 分钟

function getMetadata(): any {
  const now = Date.now();
  if (metadataCache && now - metadataCacheTime < METADATA_CACHE_TTL) {
    return metadataCache;
  }
  metadataCache = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  metadataCacheTime = now;
  return metadataCache;
}

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

// POST /api/agent/favorite - 收藏/取消收藏
router.post('/favorite', (req, res) => {
  try {
    const { sessionId, imageId, tabId, isFavorited } = req.body as {
      sessionId: string;
      imageId: string;
      tabId: number;
      isFavorited: boolean;
    };
    if (!sessionId || !imageId || tabId == null) {
      res.status(400).json({ error: 'Missing required fields: sessionId, imageId, tabId' });
      return;
    }
    setImmediate(() => {
      try {
        writeFavorite(sessionId, imageId, tabId, isFavorited);
        // 同步更新 generation-log 中的 isFavorited
        try {
          updateGenerationLogFavorite(sessionId, imageId, isFavorited);
        } catch (err) {
          console.error('[Agent] Failed to sync favorite to generation log:', err);
        }
      } catch (err) {
        console.error('[Agent] Failed to write favorite:', err);
      }
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[Agent] favorite error:', err);
    res.status(500).json({ error: message });
  }
});

// GET /api/agent/favorites - 获取收藏列表
router.get('/favorites', (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing required query param: sessionId' });
      return;
    }
    const favorites = readFavorites(sessionId);
    res.json(favorites);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[Agent] favorites error:', err);
    res.status(500).json({ error: message });
  }
});

// GET /api/agent/user-profile - 获取用户偏好画像（全局，跨所有 session）
router.get('/user-profile', (req, res) => {
  try {
    const profile = buildUserProfile();
    res.json(profile);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[Agent] user-profile error:', err);
    res.status(500).json({ error: message });
  }
});

// POST /api/agent/chat - AI 对话 + 意图解析
router.post('/chat', async (req, res) => {
  try {
    const { sessionId, message, images } = req.body as {
      sessionId?: string;
      message?: string;
      images?: string[];
    };

    if (!sessionId || !message) {
      res.status(400).json({ error: 'sessionId and message required' });
      return;
    }

    // 1. 获取用户画像
    const profile = buildUserProfile();

    // 2. 读取模型元数据（带缓存）
    const metadata = getMetadata();

    // 3. 构建系统提示词
    const systemPrompt = buildSystemPrompt(profile, metadata);

    // 4. 构建消息列表
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    // 如果有图片，用 vision content 格式
    if (images && images.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: message },
          ...images.map((img: string) => ({
            type: 'image_url',
            image_url: { url: img },
          })),
        ],
      });
    } else {
      messages.push({ role: 'user', content: message });
    }

    // 5. 定义 Function Calling 工具
    const tools = getAgentTools();

    // 6. 调用 LLM
    const llmResponse = await callLLM({ messages, tools });

    // 7. 解析意图
    if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
      const intent = parseToolCall(llmResponse.toolCalls[0], metadata);
      res.json({
        type: 'tool_call',
        intent,
        message: llmResponse.content || `正在为您准备 ${intent.workflowName}...`,
      });
      return;
    }

    // 8. 纯文本回复（没有 tool call）
    res.json({
      type: 'text',
      message: llmResponse.content || '我没有理解您的需求，请再说详细一些。',
    });
  } catch (error: any) {
    console.error('[Agent] chat error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
