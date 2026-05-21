/**
 * ZIT 用户画像凝练服务
 *
 * 背景：tab9（ZIT 快出）使用中文自然语言提示词，传统词频统计（styleFeatures）
 * 几乎无效。本服务周期性把生成历史调 LLM 凝练成一段中文段落，作为 ZIT 主对话/
 * 骰子 system prompt 的画像段。
 *
 * 数据结构（双段）：
 *   1. summary：长期稳定基底（LLM 凝练）
 *   2. recentRaw：自上次凝练以来的近期原文（FIFO 上限 10 条），喂给 LLM 时作为
 *      新近趋势补充
 *
 * 触发条件（任一满足）：
 *   - 首次：从未生成过 summary
 *   - 时效：距上次凝练 > 7 天
 *   - 数量：自上次凝练以来新增样本 ≥ 20
 *
 * 样本筛选（防 LLM 自我循环）：
 *   - tabId === 9
 *   - source !== 'dice'  或  metadata.isFavorited === true
 */

import fs from 'fs';
import path from 'path';
import { getProjectRoot } from '../config/paths.js';
import { listSessions } from './sessionManager.js';
import { readGenerationLog } from './agentService.js';
import type { GenerationRecord } from './agentService.js';
import { renderPrompt } from './promptStore.js';
import { callLLM } from './llmService.js';

// ── 配置常量 ─────────────────────────────────────────────────────────────────

const NARRATIVE_FILE = 'zit-narrative.json';
const REFRESH_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const REFRESH_SAMPLE_THRESHOLD = 20;            // 累计 20 条新增触发
const RECENT_RAW_MAX = 10;                       // 近期原文段最多条数
const SAMPLES_FOR_LLM_MAX = 40;                  // 喂给 LLM 凝练的最大样本数
const PROMPT_TRUNCATE_LEN = 200;                 // 单条 prompt 在样本里的最大字符
const COOLDOWN_AFTER_REFRESH_MS = 5 * 60 * 1000; // 同一进程内冷却，避免高频触发

// ── 持久化数据结构 ────────────────────────────────────────────────────────────

export interface ZitNarrativeStore {
  /** LLM 凝练出的画像段（中文自然语言段落）。空字符串=尚未生成。 */
  summary: string;
  /** 上次凝练完成的时间戳（ms） */
  summaryUpdatedAt: number;
  /** 上次凝练时纳入的最新样本 timestamp（用于增量筛选） */
  summaryBasedOnTimestamp: number;
  /** 上次凝练时累计可见样本数（仅用于诊断） */
  sampleCountAtSummary: number;
}

const EMPTY_STORE: ZitNarrativeStore = {
  summary: '',
  summaryUpdatedAt: 0,
  summaryBasedOnTimestamp: 0,
  sampleCountAtSummary: 0,
};

function getNarrativePath(): string {
  return path.join(getProjectRoot(), NARRATIVE_FILE);
}

// ── 公开：读取 / 写入持久化 ───────────────────────────────────────────────────

export function getZitNarrative(): ZitNarrativeStore {
  const p = getNarrativePath();
  if (!fs.existsSync(p)) return { ...EMPTY_STORE };
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      summaryUpdatedAt: Number(parsed.summaryUpdatedAt) || 0,
      summaryBasedOnTimestamp: Number(parsed.summaryBasedOnTimestamp) || 0,
      sampleCountAtSummary: Number(parsed.sampleCountAtSummary) || 0,
    };
  } catch (err) {
    console.warn('[ZitProfileSummarizer] 读取 narrative 失败，返回空:', err);
    return { ...EMPTY_STORE };
  }
}

function writeZitNarrative(store: ZitNarrativeStore): void {
  try {
    fs.writeFileSync(getNarrativePath(), JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[ZitProfileSummarizer] 写入 narrative 失败:', err);
  }
}

// ── 样本收集 ─────────────────────────────────────────────────────────────────

interface ZitSample {
  prompt: string;
  timestamp: number;
  isFavorited: boolean;
  source: GenerationRecord['source'];
}

/**
 * 收集所有 session 中 tab9 的有效样本（去除 dice 未收藏污染源）。
 *
 * @param sinceTimestamp 仅收集 timestamp > sinceTimestamp 的样本。0 表示全量。
 */
export function collectZitSamplesSince(sinceTimestamp: number): ZitSample[] {
  const sessions = listSessions();
  const samples: ZitSample[] = [];

  for (const meta of sessions) {
    const logs = readGenerationLog(meta.sessionId);
    for (const log of logs) {
      if (log.tabId !== 9) continue;
      if (log.timestamp <= sinceTimestamp) continue;
      const isFav = !!log.metadata?.isFavorited;
      const src = log.source ?? 'manual';
      // 防污染：dice 未收藏直接跳过
      if (src === 'dice' && !isFav) continue;
      const prompt = log.config?.prompt?.trim();
      if (!prompt) continue;
      samples.push({
        prompt,
        timestamp: log.timestamp,
        isFavorited: isFav,
        source: src,
      });
    }
  }

  return samples;
}

/** 截断单条 prompt 用于喂给 LLM */
function truncatePrompt(p: string, max: number = PROMPT_TRUNCATE_LEN): string {
  if (p.length <= max) return p;
  return p.slice(0, max) + '…';
}

/** 排序：收藏优先 + 时间倒序，截取 LLM 摘要使用的样本上限 */
function sortAndLimitForLLM(samples: ZitSample[]): ZitSample[] {
  const sorted = [...samples].sort((a, b) => {
    if (a.isFavorited !== b.isFavorited) return a.isFavorited ? -1 : 1;
    return b.timestamp - a.timestamp;
  });
  return sorted.slice(0, SAMPLES_FOR_LLM_MAX);
}

/** 仅按时间倒序，用于 recentRaw 段（用户最新审美） */
function sortByTimeDescAndLimit(samples: ZitSample[], limit: number): ZitSample[] {
  return [...samples]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

// ── 双段拼装：供 buildSystemPrompt(tab9) 注入 ─────────────────────────────────

/**
 * 构造 ZIT 模式下的 profileSection 文本（替换原 styleFeatures 词频统计）。
 *
 * 双段结构：
 *   ## 用户审美画像（长期）  ← summary
 *   ## 用户近期偏好（最新若干条原文）  ← recentRaw FIFO
 *
 * 同时 fire-and-forget 触发刷新检查，不阻塞当次构造。
 */
export function buildZitProfileSection(): string {
  const store = getZitNarrative();
  const recentSamples = sortByTimeDescAndLimit(
    collectZitSamplesSince(store.summaryBasedOnTimestamp),
    RECENT_RAW_MAX,
  );

  // fire-and-forget：是否需要刷新
  void tryRefreshZitSummary();

  const lines: string[] = [];

  if (store.summary && store.summary.trim()) {
    lines.push('### 长期审美画像');
    lines.push(store.summary.trim());
  } else {
    lines.push('### 长期审美画像');
    lines.push('（暂无足够样本生成长期画像，请先观察"近期偏好"段，并保持中文自然语言风格。）');
  }

  if (recentSamples.length > 0) {
    lines.push('');
    lines.push(`### 近期偏好（最近 ${recentSamples.length} 条 prompt 原文，按时间倒序）`);
    recentSamples.forEach((s, i) => {
      const star = s.isFavorited ? '★' : '·';
      lines.push(`${i + 1}. ${star} ${truncatePrompt(s.prompt)}`);
    });
  }

  return lines.join('\n');
}

// ── 异步刷新（节流 + 并发保护） ──────────────────────────────────────────────

let refreshing = false;
let lastRefreshAttemptAt = 0;

function shouldRefresh(store: ZitNarrativeStore, newSamplesCount: number): boolean {
  // 没有任何摘要 + 至少有点样本（>=5）就值得首次凝练
  if (!store.summary && newSamplesCount >= 5) return true;
  // 时效到期
  if (store.summaryUpdatedAt > 0 && Date.now() - store.summaryUpdatedAt > REFRESH_AGE_MS && newSamplesCount > 0) {
    return true;
  }
  // 累计阈值
  if (newSamplesCount >= REFRESH_SAMPLE_THRESHOLD) return true;
  return false;
}

/**
 * 尝试异步刷新 summary。fire-and-forget，外部不需要 await。
 * - 同进程节流：5 分钟内不重复尝试
 * - 并发保护：刷新中再次调用直接返回
 */
export async function tryRefreshZitSummary(): Promise<void> {
  if (refreshing) return;
  const now = Date.now();
  if (now - lastRefreshAttemptAt < COOLDOWN_AFTER_REFRESH_MS) return;
  lastRefreshAttemptAt = now;

  const store = getZitNarrative();
  const newSamples = collectZitSamplesSince(store.summaryBasedOnTimestamp);
  if (!shouldRefresh(store, newSamples.length)) return;

  refreshing = true;
  try {
    await refreshZitSummaryNow(store, newSamples);
  } catch (err) {
    console.error('[ZitProfileSummarizer] 刷新失败:', err);
  } finally {
    refreshing = false;
  }
}

export interface ForceRefreshResult {
  ok: boolean;
  /** 失败原因；ok=true 时 undefined */
  reason?: 'busy' | 'no_samples' | 'llm_empty' | 'template_missing' | 'error';
  message?: string;
  /** 新的 summary（仅 ok=true 时返回） */
  summary?: string;
  /** 本次纳入凝练的新增样本数 */
  sampleCount?: number;
}

/**
 * 用户手动触发的强制刷新。
 * - 绕过冷却（COOLDOWN）与触发条件（shouldRefresh）
 * - 仍保留并发互斥（refreshing 标记）
 * - 仍要求有 ≥1 条新增样本，否则没有凝练对象，直接返回 no_samples
 * - await 等待 LLM 完成后返回结果，便于前端展示真实反馈
 */
export async function forceRefreshZitSummary(): Promise<ForceRefreshResult> {
  if (refreshing) {
    return { ok: false, reason: 'busy', message: '正在凝练中，请稍候再试' };
  }
  refreshing = true;
  // 占位冷却时间戳，避免 fire-and-forget 在用户手动刷新后立刻又触发一次
  lastRefreshAttemptAt = Date.now();
  try {
    const store = getZitNarrative();
    const newSamples = collectZitSamplesSince(store.summaryBasedOnTimestamp);
    if (newSamples.length === 0) {
      return { ok: false, reason: 'no_samples', message: '暂无可凝练的新样本（自上次摘要起未产生新的 ZIT 生成记录）' };
    }

    const samplesForLLM = sortAndLimitForLLM(newSamples);
    const newSamplesText = samplesForLLM
      .map((s, i) => {
        const star = s.isFavorited ? '★' : '·';
        const date = new Date(s.timestamp).toISOString().slice(0, 10);
        return `${i + 1}. [${date}] ${star} ${truncatePrompt(s.prompt)}`;
      })
      .join('\n');
    const previousSummary = store.summary?.trim() || '暂无历史摘要';

    const rendered = renderPrompt('zit-narrative-summary', {
      previousSummary,
      newSamplesText,
      newSamplesCount: String(newSamples.length),
    });
    if (!rendered) {
      return { ok: false, reason: 'template_missing', message: 'zit-narrative-summary 模板未注册' };
    }

    console.log(`[ZitProfileSummarizer] 用户强制凝练，新增样本 ${newSamples.length} 条，喂给 LLM ${samplesForLLM.length} 条`);

    const resp = await callLLM({
      messages: [
        { role: 'system', content: rendered.system },
        { role: 'user', content: rendered.user },
      ],
      temperature: 0.4,
    });

    const newSummary = (resp.content ?? '').trim();
    if (!newSummary) {
      return { ok: false, reason: 'llm_empty', message: 'LLM 返回空内容，已保留旧 summary' };
    }

    const latestTimestamp = newSamples.reduce((m, s) => Math.max(m, s.timestamp), store.summaryBasedOnTimestamp);
    writeZitNarrative({
      summary: newSummary,
      summaryUpdatedAt: Date.now(),
      summaryBasedOnTimestamp: latestTimestamp,
      sampleCountAtSummary: store.sampleCountAtSummary + newSamples.length,
    });

    console.log(`[ZitProfileSummarizer] 强制凝练完成，summary 长度 ${newSummary.length} 字`);
    return { ok: true, summary: newSummary, sampleCount: newSamples.length };
  } catch (err) {
    console.error('[ZitProfileSummarizer] 强制刷新失败:', err);
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
  } finally {
    refreshing = false;
  }
}

/**
 * 供前端展示的状态视图：当前 summary + 自上次摘要以来的新样本数。
 */
export interface ZitNarrativeStatus {
  summary: string;
  summaryUpdatedAt: number;
  summaryBasedOnTimestamp: number;
  sampleCountAtSummary: number;
  /** 自上次摘要以来新增的有效样本数（已按防污染规则过滤） */
  pendingSampleCount: number;
  /** 当前是否正在凝练 */
  isRefreshing: boolean;
}

export function getZitNarrativeStatus(): ZitNarrativeStatus {
  const store = getZitNarrative();
  const pending = collectZitSamplesSince(store.summaryBasedOnTimestamp);
  return {
    summary: store.summary,
    summaryUpdatedAt: store.summaryUpdatedAt,
    summaryBasedOnTimestamp: store.summaryBasedOnTimestamp,
    sampleCountAtSummary: store.sampleCountAtSummary,
    pendingSampleCount: pending.length,
    isRefreshing: refreshing,
  };
}

async function refreshZitSummaryNow(
  prevStore: ZitNarrativeStore,
  newSamples: ZitSample[],
): Promise<void> {
  if (newSamples.length === 0) return;

  const samplesForLLM = sortAndLimitForLLM(newSamples);
  const newSamplesText = samplesForLLM
    .map((s, i) => {
      const star = s.isFavorited ? '★' : '·';
      const date = new Date(s.timestamp).toISOString().slice(0, 10);
      return `${i + 1}. [${date}] ${star} ${truncatePrompt(s.prompt)}`;
    })
    .join('\n');

  const previousSummary = prevStore.summary?.trim() || '暂无历史摘要';

  const rendered = renderPrompt('zit-narrative-summary', {
    previousSummary,
    newSamplesText,
    newSamplesCount: String(newSamples.length),
  });

  if (!rendered) {
    console.warn('[ZitProfileSummarizer] zit-narrative-summary 模板未注册，跳过刷新');
    return;
  }

  console.log(`[ZitProfileSummarizer] 触发凝练，新增样本 ${newSamples.length} 条，喂给 LLM ${samplesForLLM.length} 条`);

  const resp = await callLLM({
    messages: [
      { role: 'system', content: rendered.system },
      { role: 'user', content: rendered.user },
    ],
    temperature: 0.4,
  });

  const newSummary = (resp.content ?? '').trim();
  if (!newSummary) {
    console.warn('[ZitProfileSummarizer] LLM 返回空内容，保留旧 summary');
    return;
  }

  const latestTimestamp = newSamples.reduce((m, s) => Math.max(m, s.timestamp), prevStore.summaryBasedOnTimestamp);

  writeZitNarrative({
    summary: newSummary,
    summaryUpdatedAt: Date.now(),
    summaryBasedOnTimestamp: latestTimestamp,
    sampleCountAtSummary: prevStore.sampleCountAtSummary + newSamples.length,
  });

  console.log(`[ZitProfileSummarizer] 凝练完成，summary 长度 ${newSummary.length} 字`);
}
