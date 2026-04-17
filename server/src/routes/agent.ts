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

// ── 风格标签中英映射 ─────────────────────────────────────────────────────────

const STYLE_TAG_CN: Record<string, string> = {
  'cyberpunk': '赛博朋克',
  'genshin': '原神',
  'realistic': '写实',
  'anime': '二次元',
  'comic': '漫画',
  'fantasy': '奇幻',
  'dark': '暗黑',
  'cute': '可爱',
  'masterpiece': '精品',
  'character': '角色',
  'pose': '姿势',
  'expression': '表情',
  'style': '风格',
  'gender': '性别',
  'multi_angle': '多视角',
  'slider': '滑块',
  'ghost_hunter': '探灵',
  'witch_revenge': '魔女之夜',
  'honor_of_kings': '王者荣耀',
  'blue_archive': '碧蓝档案',
  'wuthering_waves': '鸣潮',
  'zenless': '绝区零',
  'arknights_endfield': '终末地',
};

function translateStyleTag(tag: string): string {
  return STYLE_TAG_CN[tag.toLowerCase()] || tag;
}

// ── 辅助函数：从画像中提取指定分类的 LoRA 中文名 ─────────────────────────────

function extractLorasByCategory(profile: any, metadata: any, category: string, limit: number): string[] {
  const names: string[] = [];
  const loras = (profile.loraPreferences || [])
    .filter((lp: any) => metadata[lp.model]?.category === category);

  for (const lp of loras) {
    if (names.length >= limit) break;
    const meta = metadata[lp.model];
    if (!meta?.nickname) continue;

    // 提取中文自然语言名称，去掉括号中的来源标注
    let name = String(meta.nickname).replace(/\(.*?\)/g, '').trim();

    // 对于姿势/表情/风格类，如果 description 更自然则优先使用核心描述
    if ((category === '姿势' || category === '表情' || category === '风格') && meta.description) {
      const desc = String(meta.description);
      const match = desc.match(/LoRA\s*-\s*(.*?)(?:[，,]|$)/);
      if (match) {
        const extracted = match[1].replace(/\(.*?\)/g, '').trim();
        if (extracted) name = extracted;
      }
    }

    if (name && !names.includes(name)) names.push(name);
  }

  return names;
}

// ── 画像摘要构建（给 LLM 看的） ──────────────────────────────────────────────

function buildProfileSummary(profile: any, metadata: any): string {
  const parts: string[] = [];

  // 常用角色
  const characters = (profile.loraPreferences || [])
    .filter((lp: any) => metadata[lp.model]?.category === '角色')
    .slice(0, 5);
  if (characters.length > 0) {
    const names = characters.map((lp: any) => {
      const meta = metadata[lp.model];
      return meta?.nickname || '未知';
    });
    parts.push(`常用角色：${names.join('、')}（按使用频率排序）`);
  }

  // 常用姿势
  const poses = (profile.loraPreferences || [])
    .filter((lp: any) => metadata[lp.model]?.category === '姿势')
    .slice(0, 5);
  if (poses.length > 0) {
    const names = poses.map((lp: any) => {
      const meta = metadata[lp.model];
      return `${meta?.nickname || '未知'}（${meta?.description || ''}）`;
    });
    parts.push(`常用姿势：${names.join('、')}`);
  }

  // 常用表情
  const expressions = (profile.loraPreferences || [])
    .filter((lp: any) => metadata[lp.model]?.category === '表情')
    .slice(0, 5);
  if (expressions.length > 0) {
    const names = expressions.map((lp: any) => {
      const meta = metadata[lp.model];
      return `${meta?.nickname || '未知'}（${meta?.description || ''}）`;
    });
    parts.push(`常用表情：${names.join('、')}`);
  }

  // 风格偏好
  const styles = (profile.styleFeatures || []).slice(0, 10);
  if (styles.length > 0) {
    const tags = styles.map((s: any) => s.tag).join('、');
    parts.push(`风格标签偏好：${tags}`);
  }

  // 常用模型
  const models = (profile.modelPreferences || []).slice(0, 3);
  if (models.length > 0) {
    const names = models.map((mp: any) => {
      const meta = metadata[mp.model];
      return meta?.nickname || mp.model;
    });
    parts.push(`常用基础模型：${names.join('、')}`);
  }

  // 常用组合
  const combos = (profile.frequentCombinations || []).slice(0, 3);
  if (combos.length > 0) {
    const descs = combos.map((c: any) => {
      const loraNames = (c.loras || []).map((l: string) => {
        const meta = metadata[l];
        return meta?.nickname || l;
      }).join(' + ');
      return `${loraNames}（${c.count}次）`;
    });
    parts.push(`常用组合：${descs.join('、')}`);
  }

  if (parts.length === 0) {
    return '该用户暂无使用记录';
  }

  return parts.join('\n');
}

// ── 暖场建议兜底（LLM 调用失败时使用） ──────────────────────────────────────

function fallbackSuggestions(profile: any, metadata: any): string[] {
  const suggestions: string[] = [];

  const characters = extractLorasByCategory(profile, metadata, '角色', 3);
  const poses = extractLorasByCategory(profile, metadata, '姿势', 3);
  const expressions = extractLorasByCategory(profile, metadata, '表情', 3);
  const styles = extractLorasByCategory(profile, metadata, '风格', 2);

  if (styles.length < 2) {
    const styleTags = (profile.styleFeatures || [])
      .map((sf: any) => translateStyleTag(sf.tag))
      .filter((t: string) => t && !styles.includes(t));
    for (const t of styleTags) {
      if (styles.length >= 2) break;
      styles.push(t);
    }
  }

  if (characters.length > 0) {
    const char = characters[0];
    const extras: string[] = [];
    if (expressions.length > 0) extras.push(`${expressions[0]}的表情`);
    if (poses.length > 0) extras.push(`${poses[0]}的姿势`);
    if (extras.length > 0) {
      suggestions.push(`生成一张${char}，${extras.join('、')}的图`);
    } else {
      suggestions.push(`生成一张${char}的图`);
    }
  }

  if (characters.length > 1) {
    const char = characters[1];
    const extras: string[] = [];
    if (poses.length > 1) extras.push(`${poses[1]}的姿势`);
    else if (poses.length > 0) extras.push(`${poses[0]}的姿势`);
    if (extras.length > 0) {
      suggestions.push(`画一张${char}，${extras.join('、')}的图`);
    } else {
      suggestions.push(`画一张${char}的二次元图`);
    }
  }

  if (styles.length > 0) {
    suggestions.push(`画一张${styles[0]}的场景图`);
  }

  const defaults = [
    '生成一张二次元风格的角色图',
    '帮我画一张赛博朋克风格的壁纸',
    '画一张可爱风格的角色立绘',
  ];
  while (suggestions.length < 3) {
    const d = defaults.shift();
    if (d && !suggestions.includes(d)) suggestions.push(d);
    else break;
  }

  return suggestions.slice(0, 4);
}

// ── 暖场建议生成（LLM 驱动） ────────────────────────────────────────────────

async function generateWarmUpSuggestions(profile: any, metadata: any): Promise<string[]> {
  try {
    const profileSummary = buildProfileSummary(profile, metadata);

    // 画像为空时直接走兜底
    if (profileSummary === '该用户暂无使用记录') {
      return fallbackSuggestions(profile, metadata);
    }

    const prompt = `你是一个AI绘图助手。请根据以下用户画像数据，先分析用户的深层喜好和审美倾向，然后生成4条图片生成建议。

用户画像：
${profileSummary}

请先思考这些数据反映了用户什么样的偏好，然后生成4条建议。

关键要求——每条建议必须有明显差异：
1. 第一条：用户最常用的角色 + 偏好的姿势或表情
2. 第二条：用户画像中另一个角色 + 不同的风格
3. 第三条：将画像中不同维度进行新的混搭组合（比如把A角色配B姿势，或者把某个表情配某个风格）
4. 第四条：基于画像中的风格偏好，生成一个不指定角色的场景/氛围图建议

严格约束：
- 所有建议中出现的角色名、姿势名、表情名、风格名必须来自上方用户画像数据，严禁编造画像中不存在的内容
- 如果画像中角色不足2个，可以对同一角色做不同风格/姿势的变体

其他要求：
- 4条建议之间不要重复相同的角色、姿势或风格组合
- 全部用中文自然语言，不要英文标签或技术术语
- 每条控制在25字以内
- 只输出建议文本，每行一条，不要编号

示例（展示差异性）：
菲谢尔穿白袜嫌弃脸的赛博朋克风格图
安琪拉的壁尻姿势，宫崎骏画风
画一个害羞表情的校园风女孩
一张暗黑哥特风的城堡场景壁纸`;

    const messages: LLMMessage[] = [
      { role: 'system', content: '你是一个简洁的建议生成器。只输出建议文本，不要任何解释。' },
      { role: 'user', content: prompt },
    ];

    const result = await callLLM({ messages, temperature: 0.9 });

    if (result.content) {
      const lines = result.content
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0 && l.length <= 50)
        .map((l: string) => l.replace(/^\d+[.、)\]]\s*/, ''))
        .filter((l: string) => l.length > 0)
        .slice(0, 4);

      if (lines.length >= 2) return lines;
    }
  } catch (err) {
    console.error('[Agent] LLM warm-up suggestion generation failed:', err);
  }

  // 兜底
  return fallbackSuggestions(profile, metadata);
}

// ── 后续建议生成（LLM 驱动） ────────────────────────────────────────────────

async function generateFollowUpSuggestions(intent: any, profile: any, metadata: any): Promise<string[]> {
  try {
    const profileSummary = buildProfileSummary(profile, metadata);

    const currentLoras = (intent.recommendedLoras || [])
      .map((l: any) => metadata[l.model]?.nickname || l.model)
      .join('、');
    const currentPrompt = intent.prompt || '';

    const prompt = `你是一个AI绘图助手。用户刚刚生成了一张图片，请根据用户画像推荐4个"下一步"建议。

当前生成内容：
- 使用的角色/LoRA：${currentLoras || '无'}
- 提示词摘要：${currentPrompt || '无'}

用户画像：
${profileSummary}

请先思考：结合用户的喜好偏好，什么样的变化会让用户感兴趣？

关键要求——4条建议要覆盖不同的变化维度：
1. 一条关于换风格的建议
2. 一条关于换姿势或表情的建议
3. 一条关于换角色的建议
4. 一条关于调整画面氛围或场景的建议

4条之间不要有重叠的变化方向。简短自然，每条控制在15字以内。
全部中文，不要技术术语。
严格约束：建议中提到的所有角色、姿势、表情必须来自用户画像数据，不要编造不存在的内容。
只输出建议文本，每行一条，不要编号。

示例（展示差异性）：
换成赛博朋克风格
改成壁尻姿势加嫌弃脸
试试用菲谢尔
加上黄昏海边的氛围`;

    const messages: LLMMessage[] = [
      { role: 'system', content: '你是一个简洁的建议生成器。只输出建议文本，不要任何解释。' },
      { role: 'user', content: prompt },
    ];

    const result = await callLLM({ messages, temperature: 0.9 });

    if (result.content) {
      const lines = result.content
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0 && l.length <= 30)
        .map((l: string) => l.replace(/^\d+[.、)\]]\s*/, ''))
        .filter((l: string) => l.length > 0)
        .slice(0, 4);

      if (lines.length >= 2) return lines;
    }
  } catch (err) {
    console.error('[Agent] LLM follow-up suggestion generation failed:', err);
  }

  return [];
}

const router = Router();

// GET /api/agent/suggestions - 暖场建议
router.get('/suggestions', async (req, res) => {
  try {
    const profile = buildUserProfile();
    const metadata = getMetadata();
    const suggestions = await generateWarmUpSuggestions(profile, metadata);
    res.json({ suggestions });
  } catch (err) {
    // 无画像或出错时返回默认建议
    res.json({ suggestions: [
      '生成一张二次元风格的图',
      '帮我画一张壁纸',
      '画一张赛博朋克风格的角色图',
    ]});
  }
});

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
      const intent = parseToolCall(llmResponse.toolCalls[0], metadata, profile);
      const suggestions = await generateFollowUpSuggestions(intent, profile, metadata);
      res.json({
        type: 'tool_call',
        intent,
        message: llmResponse.content || `正在为您准备 ${intent.workflowName}...`,
        suggestions,
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
