/**
 * 元数据自动填充脚本
 * 扫描 model_meta/metadata.json，为缺失字段自动生成合理默认值
 *
 * 用法：在 server 目录下执行  npx tsx src/scripts/autoFillMetadata.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const METADATA_PATH = path.resolve(__dirname, '../../../model_meta/metadata.json');

// 已知 LoRA 分类
const LORA_CATEGORIES = new Set(['角色', '姿势', '表情', '风格', '性别', '多视角', '滑块']);
// 已知 Checkpoint 分类
const CHECKPOINT_CATEGORIES = new Set(['光辉', 'PONY']);

// ── 判断是否为 Checkpoint ──────────────────────────────────────────────────
function isCheckpoint(key: string, m: Record<string, any>): boolean {
  // 1. 有明确 category 且属于 checkpoint 分类
  if (m.category && CHECKPOINT_CATEGORIES.has(m.category)) return true;
  // 2. 有明确 category 且属于 LoRA 分类
  if (m.category && LORA_CATEGORIES.has(m.category)) return false;
  // 3. 路径含有已知 LoRA 文件夹结构
  const loraPathPrefixes = ['角色', '姿势', '表情', '风格', '性别', '多视图', '多人物', '优化', 'IllustriousLora'];
  for (const prefix of loraPathPrefixes) {
    if (key.startsWith(prefix + '\\') || key.startsWith(prefix + '/')) return false;
  }
  // 4. 路径中含 【】 标签通常是 LoRA
  if (/【.*?】/.test(key)) return false;
  // 5. 根目录无分类子目录且 nickname 含模型系列名 → checkpoint
  if (!key.includes('\\') && !key.includes('/')) {
    // 根目录文件：如果 nickname 含 "光辉-" 或 "PONY-" 前缀 → checkpoint
    const nick = m.nickname ?? '';
    if (/^(光辉|PONY)-/.test(nick)) return true;
  }
  // 6. 默认视为 LoRA
  return false;
}

// ── 从 nickname 和路径提取关键词 ─────────────────────────────────────────────
function extractKeywords(key: string, m: Record<string, any>): string[] {
  const keywords: string[] = [];

  // 从 nickname 提取
  if (m.nickname) {
    const nick = String(m.nickname);
    // 去掉括号内容作为纯名称
    const pureName = nick.replace(/\(.*?\)/g, '').replace(/（.*?）/g, '').trim();
    if (pureName) keywords.push(pureName);

    // 提取小括号内容
    const brackets = nick.match(/[（(](.*?)[）)]/g);
    if (brackets) {
      for (const b of brackets) {
        const content = b.replace(/[（()）]/g, '').trim();
        if (content && !keywords.includes(content)) keywords.push(content);
      }
    }
  }

  // 从路径提取【】标签内容
  const squareBrackets = key.match(/【(.*?)】/g);
  if (squareBrackets) {
    for (const b of squareBrackets) {
      const content = b.replace(/[【】]/g, '').trim();
      if (content && !keywords.includes(content)) keywords.push(content);
    }
  }

  // 从 triggerWords 取第一个作为英文关键词
  if (m.triggerWords) {
    const triggerStr = Array.isArray(m.triggerWords)
      ? m.triggerWords[0]
      : String(m.triggerWords).split(',')[0].trim();
    if (triggerStr && !keywords.includes(triggerStr)) keywords.push(triggerStr);
  }

  return keywords;
}

// ── 生成描述 ────────────────────────────────────────────────────────────────
function inferCategory(key: string, m: Record<string, any>): string {
  if (m.category && !CHECKPOINT_CATEGORIES.has(m.category)) return m.category;
  // 从路径中【】标签推断分类
  const categoryTag = key.match(/【(角色|姿势|表情|风格|性别|多视图|多视角|多人物|优化|滑块)】/);
  if (categoryTag) {
    const tag = categoryTag[1];
    if (tag === '多视图') return '多视角';
    if (tag === '多人物') return '滑块';
    if (tag === '优化') return '风格';
    return tag;
  }
  // 从路径第一段推断
  const firstDir = key.split(/[\\/]/)[0];
  const dirMap: Record<string, string> = {
    '角色': '角色', '姿势': '姿势', '表情': '表情', '风格': '风格',
    '性别': '性别', '多视图': '多视角', '多人物': '滑块', '优化': '风格',
    'IllustriousLora': '通用',
  };
  if (dirMap[firstDir]) return dirMap[firstDir];
  return '未分类';
}

function generateDescription(key: string, m: Record<string, any>, checkpoint: boolean): string {
  const nickname = m.nickname ?? path.basename(key, '.safetensors');

  if (checkpoint) {
    return `基础模型 - ${nickname}`;
  }

  const category = inferCategory(key, m);
  // 从路径提取系列前缀（【光辉】【PONY】【IL】）
  const seriesMatch = key.match(/【(光辉|PONY|IL)】/i);
  const series = seriesMatch ? seriesMatch[1] : '';

  if (series) {
    return `${category}LoRA - ${nickname}，${series}系列适配`;
  }
  return `${category}LoRA - ${nickname}`;
}

// ── 解析兼容模型 ─────────────────────────────────────────────────────────────
function parseCompatibleModels(key: string): string[] {
  if (key.includes('【光辉】')) return ['光辉'];
  if (key.includes('【PONY】') || key.includes('【pony】')) return ['PONY'];
  if (key.includes('【IL】') || key.includes('【il】')) return ['IL'];
  // IllustriousLora 文件夹下的默认为 IL
  if (key.startsWith('IllustriousLora\\') || key.startsWith('IllustriousLora/')) return ['IL'];
  return ['通用'];
}

// ── 默认强度 ─────────────────────────────────────────────────────────────────
function getDefaultStrength(category?: string): number {
  const map: Record<string, number> = {
    '角色': 0.8,
    '姿势': 0.7,
    '表情': 0.65,
    '风格': 0.6,
    '性别': 0.7,
    '多视角': 0.7,
    '滑块': 0.5,
  };
  return map[category ?? ''] ?? 0.7;
}

// ── 风格标签 ─────────────────────────────────────────────────────────────────
function generateStyleTags(key: string, m: Record<string, any>): string[] {
  const category = m.category ?? '';
  const nickname = m.nickname ?? '';
  const tags: string[] = [];

  switch (category) {
    case '角色':
      tags.push('character');
      // 检查是否属于特定系列
      if (nickname.includes('原神') || key.includes('原神')) tags.push('genshin');
      if (nickname.includes('碧蓝档案') || key.includes('碧蓝档案')) tags.push('blue_archive');
      if (nickname.includes('绝区零') || key.includes('绝区零')) tags.push('zenless');
      if (nickname.includes('鸣潮') || key.includes('鸣潮')) tags.push('wuthering_waves');
      if (nickname.includes('王者荣耀') || key.includes('王者荣耀')) tags.push('honor_of_kings');
      if (nickname.includes('探灵直播') || key.includes('探灵直播')) tags.push('ghost_hunter');
      if (nickname.includes('魔女的复仇之夜') || key.includes('魔女的复仇之夜')) tags.push('witch_revenge');
      if (nickname.includes('终末地') || key.includes('终末地')) tags.push('arknights_endfield');
      break;
    case '姿势':
      tags.push('pose');
      break;
    case '表情':
      tags.push('expression');
      break;
    case '风格':
      tags.push('style');
      break;
    case '性别':
      tags.push('gender');
      break;
    case '多视角':
      tags.push('multi_angle');
      break;
    case '滑块':
      tags.push('slider');
      break;
    default:
      // 无分类时从路径推断
      if (key.includes('角色')) tags.push('character');
      else if (key.includes('姿势')) tags.push('pose');
      else if (key.includes('表情')) tags.push('expression');
      else if (key.includes('风格')) tags.push('style');
      break;
  }

  return tags;
}

// ── 主逻辑 ───────────────────────────────────────────────────────────────────
function autoFill() {
  console.log(`读取: ${METADATA_PATH}`);
  const raw = fs.readFileSync(METADATA_PATH, 'utf-8');
  const metadata = JSON.parse(raw);

  const stats = { keywords: 0, description: 0, compatibleModels: 0, recommendedStrength: 0, styleTags: 0 };
  const totalEntries = Object.keys(metadata).length;

  for (const [key, entry] of Object.entries(metadata)) {
    const m = entry as Record<string, any>;
    const checkpoint = isCheckpoint(key, m);

    // 1. keywords
    if (!m.keywords || (Array.isArray(m.keywords) && m.keywords.length === 0) || m.keywords === '') {
      m.keywords = extractKeywords(key, m);
      if (m.keywords.length > 0) stats.keywords++;
    }

    // 2. description
    if (!m.description || m.description === '') {
      m.description = generateDescription(key, m, checkpoint);
      stats.description++;
    }

    // 3. compatibleModels (只对 LoRA)
    if (!checkpoint && (!m.compatibleModels || (Array.isArray(m.compatibleModels) && m.compatibleModels.length === 0))) {
      m.compatibleModels = parseCompatibleModels(key);
      stats.compatibleModels++;
    }

    // 4. recommendedStrength (只对 LoRA)
    if (!checkpoint && (m.recommendedStrength === undefined || m.recommendedStrength === null)) {
      m.recommendedStrength = getDefaultStrength(m.category);
      stats.recommendedStrength++;
    }

    // 5. styleTags
    if (!m.styleTags || (Array.isArray(m.styleTags) && m.styleTags.length === 0) || m.styleTags === '') {
      m.styleTags = generateStyleTags(key, m);
      if (m.styleTags.length > 0) stats.styleTags++;
    }
  }

  // 写回文件
  fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2), 'utf-8');

  console.log(`\n自动填充完成！共 ${totalEntries} 条记录`);
  console.log('填充统计：');
  console.log(`  keywords:           +${stats.keywords}`);
  console.log(`  description:        +${stats.description}`);
  console.log(`  compatibleModels:   +${stats.compatibleModels}`);
  console.log(`  recommendedStrength:+${stats.recommendedStrength}`);
  console.log(`  styleTags:          +${stats.styleTags}`);
}

autoFill();
