/**
 * Prompts API — 提供提示词的 CRUD 接口，供设置面板"开发者选项"使用。
 */

import { Router } from 'express';
import express from 'express';
import { getAllPrompts, getPrompt, updatePrompt, initPromptStore } from '../services/promptStore.js';

const router = Router();

// 确保 promptStore 已初始化
initPromptStore();

/**
 * GET /api/prompts
 * 返回所有提示词列表（不含完整内容，仅元数据）
 */
router.get('/', (_req, res) => {
  const prompts = getAllPrompts().map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    description: p.description,
    variables: p.variables,
    hasUserPrompt: !!p.userPrompt,
  }));
  // 按 category 排序
  prompts.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  res.json({ prompts });
});

/**
 * GET /api/prompts/:id
 * 返回单个提示词的完整内容
 */
router.get('/:id', (req, res) => {
  const prompt = getPrompt(req.params.id);
  if (!prompt) {
    res.status(404).json({ error: `Prompt "${req.params.id}" not found` });
    return;
  }
  res.json(prompt);
});

/**
 * PUT /api/prompts/:id
 * 更新提示词内容
 * body: { systemPrompt?: string, userPrompt?: string }
 */
router.put('/:id', express.json({ limit: '1mb' }), (req, res) => {
  const { systemPrompt, userPrompt } = req.body ?? {};

  if (systemPrompt === undefined && userPrompt === undefined) {
    res.status(400).json({ error: '至少提供 systemPrompt 或 userPrompt 之一' });
    return;
  }

  const ok = updatePrompt(req.params.id, { systemPrompt, userPrompt });
  if (!ok) {
    res.status(404).json({ error: `Prompt "${req.params.id}" not found` });
    return;
  }

  res.json({ success: true, prompt: getPrompt(req.params.id) });
});

export default router;
