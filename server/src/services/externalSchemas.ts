// server/src/services/externalSchemas.ts
// 对外 API（/api/v1）工作流参数契约：描述每个工作流 ID（0-10）所需的输入文件与参数。
// 供路由层做参数校验、供 GET /api/v1/workflows 返回给外部调用方查阅。

export interface WorkflowParameterSchema {
  type: string;
  required: boolean;
  description: string;
}

export interface WorkflowSchema {
  description: string;
  inputFiles: string[];
  parameters: Record<string, WorkflowParameterSchema>;
}

export const WORKFLOW_SCHEMAS: Record<number, WorkflowSchema> = {
  0: {
    description: '二次元转真人：将动漫/二次元图片转换为写实真人风格。',
    inputFiles: ['image'],
    parameters: {
      prompt: { type: 'string', required: false, description: '正向提示词，补充或引导生成风格。' },
      model: { type: 'string', required: false, description: '生成模型，可选 qwen 或 klein，默认由后端决定。' },
    },
  },
  1: {
    description: '真人精修：对真人图片进行细节增强与画质精修。',
    inputFiles: ['image'],
    parameters: {
      prompt: { type: 'string', required: false, description: '正向提示词，补充精修方向。' },
    },
  },
  2: {
    description: '精修放大：对图片进行高清放大与细节修复。',
    inputFiles: ['image'],
    parameters: {
      model: { type: 'string', required: false, description: '放大模型，可选 seedvr2 / klein / kleinpro / sd / remacri。' },
    },
  },
  3: {
    description: '图生视频：以静态图片为首帧生成一段视频。',
    inputFiles: ['image'],
    parameters: {
      prompt: { type: 'string', required: false, description: '正向提示词，描述视频内容/动作。' },
      seconds: { type: 'number', required: false, description: '视频时长（秒）。' },
      fps: { type: 'number', required: false, description: '输出帧率。' },
      megapixels: { type: 'number', required: false, description: '生成分辨率（百万像素）。' },
    },
  },
  4: {
    description: '视频补帧：对已有视频做插帧提高帧率/流畅度。',
    inputFiles: ['video'],
    parameters: {
      multiplier: { type: 'number', required: false, description: '补帧倍率（如 2 表示帧数翻倍）。' },
      sourceFps: { type: 'number', required: false, description: '源视频帧率，用于计算目标帧率。' },
    },
  },
  5: {
    description: '解除装备/区域编辑：基于蒙版对图片指定区域进行重绘。',
    inputFiles: ['image', 'mask'],
    parameters: {
      prompt: { type: 'string', required: false, description: '正向提示词，描述蒙版区域的目标内容。' },
      backPose: { type: 'boolean', required: false, description: '是否切换为背面姿态。' },
    },
  },
  6: {
    description: '真人转二次元：将真人图片转换为二次元/动漫风格。',
    inputFiles: ['image'],
    parameters: {
      prompt: { type: 'string', required: false, description: '正向提示词，补充或引导二次元风格。' },
    },
  },
  7: {
    description: '快速出图：纯文生图，无需上传文件，直接以 JSON 参数生成图片。',
    inputFiles: [],
    parameters: {
      model: { type: 'string', required: true, description: '主模型（checkpoint）名称。' },
      prompt: { type: 'string', required: true, description: '正向提示词。' },
      width: { type: 'number', required: true, description: '图片宽度（像素）。' },
      height: { type: 'number', required: true, description: '图片高度（像素）。' },
      steps: { type: 'number', required: true, description: '采样步数。' },
      cfg: { type: 'number', required: true, description: 'CFG 提示词引导强度。' },
      sampler: { type: 'string', required: true, description: '采样器名称（如 dpmpp_2m）。' },
      scheduler: { type: 'string', required: true, description: '调度器名称（如 karras）。' },
      loras: { type: 'array', required: false, description: 'LoRA 列表，每项含名称与权重。' },
      negativePrompt: { type: 'string', required: false, description: '负向提示词。' },
      seed: { type: 'number', required: false, description: '随机种子，用于结果复现。' },
    },
  },
  8: {
    description: '换脸：把 faceImage 的人脸融合到 targetImage 上。',
    inputFiles: ['targetImage', 'faceImage'],
    parameters: {},
  },
  9: {
    description: 'ZIT 快出：纯文生图（ZIT/UNet 模型），无需上传文件，直接以 JSON 参数生成图片。',
    inputFiles: [],
    parameters: {
      unetModel: { type: 'string', required: true, description: 'UNet 模型名称。' },
      prompt: { type: 'string', required: true, description: '正向提示词。' },
      width: { type: 'number', required: true, description: '图片宽度（像素）。' },
      height: { type: 'number', required: true, description: '图片高度（像素）。' },
      steps: { type: 'number', required: true, description: '采样步数。' },
      cfg: { type: 'number', required: true, description: 'CFG 提示词引导强度。' },
      sampler: { type: 'string', required: true, description: '采样器名称。' },
      scheduler: { type: 'string', required: true, description: '调度器名称。' },
      loras: { type: 'array', required: false, description: 'LoRA 列表，每项含名称与权重。' },
      shift: { type: 'number', required: false, description: '采样 shift 偏移参数。' },
    },
  },
  10: {
    description: '区域编辑（新）：基于蒙版对图片指定区域进行重绘（新版工作流）。',
    inputFiles: ['image', 'mask'],
    parameters: {
      prompt: { type: 'string', required: false, description: '正向提示词，描述蒙版区域的目标内容。' },
      backPose: { type: 'boolean', required: false, description: '是否切换为背面姿态。' },
    },
  },
};
