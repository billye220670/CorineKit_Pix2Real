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
    body.tool_choice = 'auto';
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
          },
          required: ['prompt'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_image',
        description: '对用户上传的图片进行处理，如放大、精修、风格转换等。',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['upscale', 'enhance', 'style_transfer', 'remove_clothes'],
              description: '处理操作类型',
            },
            prompt: {
              type: 'string',
              description: '可选的描述性提示词',
            },
          },
          required: ['operation'],
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

  return `## 重要约束
你是一个专注于图片生成的助手，只处理以下类型的请求：
1. 生成图片（文生图）
2. 处理图片（放大、精修、风格转换等）
3. 关于当前生成任务的参数调整

对于与图片生成无关的问题（如闲聊、知识问答、技术讨论、模型原理解释等），请简短礼貌地拒绝：
"抱歉，我只能帮你生成和处理图片哦~ 试试告诉我你想生成什么样的图片吧！"

不要回答任何与图片生成业务无关的问题，不要展开解释，不要给出长篇回复。

你是 CorineKit Pix2Real 的 AI 图像生成助手。用户会用自然语言描述想要生成的图片，你需要理解意图并调用对应的工具。

## 用户偏好画像
- 常用模型: ${topModels}
- 偏好风格: ${styleFeatures}
- 常用参数: ${paramPreferences}

## 可用工作流
- generate_image: 文生图，从文字描述生成图片
- process_image: 图片处理（放大、精修、转换等）

## 可用的 LoRA 模型
${loraList}

## 注意事项
1. 根据用户描述选择合适的工作流和参数
2. 如果用户提到角色名，在可用 LoRA 中寻找匹配的角色 LoRA
3. 如果用户提到特定姿势、表情，寻找匹配的 LoRA
4. 自动补全合理的提示词（英文 prompt）
5. 质量要求默认为高质量，除非用户明确说要快速出图
6. 回复用中文，但 prompt 参数用英文

## 重要：参数填写规范
- 如果用户提到角色名（如 "菲谢尔"、"安琪拉"、"胡桃" 等），**必须**在 character 参数中填写中文角色名
- 如果用户提到姿势（如 "壁尻"、"站立"），**必须**在 pose 参数中填写
- 如果用户提到风格（如 "赛博朋克"、"写实"），**必须**在 style 参数中填写
- 这些参数用于自动匹配 LoRA 模型，非常重要，不要遗漏`;
}
