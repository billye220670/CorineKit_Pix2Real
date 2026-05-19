/**
 * ZIT（Tab 9）暖场建议冷启动默认提示词。
 *
 * 仅供 ZITSidebar 顶部 debug 编辑区初始化、AgentDialog 兜底使用。
 * 实际生效的内容以 localStorage 中用户编辑后的版本为准。
 */

export const ZIT_WARMUP_DEFAULT_SYSTEM = `你是 ZImage 文生图模型的提示词推荐器。ZImage 是新一代基于自然语言理解的图像生成模型，擅长根据"描述性段落"生成具有摄影感和氛围感的人像与场景图，不依赖标签堆叠（不要使用 masterpiece、best quality、1girl 这类 SD/Danbooru 风格 tag）。

只输出建议文本，不要任何解释、不要编号、不要前后缀符号。`;

export const ZIT_WARMUP_DEFAULT_USER = `用户是 ZIT 快出 Tab 的新用户，暂无历史画像数据。请生成 4 条 ZImage 风格的图像生成建议，作为暖场启发。

——ZImage 提示词风格要求——
1. 自然语言流畅描述（短段落或紧凑长句），不要逗号分隔的纯标签
2. 中文为主，可少量英文专有名词（如 cyberpunk、film grain）
3. 每条必须包含至少 3 个维度：
   主体（人物/对象） + 动作或姿态 + 场景或环境 + 光线/色调/氛围（任选其一）
4. 单条长度 20–40 字，紧凑但有画面感
5. 严禁出现：masterpiece、best quality、1girl、score_、安全词标签

——4 条建议的差异化矩阵（必须各占一类）——
A. 写实日常人像：室内/城市生活场景（咖啡馆、地铁、卧室、便利店等）
B. 氛围户外人像：自然或天气元素（黄昏海边、雨夜街道、雪地、樱花林等）
C. 风格化人物：明确画风提示（胶片质感 / 油画 / 赛博朋克 / 极简平面）
D. 纯场景或静物：无主角，强调构图、光影、空间叙事

——其他硬约束——
- 4 条之间的人物身份、场景、风格、色调不得重复
- 不要 NSFW、不要血腥暴力、不要真实公众人物姓名
- 每行一条，共 4 行`;

/** localStorage keys — 前后端契约也走这俩 key */
export const ZIT_WARMUP_SYSTEM_KEY = 'zit_warmup_debug_system';
export const ZIT_WARMUP_USER_KEY = 'zit_warmup_debug_user';

/** 冷启动静态兜底种子池（LLM 失败时使用） */
export const ZIT_COLD_FALLBACK_SUGGESTIONS = [
  '穿宽松毛衣的少女坐在窗边咖啡馆，晨光透过百叶窗洒在她翻开的书上',
  '黄昏海边礁石上回头的女孩，海风掀起白色长裙，远处灯塔刚刚亮起',
  '赛博朋克风紫发少女戴耳机走过夜市，霓虹倒映在湿润的石板路面',
  '老胶片质感的午后空教室，阳光斜射在木地板上，粉笔灰在光柱中漂浮',
];

/** 从 localStorage 读取，未设置则返回默认值 */
export function readZitWarmupPrompts(): { system: string; user: string } {
  try {
    const system = localStorage.getItem(ZIT_WARMUP_SYSTEM_KEY);
    const user = localStorage.getItem(ZIT_WARMUP_USER_KEY);
    return {
      system: system ?? ZIT_WARMUP_DEFAULT_SYSTEM,
      user: user ?? ZIT_WARMUP_DEFAULT_USER,
    };
  } catch {
    return {
      system: ZIT_WARMUP_DEFAULT_SYSTEM,
      user: ZIT_WARMUP_DEFAULT_USER,
    };
  }
}
