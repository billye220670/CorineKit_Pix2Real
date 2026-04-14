import { readGenerationLog, readFavorites } from './agentService.js';
import type { GenerationRecord } from './agentService.js';
import { sessionsBase } from './sessionManager.js';
import fs from 'fs';

// 用户偏好画像接口
export interface UserPreferenceProfile {
  modelPreferences: Array<{
    model: string;
    score: number;
    useCount: number;
    favoriteCount: number;
  }>;

  loraPreferences: Array<{
    model: string;
    score: number;
    useCount: number;
    favoriteCount: number;
    avgStrength: number;
  }>;

  paramPreferences: {
    preferredSize: { width: number; height: number };
    preferredSteps: number;
    preferredCfg: number;
    preferredSampler: string;
    preferredScheduler: string;
  };

  styleFeatures: Array<{
    tag: string;
    count: number;
  }>;

  usageStats: {
    totalGenerations: number;
    totalFavorites: number;
    tab7Count: number;
    tab9Count: number;
    lastActiveTime: number;
  };

  frequentCombinations: Array<{
    model: string;
    loras: string[];
    count: number;
  }>;
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

/** 统计众数（出现次数最多的值） */
function mode<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, { value: T; count: number }>();
  for (const v of values) {
    const key = String(v);
    const entry = counts.get(key);
    if (entry) {
      entry.count++;
    } else {
      counts.set(key, { value: v, count: 1 });
    }
  }
  let best: { value: T; count: number } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.value;
}



// ── 主函数 ────────────────────────────────────────────────────────────────────

export function buildUserProfile(): UserPreferenceProfile {
  // 遍历所有 session 目录，合并全量数据
  const logs: GenerationRecord[] = [];
  const favorites: Record<string, { tabId: number; favoritedAt: number }> = {};

  if (fs.existsSync(sessionsBase)) {
    const sessionDirs = fs.readdirSync(sessionsBase, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const sid of sessionDirs) {
      try {
        const sessionLogs = readGenerationLog(sid);
        logs.push(...sessionLogs);
      } catch { /* skip unreadable session */ }

      try {
        const sessionFavs = readFavorites(sid);
        Object.assign(favorites, sessionFavs);
      } catch { /* skip unreadable session */ }
    }
  }

  const favoriteImageIds = new Set(Object.keys(favorites));

  // ── 1. 模型偏好 ──
  const modelStats = new Map<string, { useCount: number; favoriteCount: number }>();
  for (const log of logs) {
    const m = log.config.model;
    if (!m) continue;
    const entry = modelStats.get(m) ?? { useCount: 0, favoriteCount: 0 };
    entry.useCount++;
    if (favoriteImageIds.has(log.result.imageId)) entry.favoriteCount++;
    modelStats.set(m, entry);
  }
  const modelPreferences = Array.from(modelStats.entries())
    .map(([model, s]) => ({
      model,
      score: s.useCount * 1 + s.favoriteCount * 3,
      useCount: s.useCount,
      favoriteCount: s.favoriteCount,
    }))
    .sort((a, b) => b.score - a.score);

  // ── 2. LoRA 偏好 ──
  const loraStats = new Map<string, { useCount: number; favoriteCount: number; totalStrength: number }>();
  for (const log of logs) {
    const loras = log.config.loras ?? [];
    const isFav = favoriteImageIds.has(log.result.imageId);
    for (const lora of loras) {
      if (!lora.enabled) continue;
      const entry = loraStats.get(lora.model) ?? { useCount: 0, favoriteCount: 0, totalStrength: 0 };
      entry.useCount++;
      entry.totalStrength += lora.strength;
      if (isFav) entry.favoriteCount++;
      loraStats.set(lora.model, entry);
    }
  }
  const loraPreferences = Array.from(loraStats.entries())
    .map(([model, s]) => ({
      model,
      score: s.useCount * 1 + s.favoriteCount * 3,
      useCount: s.useCount,
      favoriteCount: s.favoriteCount,
      avgStrength: s.useCount > 0 ? Math.round((s.totalStrength / s.useCount) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.score - a.score);

  // ── 3. 参数偏好（众数） ──
  const widths: number[] = [];
  const heights: number[] = [];
  const steps: number[] = [];
  const cfgs: number[] = [];
  const samplers: string[] = [];
  const schedulers: string[] = [];

  for (const log of logs) {
    const p = log.config.params;
    if (!p) continue;
    if (p.width) widths.push(p.width);
    if (p.height) heights.push(p.height);
    if (p.steps) steps.push(p.steps);
    if (p.cfg) cfgs.push(p.cfg);
    if (p.sampler) samplers.push(p.sampler);
    if (p.scheduler) schedulers.push(p.scheduler);
  }

  const paramPreferences = {
    preferredSize: {
      width: mode(widths) ?? 0,
      height: mode(heights) ?? 0,
    },
    preferredSteps: mode(steps) ?? 0,
    preferredCfg: mode(cfgs) ?? 0,
    preferredSampler: mode(samplers) ?? '',
    preferredScheduler: mode(schedulers) ?? '',
  };

  // ── 4. 风格特征提取（统计所有高频 tag） ──
  const tagCounts = new Map<string, number>();
  for (const log of logs) {
    const prompt = log.config.prompt ?? '';
    const parts = prompt.split(',');
    for (const raw of parts) {
      const tag = raw.trim();
      if (!tag) continue;
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const styleFeatures = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  // ── 5. 使用模式统计 ──
  let lastActiveTime = 0;
  let tab7Count = 0;
  let tab9Count = 0;
  for (const log of logs) {
    if (log.timestamp > lastActiveTime) lastActiveTime = log.timestamp;
    if (log.tabId === 7) tab7Count++;
    if (log.tabId === 9) tab9Count++;
  }

  const usageStats = {
    totalGenerations: logs.length,
    totalFavorites: favoriteImageIds.size,
    tab7Count,
    tab9Count,
    lastActiveTime,
  };

  // ── 6. 常用模型+LoRA 组合 ──
  const comboCounts = new Map<string, { model: string; loras: string[]; count: number }>();
  for (const log of logs) {
    const m = log.config.model ?? '';
    const loraModels = (log.config.loras ?? [])
      .filter(l => l.enabled)
      .map(l => l.model)
      .sort();
    const key = `${m}||${loraModels.join('|')}`;
    const entry = comboCounts.get(key);
    if (entry) {
      entry.count++;
    } else {
      comboCounts.set(key, { model: m, loras: loraModels, count: 1 });
    }
  }
  const frequentCombinations = Array.from(comboCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    modelPreferences,
    loraPreferences,
    paramPreferences,
    styleFeatures,
    usageStats,
    frequentCombinations,
  };
}
