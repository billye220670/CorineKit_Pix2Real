import fetch from 'node-fetch';
import type { UserPreferenceProfile } from './profileService.js';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface LLMRequest {
  messages: LLMMessage[];
  tools?: Tool[];
  temperature?: number;
  toolChoice?: string;
}

export interface LLMResponse {
  content: string | null;
  toolCalls?: Array<{
    id: string;
    function: {
      name: string;
      arguments: string; // JSON string
    };
  }>;
}

// ── API 配置 (复用 workflow.ts 中的 Grok 配置) ──────────────────────────────

const GROK_API_URL = 'https://api.jiekou.ai/openai/v1/chat/completions';
const GROK_API_KEY = 'sk_4kPU46GrW4F-GLsGzOygbmDVA8hoinn4b1PmgiQFB6s';
const GROK_MODEL = 'grok-4-fast-non-reasoning';

// ── 核心 LLM 调用 ─────────────────────────────────────────────────────────────

export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const body: Record<string, any> = {
    model: GROK_MODEL,
    messages: request.messages,
    max_tokens: 4096,
    temperature: request.temperature ?? 0.7,
  };

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
    body.tool_choice = request.toolChoice || 'auto';
  }

  const response = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[LLM] API error:', response.status, errorText);
    throw new Error(`LLM API 错误: ${response.status}`);
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          type: string;
          function: {
            name: string;
            arguments: string;
          };
        }>;
      };
    }>;
  };

  const choice = data.choices?.[0]?.message;
  if (!choice) {
    throw new Error('LLM API 未返回有效响应');
  }

  return {
    content: choice.content ?? null,
    toolCalls: choice.tool_calls?.map((tc) => ({
      id: tc.id,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    })),
  };
}

// ── Function Calling 工具定义 ────────────────────────────────────────────────

export function getAgentTools(): Tool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'generate_image',
        description: '根据用户的文字描述生成一张图片。将用户的需求转化为具体的生成参数。',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: '英文提示词，描述要生成的图片内容。包括角色、姿势、场景、风格等。例如: "fischl, standing, cyberpunk city, masterpiece, best quality"',
            },
            negative_prompt: {
              type: 'string',
              description: '英文负面提示词。例如: "low quality, blurry, deformed"',
            },
            character: {
              type: 'string',
              description: '角色名（中文原名），用于匹配角色 LoRA 模型，非常重要。如果用户提到任何角色，此字段必须填写。例如: "菲谢尔", "安琪拉", "胡桃"',
            },
            pose: {
              type: 'string',
              description: '姿势关键词（中文），用于匹配姿势 LoRA。如果用户提到姿势，必须填写。例如: "壁尻", "站立", "坐姿"',
            },
            style: {
              type: 'string',
              description: '风格关键词（中文），用于匹配风格 LoRA。如果用户提到风格，必须填写。例如: "赛博朋克", "写实", "水彩"',
            },
           quality: {
              type: 'string',
              enum: ['fast', 'high'],
              description: '质量要求。fast=快速出图，high=高质量',
            },
            model: {
              type: 'string',
              description: '基础模型名称（如用户明确要求使用特定模型时传入）。留空则根据LoRA兼容性自动选择。可用模型见系统提示词中的"可用基础模型"列表。',
            },
          },
          required: ['prompt'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_image',
        description: '处理用户上传的图片。支持：二次元转真人（anime_to_real）、精修放大（upscale）、真人转二次元（real_to_anime）。用户必须已上传图片才能调用此工具。',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['anime_to_real', 'upscale', 'real_to_anime'],
              description: '处理动作：anime_to_real=二次元转真人, upscale=精修放大, real_to_anime=真人转二次元',
            },
            prompt: {
              type: 'string',
              description: '补充提示词（可选）。二次元转真人和真人转二次元可用，精修放大不需要。',
            },
          },
          required: ['action'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'text_response',
        description: '当用户的问题不涉及图片生成或修改时，使用此工具进行纯文本回复。例如：用户问"你能做什么"、"怎么使用"、闲聊等。',
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: '回复给用户的文本消息',
            },
          },
          required: ['message'],
        },
      },
    },
  ];
}

// ── 系统提示词构建 ───────────────────────────────────────────────────────────

export function buildSystemPrompt(profile: UserPreferenceProfile, metadata: any): string {
  // 提取 top 模型
  const topModels = profile.modelPreferences
    .slice(0, 5)
    .map((m) => m.model.split('\\').pop()?.replace('.safetensors', '') ?? m.model)
    .join(', ') || '暂无数据';

  // 提取风格特征
  const styleFeatures = profile.styleFeatures
    .slice(0, 10)
    .map((s) => s.tag)
    .join(', ') || '暂无数据';

  // 提取参数偏好
  const pp = profile.paramPreferences;
  const paramPreferences = pp.preferredSize.width
    ? `${pp.preferredSize.width}x${pp.preferredSize.height}, ${pp.preferredSteps} steps, CFG ${pp.preferredCfg}`
    : '暂无数据';

  // 常用 LoRA 组合
  let comboSection = '';
  if (profile.frequentCombinations && profile.frequentCombinations.length > 0) {
    comboSection += `\n常用LoRA组合（按使用频率排序）：\n`;
    profile.frequentCombinations.slice(0, 5).forEach((combo, i) => {
      const loraNames = combo.loras?.map(l => {
        const meta = metadata[l];
        const m = meta && typeof meta === 'object' ? meta as Record<string, any> : null;
        return m?.nickname || l.split('\\').pop()?.replace('.safetensors', '') || l;
      }).join(' + ') || '无';
      comboSection += `${i + 1}. ${loraNames}（使用 ${combo.count} 次）\n`;
    });
  }

  // 按分类的 LoRA 偏好
  let loraPrefSection = '';
  if (profile.loraPreferences && profile.loraPreferences.length > 0) {
    const grouped: Record<string, Array<{ model: string; nickname: string }>> = {};
    profile.loraPreferences.forEach(lp => {
      const meta = metadata[lp.model];
      const m = meta && typeof meta === 'object' ? meta as Record<string, any> : null;
      const cat = m?.category || '其他';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ model: lp.model, nickname: m?.nickname || lp.model });
    });

    loraPrefSection += `\n用户LoRA偏好（按分类）：\n`;
    for (const [cat, loras] of Object.entries(grouped)) {
      const top3 = loras.slice(0, 3).map(l => l.nickname).join(', ');
      loraPrefSection += `- ${cat}: ${top3}\n`;
    }
  }

  // 构建可用 checkpoint 模型列表
  const checkpointEntries: string[] = [];
  for (const [filePath, meta] of Object.entries(metadata)) {
    if (!meta || typeof meta !== 'object') continue;
    const m = meta as Record<string, any>;
    if (m.category !== '光辉' && m.category !== 'PONY') continue;
    const nickname = m.nickname || filePath;
    checkpointEntries.push(`- ${nickname}（文件名: ${filePath}）`);
  }
  const checkpointList = checkpointEntries.length > 0
    ? checkpointEntries.join('\n')
    : '暂无可用模型';

  // 构建 LoRA 列表（只列出有 nickname 的，限制 50 个）
  const loraEntries: string[] = [];
  for (const [filePath, meta] of Object.entries(metadata)) {
    if (!meta || typeof meta !== 'object') continue;
    const m = meta as Record<string, any>;
    if (!m.nickname) continue;
    // 只要 LoRA（路径中包含 Lora 或有 triggerWords/keywords）
    const isLora = filePath.toLowerCase().includes('lora') ||
      m.triggerWords || m.keywords || m.category;
    // 排除 checkpoint 模型（category 为 "光辉" 的是 checkpoint）
    const isCheckpoint = m.category === '光辉';
    if (isCheckpoint) continue;
    const parts = [m.nickname];
    if (m.triggerWords) parts.push(`触发词: ${m.triggerWords}`);
    if (m.category) parts.push(`分类: ${m.category}`);
    loraEntries.push(`- ${parts.join(' | ')}`);
    if (loraEntries.length >= 50) break;
  }
  const loraList = loraEntries.length > 0
    ? loraEntries.join('\n')
    : '暂无可用 LoRA';

  return `## 工具选择指南
你有三个工具，每次必须选择一个调用：
- **generate_image**：用户要求生成、创建、修改、调整图片时调用
- **process_image**：用户要求对已有图片进行放大、精修、风格转换等处理时调用（用户必须已上传图片）
- **text_response**：用户询问功能、闲聊、提问、打招呼等非生成场景时调用

⚠️ 判断规则：如果用户的消息不涉及生成或处理图片，必须使用 text_response 工具回复，不要调用 generate_image。

## 图片处理
当用户上传了图片并要求处理时，使用 process_image 工具：
- "转成真人"/"二次元转真人" → action: anime_to_real
- "放大"/"精修"/"高清化" → action: upscale
- "转成二次元"/"转成动漫风" → action: real_to_anime
- 用户未上传图片时不要调用 process_image，提示用户先上传图片

## 重要约束
你是 CorineKit Pix2Real 的 AI 图像生成助手。用户会用自然语言描述想要生成的图片，你需要理解意图并调用对应的工具。
对于与图片生成无关的问题（如闲聊、知识问答等），使用 text_response 工具简短礼貌地回复，引导用户使用图片生成功能。

## 用户偏好画像
- 常用模型: ${topModels}
- 偏好风格: ${styleFeatures}
- 常用参数: ${paramPreferences}
${comboSection}${loraPrefSection}

## 可用工作流
- generate_image: 文生图，从文字描述生成图片
- process_image: 图片处理（放大、精修、转换等）

## 可用基础模型（checkpoint）
用户要求切换模型时，在 generate_image 的 model 参数中传入对应的昵称或文件名。
${checkpointList}

## 可用的 LoRA 模型
${loraList}

## 注意事项
1. 根据用户描述选择合适的工作流和参数
2. 如果用户提到角色名，在可用 LoRA 中寻找匹配的角色 LoRA
3. 如果用户提到特定姿势、表情，寻找匹配的 LoRA
4. 自动补全合理的提示词（英文 prompt）
5. 质量要求默认为高质量，除非用户明确说要快速出图
6. 回复用中文，但 prompt 参数用英文

# 重要：参数填写规范
- 如果用户提到角色名（如 "菲谢尔"、"安琪拉"、"胡桃" 等），**必须**在 character 参数中填写中文角色名
- 如果用户提到姿势（如 "壁尻"、"站立"），**必须**在 pose 参数中填写
- 如果用户提到风格（如 "赛博朋克"、"写实"），**必须**在 style 参数中填写
- 这些参数用于自动匹配 LoRA 模型，非常重要，不要遗漏

# 多轮编辑能力

⚠️ 核心规则：任何涉及生成或修改图片的请求，你都**必须调用 generate_image 工具**，绝对不能只用文字描述修改方案。
- 错误做法：回复"好的，我会把提示词改为xxx"或"修改后的参数如下：…"
- 正确做法：直接调用 generate_image 工具，将修改后的完整提示词作为参数传入，不要在回复中复述参数

当对话历史中包含之前的生成记录（assistant 消息中提到了使用的提示词、参数等）时：
- 如果用户要求修改之前的生成（如"把头发换银色"、"换个姿势"、"加上猫耳"、"背景换成海边"），你应该：
  1. 基于上次使用的提示词进行修改（添加/替换/删除关键词）
  2. 保留上次的角色、风格、LoRA 等设定（除非用户明确要求更改）
  3. **立即调用 generate_image 工具**，传入修改后的完整提示词和参数，不要只用文字回复
- 如果用户的请求与之前生成无关（如"画一张新的xxx"、"换一个完全不同的"），则当作全新请求处理
- 对于模糊的修改请求（如"再来一张"），保持上次的所有设定，只更换随机种子（即直接用相同参数再次调用）

再次强调：收到任何修改/重新生成的请求时，你的回复中**必须包含 generate_image 工具调用**，仅文字回复是不允许的。`;
}
