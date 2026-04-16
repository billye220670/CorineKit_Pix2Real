// ── 意图解析器 ─ 将 LLM Function Calling 结果映射为工作流参数 ─────────────

export interface ParsedIntent {
  taskType: 'generate' | 'process';
  workflowId: number;
  workflowName: string;
  prompt: string;
  negativePrompt?: string;
  character?: string;
  pose?: string;
  style?: string;
  quality?: 'fast' | 'high';
  recommendedLoras: Array<{
    model: string;       // LoRA 文件路径
    strength: number;
  }>;
  recommendedModel?: string;
  parameters?: {
    width?: number;
    height?: number;
    steps?: number;
    cfg?: number;
  };
}

// ── LoRA 匹配 ──────────────────────────────────────────────────────────────

export function findMatchingLoras(
  keywords: string[],
  metadata: any,
): Array<{ model: string; strength: number }> {
  if (!keywords || keywords.length === 0) return [];

  const results: Array<{ model: string; strength: number; score: number }> = [];
  const lowerKeywords = keywords.map((k) => k.toLowerCase());

  for (const [filePath, meta] of Object.entries(metadata)) {
    if (!meta || typeof meta !== 'object') continue;
    const m = meta as Record<string, any>;
    // 跳过 checkpoint 模型
    if (m.category === '光辉') continue;

    let score = 0;
    const searchFields = [
      m.nickname ?? '',
      m.triggerWords ?? '',
      m.description ?? '',
      ...(Array.isArray(m.keywords) ? m.keywords : []),
      ...(Array.isArray(m.styleTags) ? m.styleTags : []),
      m.category ?? '',
    ].map((s) => String(s).toLowerCase());

    const searchText = searchFields.join(' ');

    for (const kw of lowerKeywords) {
      if (!kw) continue;
      if (searchText.includes(kw)) {
        score += 1;
        // nickname 精确包含加额外分
        if ((m.nickname ?? '').toLowerCase().includes(kw)) {
          score += 2;
        }
      }
    }

    if (score > 0) {
      results.push({
        model: filePath,
        strength: m.recommendedStrength ?? 0.8,
        score,
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ model, strength }) => ({ model, strength }));
}

// ── 从 prompt 反向匹配 LoRA ─────────────────────────────────────────────────

// 最低匹配分数阈值：低于此值的 LoRA 视为不相关
const MATCH_SCORE_THRESHOLD = 5;

export function findMatchingLorasFromPrompt(
  prompt: string,
  keywords: string[],
  metadata: any,
): Array<{ model: string; strength: number }> {
  if (!prompt) return [];
  const promptLower = prompt.toLowerCase();
  const lowerKeywords = keywords.filter((k) => k).map((k) => k.toLowerCase());
  const matches: Array<{ model: string; strength: number; score: number }> = [];

  for (const [filePath, meta] of Object.entries(metadata)) {
    if (!meta || typeof meta !== 'object') continue;
    const m = meta as Record<string, any>;
    // 跳过 checkpoint 模型
    if (m.category === '光辉') continue;

    let score = 0;

    // 1. nickname vs keywords（中文匹配 — LLM 提取的角色名）
    if (m.nickname) {
      const nickLower = String(m.nickname).toLowerCase();
      for (const kw of lowerKeywords) {
        if (!kw) continue;
        if (nickLower.includes(kw) || kw.includes(nickLower)) {
          score += 10;
        }
      }
    }

    // 1b. nickname vs prompt（直接从 prompt 中匹配中文角色名）
    if (m.nickname) {
      const nickLower = String(m.nickname).toLowerCase();
      // 提取纯名字部分，去掉括号内容，如 "菲谢尔(原神)" → "菲谢尔"
      const pureName = nickLower.replace(/\(.*?\)/g, '').trim();
      if (pureName && pureName.length >= 2 && promptLower.includes(pureName)) {
        score += 6;
      }
    }

    // 2. triggerWords vs prompt（英文匹配 — 核心匹配点）
    //    只用第一个 trigger word（主标识符）匹配 prompt。
    //    triggerWords 格式通常为 "gcs_fischl, green eyes, blonde hair, ..."，
    //    第一个是角色唯一标识符，后面是外观描述词，外观词不应触发 LoRA 匹配。
    if (m.triggerWords) {
      const triggerStr = Array.isArray(m.triggerWords)
        ? m.triggerWords.join(',')
        : String(m.triggerWords);
      const triggers = triggerStr.split(',').map((t: string) => t.trim()).filter(Boolean);

      if (triggers.length > 0) {
        const primaryTrigger = triggers[0].toLowerCase();
        // 主标识符必须至少 3 个字符，避免太短的词误匹配
        if (primaryTrigger.length >= 3 && promptLower.includes(primaryTrigger)) {
          score += 10; // 高权重：精确标识符匹配
        }
      }
    }

    // 3. keywords / styleTags vs keywords（仅与 LLM 提取的关键词比较，不与 prompt 比较）
    //    prompt 中有大量通用外观描述词，直接比较会产生大量误匹配
    if (lowerKeywords.length > 0) {
      const allTags: string[] = [
        ...(Array.isArray(m.keywords) ? m.keywords : []),
        ...(Array.isArray(m.styleTags) ? m.styleTags : []),
      ];
      for (const tag of allTags) {
        if (!tag) continue;
        const tagLower = String(tag).toLowerCase();
        for (const kw of lowerKeywords) {
          if (!kw) continue;
          if (tagLower.includes(kw) || kw.includes(tagLower)) {
            score += 5;
          }
        }
      }
    }

    // 4. 文件路径中的名称 vs keywords
    if (lowerKeywords.length > 0) {
      const fileName = filePath.split(/[\\/]/).pop()?.replace('.safetensors', '') ?? '';
      for (const kw of lowerKeywords) {
        if (kw && fileName.toLowerCase().includes(kw)) {
          score += 6;
        }
      }
    }

    // 5. description vs keywords
    if (m.description && lowerKeywords.length > 0) {
      const descLower = String(m.description).toLowerCase();
      for (const kw of lowerKeywords) {
        if (kw && descLower.includes(kw)) {
          score += 4;
        }
      }
    }

    if (score >= MATCH_SCORE_THRESHOLD) {
      matches.push({
        model: filePath,
        strength: (m.recommendedStrength as number) ?? 0.8,
        score,
      });
    }
  }

  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ model, strength }) => ({ model, strength }));
}

// ── 工具调用解析 ─────────────────────────────────────────────────────────────

export function parseToolCall(toolCall: any, metadata: any): ParsedIntent {
  const fnName: string = toolCall.function?.name ?? '';
  let args: Record<string, any> = {};
  try {
    args = JSON.parse(toolCall.function?.arguments ?? '{}');
  } catch {
    args = {};
  }

  if (fnName === 'generate_image') {
    return parseGenerateImage(args, metadata);
  } else if (fnName === 'process_image') {
    return parseProcessImage(args, metadata);
  }

  // 未知工具 — 回退为文生图
  return parseGenerateImage(args, metadata);
}

function parseGenerateImage(
  args: Record<string, any>,
  metadata: any,
): ParsedIntent {
  const prompt: string = args.prompt ?? '';
  const negativePrompt: string = args.negative_prompt ?? '';
  const character: string = args.character ?? '';
  const pose: string = args.pose ?? '';
  const style: string = args.style ?? '';
  const quality: 'fast' | 'high' = args.quality === 'fast' ? 'fast' : 'high';

  // 收集关键词用于 LoRA 搜索（作为加分项）
  const searchKeywords: string[] = [];
  if (character) searchKeywords.push(character);
  if (pose) searchKeywords.push(pose);
  if (style) searchKeywords.push(style);

  // 始终使用 prompt-based 匹配作为主逻辑（prompt 总是有的）
  // keywords 仅作为额外加分项，不作为必要条件
  let recommendedLoras: Array<{ model: string; strength: number }> = [];
  if (prompt) {
    recommendedLoras = findMatchingLorasFromPrompt(prompt, searchKeywords, metadata);
  }
  // 如果 prompt 匹配无结果但有明确关键词，用关键词兜底
  if (recommendedLoras.length === 0 && searchKeywords.length > 0) {
    recommendedLoras = findMatchingLoras(searchKeywords, metadata);
  }

  // 根据质量决定参数
  const parameters = quality === 'fast'
    ? { width: 768, height: 1152, steps: 20, cfg: 7 }
    : { width: 1024, height: 1536, steps: 35, cfg: 7 };

  return {
    taskType: 'generate',
    workflowId: 7,       // 快速出图
    workflowName: '快速出图',
    prompt,
    negativePrompt: negativePrompt || undefined,
    character: character || undefined,
    pose: pose || undefined,
    style: style || undefined,
    quality,
    recommendedLoras,
    parameters,
  };
}

function parseProcessImage(
  args: Record<string, any>,
  metadata: any,
): ParsedIntent {
  const operation: string = args.operation ?? 'enhance';
  const prompt: string = args.prompt ?? '';

  // 映射 operation 到工作流
  let workflowId = 2;
  let workflowName = '精修放大';
  switch (operation) {
    case 'upscale':
      workflowId = 2;
      workflowName = '精修放大';
      break;
    case 'enhance':
      workflowId = 1;
      workflowName = '真人精修';
      break;
    case 'style_transfer':
      workflowId = 0;
      workflowName = '二次元转真人';
      break;
    case 'remove_clothes':
      workflowId = 5;
      workflowName = '解除装备';
      break;
  }

  return {
    taskType: 'process',
    workflowId,
    workflowName,
    prompt,
    quality: 'high',
    recommendedLoras: [],
  };
}
