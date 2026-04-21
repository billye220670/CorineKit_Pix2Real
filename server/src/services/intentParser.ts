// ── 意图解析器 ─ 将 LLM Function Calling 结果映射为工作流参数 ─────────────

import type { UserPreferenceProfile } from './profileService.js';

export interface ParsedVariant {
  prompt: string;
  recommendedLoras?: Array<{ model: string; strength: number }>;
  recommendedModel?: string;
  parameters?: { width?: number; height?: number; steps?: number; cfg?: number };
}

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
  variants?: ParsedVariant[];
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

// ── 分类默认强度 ───────────────────────────────────────────────────────────────

function getDefaultStrength(category?: string): number {
  const map: Record<string, number> = {
    '角色': 0.8, '姿势': 0.7, '表情': 0.65, '风格': 0.6,
    '性别': 0.7, '多视角': 0.7, '滑块': 0.5,
  };
  return map[category || ''] || 0.7;
}

// ── 分类去重 ─────────────────────────────────────────────────────────────────

const CATEGORY_LIMITS: Record<string, number> = {
  '角色': 1,
  '姿势': 1,
  '表情': 1,
  '风格': 1,
  '性别': 1,
  '多视角': 1,
  '滑块': 1,
};

function deduplicateByCategory(
  results: Array<{ model: string; strength: number; score: number; category?: string }>,
): Array<{ model: string; strength: number }> {
  const categoryCount: Record<string, number> = {};
  const deduped: Array<{ model: string; strength: number }> = [];

  for (const r of results) {
    const cat = r.category || '其他';
    const limit = CATEGORY_LIMITS[cat] || 1;
    categoryCount[cat] = categoryCount[cat] || 0;

    if (categoryCount[cat] < limit) {
      deduped.push({ model: r.model, strength: r.strength });
      categoryCount[cat]++;
    }

    if (deduped.length >= 5) break;
  }

  return deduped;
}

// ── 意图上下文：LLM Function Calling 已明确指定的维度 ──────────────────────

export interface IntentContext {
  specifiedCharacter?: string;
  specifiedPose?: string;
  specifiedStyle?: string;
}

// ── findMatchingLorasFromPrompt ─────────────────────────────────────────────

export function findMatchingLorasFromPrompt(
  prompt: string,
  keywords: string[],
  metadata: any,
  userProfile?: UserPreferenceProfile,
  intentContext?: IntentContext,
): Array<{ model: string; strength: number }> {
  if (!prompt) return [];
  const promptLower = prompt.toLowerCase();
  const lowerKeywords = keywords.filter((k) => k).map((k) => k.toLowerCase());
  const matches: Array<{ model: string; strength: number; score: number; category?: string }> = [];

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
    const fileName = filePath.split(/[\\/]/).pop()?.replace('.safetensors', '') ?? '';
    if (lowerKeywords.length > 0) {
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

    // 注：推荐完全基于 prompt 匹配，不混入画像偏好加分

    if (score >= MATCH_SCORE_THRESHOLD) {
      // 使用元数据 recommendedStrength，回退到分类默认强度
      const strength = (m.recommendedStrength as number) || getDefaultStrength(m.category);
      matches.push({
        model: filePath,
        strength,
        score,
        category: m.category || undefined,
      });
    }
  }

  // 按分数排序后进行分类去重
  matches.sort((a, b) => b.score - a.score);
  return deduplicateByCategory(matches);
}

// ── LoRA 名称模糊匹配 ────────────────────────────────────────────────────────

/**
 * 根据模糊名称在 metadata 中查找匹配的 LoRA 文件路径
 * 支持 nickname、文件名、关键词模糊匹配（不区分大小写）
 */
function findLoraByName(name: string, metadata: any): string | undefined {
  if (!name) return undefined;
  const nameLower = name.toLowerCase();

  let bestMatch: string | undefined;
  let bestScore = 0;

  for (const [filePath, meta] of Object.entries(metadata)) {
    if (!meta || typeof meta !== 'object') continue;
    const m = meta as Record<string, any>;
    // 跳过 checkpoint 模型
    if (m.category === '光辉' || m.category === 'PONY') continue;

    let score = 0;
    const nickname = String(m.nickname || '').toLowerCase();
    const fileNameLower = filePath.toLowerCase();

    // nickname 匹配
    if (nickname === nameLower) {
      score += 100;
    } else if (nickname.includes(nameLower) || nameLower.includes(nickname)) {
      score += 50;
    }

    // 文件名匹配
    if (fileNameLower.includes(nameLower)) {
      score += 30;
    }

    // 关键词匹配
    const keywords = Array.isArray(m.keywords) ? m.keywords : [];
    for (const kw of keywords) {
      const kwLower = String(kw).toLowerCase();
      if (kwLower.includes(nameLower) || nameLower.includes(kwLower)) {
        score += 20;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = filePath;
    }
  }

  return bestMatch;
}

// ── 模型系列标准化 ─────────────────────────────────────────────────────────────

/** 将 LoRA compatibleModels 中的各种别名统一为 checkpoint category 值 */
function normalizeModelFamily(family: string): string | null {
  const f = family.trim();
  if (['IL', '光辉', '光辉系列'].includes(f)) return '光辉';
  if (['PONY', 'PONY系列'].includes(f)) return 'PONY';
  if (f === '通用') return null; // 通用 = 不限制
  return null;
}

// ── 基础模型模糊匹配 ───────────────────────────────────────────────────────────

/**
 * 根据用户提供的模糊名称，在 metadata 中查找匹配的 checkpoint 模型
 * 支持 nickname、文件名、关键词模糊匹配（不区分大小写）
 */
function findCheckpointByName(name: string, metadata: any): string | undefined {
  if (!name) return undefined;
  const nameLower = name.toLowerCase();

  // 精确匹配：直接用 name 作为 key 查找
  if (metadata[name]) {
    const m = metadata[name] as Record<string, any>;
    if (m.category === '光辉' || m.category === 'PONY') return name;
  }

  // 模糊匹配：遍历所有 checkpoint，匹配 nickname / key / keywords
  let bestMatch: string | undefined;
  let bestScore = 0;

  for (const [filePath, meta] of Object.entries(metadata)) {
    if (!meta || typeof meta !== 'object') continue;
    const m = meta as Record<string, any>;
    if (m.category !== '光辉' && m.category !== 'PONY') continue;

    let score = 0;
    const nickname = String(m.nickname || '').toLowerCase();
    const fileNameLower = filePath.toLowerCase();

    // nickname 匹配
    if (nickname === nameLower) {
      score += 100; // 完全匹配
    } else if (nickname.includes(nameLower) || nameLower.includes(nickname)) {
      score += 50;
    }

    // 文件名匹配
    if (fileNameLower.includes(nameLower)) {
      score += 30;
    }

    // 关键词匹配
    const keywords = Array.isArray(m.keywords) ? m.keywords : [];
    for (const kw of keywords) {
      const kwLower = String(kw).toLowerCase();
      if (kwLower.includes(nameLower) || nameLower.includes(kwLower)) {
        score += 20;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = filePath;
    }
  }

  return bestMatch;
}

// ── 基础模型推荐 ─────────────────────────────────────────────────────────────

/**
 * 根据推荐 LoRA 的兼容性 + 用户偏好，智能推荐基础模型（checkpoint）
 * 优先级：LoRA 兼容性（硬约束）> 用户偏好（软排序）> 默认值（不返回）
 */
function recommendBaseModel(
  recommendedLoras: Array<{ model: string; strength: number }>,
  metadata: any,
  profile?: UserPreferenceProfile,
): string | undefined {
  // ── 1. 收集所有 checkpoint 模型（按 category 索引） ──
  const checkpointsByFamily = new Map<string, string[]>(); // category → filename[]
  for (const [filePath, meta] of Object.entries(metadata)) {
    if (!meta || typeof meta !== 'object') continue;
    const m = meta as Record<string, any>;
    const cat = m.category as string | undefined;
    if (cat === '光辉' || cat === 'PONY') {
      const list = checkpointsByFamily.get(cat) ?? [];
      list.push(filePath);
      checkpointsByFamily.set(cat, list);
    }
  }

  // ── 2. 从推荐 LoRA 提取兼容模型系列 ──
  let candidateFamilies: string[] | null = null;

  if (recommendedLoras.length > 0) {
    // 提取每个 LoRA 的标准化 compatibleModels
    const loraFamilies: Array<Set<string>> = [];
    for (const lora of recommendedLoras) {
      const m = metadata[lora.model] as Record<string, any> | undefined;
      if (!m?.compatibleModels || !Array.isArray(m.compatibleModels)) continue;
      const families = new Set<string>();
      for (const raw of m.compatibleModels as string[]) {
        const norm = normalizeModelFamily(raw);
        if (norm) families.add(norm);
      }
      if (families.size > 0) loraFamilies.push(families);
    }

    if (loraFamilies.length > 0) {
      // 尝试取交集（所有 LoRA 都兼容的系列）
      let intersection = new Set(loraFamilies[0]);
      for (let i = 1; i < loraFamilies.length; i++) {
        intersection = new Set([...intersection].filter(f => loraFamilies[i].has(f)));
      }

      if (intersection.size > 0) {
        candidateFamilies = [...intersection];
      } else {
        // 无交集时，以第一个 LoRA（通常是角色 LoRA，权重最高）的系列为准
        candidateFamilies = [...loraFamilies[0]];
      }
    }
  }

  // ── 3. 确定候选 checkpoint 列表 ──
  let candidateCheckpoints: string[] = [];

  if (candidateFamilies && candidateFamilies.length > 0) {
    // 有 LoRA 兼容性约束：只从兼容的系列中选
    for (const fam of candidateFamilies) {
      const ckpts = checkpointsByFamily.get(fam);
      if (ckpts) candidateCheckpoints.push(...ckpts);
    }
  } else {
    // 无 LoRA 或 LoRA 无兼容性信息：所有 checkpoint 都是候选
    for (const ckpts of checkpointsByFamily.values()) {
      candidateCheckpoints.push(...ckpts);
    }
  }

  if (candidateCheckpoints.length === 0) return undefined;

  // ── 4. 用用户偏好排序 ──
  if (profile?.modelPreferences && profile.modelPreferences.length > 0) {
    // 构建 model → score 映射
    const prefScores = new Map<string, number>();
    for (const pref of profile.modelPreferences) {
      prefScores.set(pref.model, pref.score);
    }

    // 按偏好分数降序排序，无偏好的排最后
    candidateCheckpoints.sort((a, b) => {
      const sa = prefScores.get(a) ?? -1;
      const sb = prefScores.get(b) ?? -1;
      return sb - sa;
    });
  }

  return candidateCheckpoints[0];
}

// ── 工具调用解析 ─────────────────────────────────────────────────────────────

export function parseToolCall(toolCall: any, metadata: any, userProfile?: UserPreferenceProfile): ParsedIntent {
  const fnName: string = toolCall.function?.name ?? '';
  let args: Record<string, any> = {};
  try {
    args = JSON.parse(toolCall.function?.arguments ?? '{}');
  } catch {
    args = {};
  }

  if (fnName === 'generate_image') {
    return parseGenerateImage(args, metadata, userProfile);
  } else if (fnName === 'process_image') {
    return parseProcessImage(args, metadata);
  }

  // 未知工具 — 回退为文生图
  return parseGenerateImage(args, metadata, userProfile);
}

function parseGenerateImage(
  args: Record<string, any>,
  metadata: any,
  userProfile?: UserPreferenceProfile,
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

  // 构建意图上下文：记录用户已明确指定的维度，画像加权时跳过这些维度
  const intentContext: IntentContext = {
    specifiedCharacter: character || undefined,
    specifiedPose: pose || undefined,
    specifiedStyle: style || undefined,
  };

  // 始终使用 prompt-based 匹配作为主逻辑（prompt 总是有的）
  // keywords 仅作为额外加分项，不作为必要条件
  let recommendedLoras: Array<{ model: string; strength: number }> = [];
  if (prompt) {
    recommendedLoras = findMatchingLorasFromPrompt(prompt, searchKeywords, metadata, userProfile, intentContext);
  }
  // 如果 prompt 匹配无结果但有明确关键词，用关键词兜底
  if (recommendedLoras.length === 0 && searchKeywords.length > 0) {
    recommendedLoras = findMatchingLoras(searchKeywords, metadata);
  }

  // 根据质量决定参数
  const parameters = quality === 'fast'
    ? { width: 768, height: 1152, steps: 20, cfg: 7 }
    : { width: 1024, height: 1536, steps: 35, cfg: 7 };

  // 如果 LLM 传了 model 参数（用户明确指定），优先使用
  let recommendedModel: string | undefined;
  if (args.model) {
    recommendedModel = findCheckpointByName(String(args.model), metadata);
  }

  // 否则走 recommendBaseModel 自动推荐
  if (!recommendedModel) {
    recommendedModel = recommendBaseModel(recommendedLoras, metadata, userProfile);
  }

  const intent: ParsedIntent = {
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
    recommendedModel,
    parameters,
  };

  // 如果有 variants，为每个变体独立解析
  if (args.variants && Array.isArray(args.variants) && args.variants.length > 0) {
    const parsedVariants: ParsedVariant[] = [];

    for (const v of args.variants) {
      const variantPrompt = v.prompt || intent.prompt;

      // 解析该变体的 LoRA
      let variantLoras = intent.recommendedLoras || [];
      if (v.loras && Array.isArray(v.loras)) {
        variantLoras = v.loras.map((l: any) => {
          const matched = findLoraByName(l.name, metadata);
          return matched ? { model: matched, strength: l.strength || 0.8 } : null;
        }).filter(Boolean) as Array<{ model: string; strength: number }>;
      }

      // 独立推荐模型
      let variantModel = intent.recommendedModel;
      if (v.model) {
        const found = findCheckpointByName(v.model, metadata);
        if (found) variantModel = found;
      } else if (variantLoras.length > 0) {
        variantModel = recommendBaseModel(variantLoras, metadata, userProfile);
      }

      // 尺寸参数
      const variantParams: { width?: number; height?: number } = {};
      if (v.width) variantParams.width = v.width;
      if (v.height) variantParams.height = v.height;

      parsedVariants.push({
        prompt: variantPrompt,
        recommendedLoras: variantLoras,
        recommendedModel: variantModel,
        parameters: Object.keys(variantParams).length > 0 ? variantParams : intent.parameters,
      });
    }

    intent.variants = parsedVariants;
  }

  return intent;
}

function parseProcessImage(
  args: Record<string, any>,
  metadata: any,
): ParsedIntent {
  const action: string = args.action ?? 'upscale';
  const prompt: string = args.prompt ?? '';

  const actionMap: Record<string, { workflowId: number; workflowName: string }> = {
    'anime_to_real': { workflowId: 0, workflowName: '二次元转真人' },
    'upscale': { workflowId: 2, workflowName: '精修放大' },
    'real_to_anime': { workflowId: 6, workflowName: '真人转二次元' },
  };

  const mapped = actionMap[action] || actionMap['upscale'];

  return {
    taskType: 'process',
    workflowId: mapped.workflowId,
    workflowName: mapped.workflowName,
    prompt,
    quality: 'high',
    recommendedLoras: [],
  };
}
