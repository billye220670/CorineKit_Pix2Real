/**
 * PromptStore — 集中管理所有 LLM 系统提示词。
 *
 * 职责：
 * 1. 启动时从 prompts/ 目录加载所有 JSON 文件到内存
 * 2. 监听文件变更，自动热重载（无需重启）
 * 3. 提供 getPrompt / getAllPrompts / renderPrompt / updatePrompt API
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, '../../../prompts');

// ── 类型定义 ─────────────────────────────────────────────────────────────────

export interface PromptDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  variables: string[];
}

// ── 内存缓存 ─────────────────────────────────────────────────────────────────

const cache = new Map<string, PromptDefinition>();
let initialized = false;

// ── 初始化与加载 ─────────────────────────────────────────────────────────────

function loadPromptFile(filePath: string): PromptDefinition | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.id || !data.name) return null;
    return {
      id: data.id,
      name: data.name ?? '',
      category: data.category ?? 'other',
      description: data.description ?? '',
      systemPrompt: data.systemPrompt ?? '',
      userPrompt: data.userPrompt ?? '',
      variables: Array.isArray(data.variables) ? data.variables : [],
    };
  } catch (err) {
    console.error(`[PromptStore] Failed to load ${filePath}:`, err);
    return null;
  }
}

function loadAll(): void {
  cache.clear();
  if (!fs.existsSync(PROMPTS_DIR)) {
    console.warn('[PromptStore] prompts/ directory not found, creating...');
    fs.mkdirSync(PROMPTS_DIR, { recursive: true });
    return;
  }
  const files = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const prompt = loadPromptFile(path.join(PROMPTS_DIR, file));
    if (prompt) {
      cache.set(prompt.id, prompt);
    }
  }
  console.log(`[PromptStore] Loaded ${cache.size} prompts from ${PROMPTS_DIR}`);
}

function startWatcher(): void {
  try {
    fs.watch(PROMPTS_DIR, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      const filePath = path.join(PROMPTS_DIR, filename);
      if (eventType === 'rename') {
        // File added or removed
        if (fs.existsSync(filePath)) {
          const prompt = loadPromptFile(filePath);
          if (prompt) {
            cache.set(prompt.id, prompt);
            console.log(`[PromptStore] Hot-reloaded (added): ${prompt.id}`);
          }
        } else {
          // File removed — find by filename and delete
          const idFromFile = filename.replace('.json', '');
          if (cache.has(idFromFile)) {
            cache.delete(idFromFile);
            console.log(`[PromptStore] Removed: ${idFromFile}`);
          }
        }
      } else if (eventType === 'change') {
        const prompt = loadPromptFile(filePath);
        if (prompt) {
          cache.set(prompt.id, prompt);
          console.log(`[PromptStore] Hot-reloaded (changed): ${prompt.id}`);
        }
      }
    });
  } catch (err) {
    console.error('[PromptStore] Failed to start watcher:', err);
  }
}

/** 确保初始化（幂等） */
export function initPromptStore(): void {
  if (initialized) return;
  initialized = true;
  loadAll();
  startWatcher();
}

// ── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 获取单个提示词定义（原始模板，未渲染）
 */
export function getPrompt(id: string): PromptDefinition | null {
  initPromptStore();
  return cache.get(id) ?? null;
}

/**
 * 获取所有提示词列表
 */
export function getAllPrompts(): PromptDefinition[] {
  initPromptStore();
  return Array.from(cache.values());
}

/**
 * 渲染提示词模板 —— 将 {{variableName}} 占位符替换为实际值
 */
export function renderPrompt(
  id: string,
  vars?: Record<string, string>,
): { system: string; user: string } | null {
  initPromptStore();
  const prompt = cache.get(id);
  if (!prompt) return null;

  let system = prompt.systemPrompt;
  let user = prompt.userPrompt;

  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      system = system.replace(pattern, value);
      user = user.replace(pattern, value);
    }
  }

  return { system, user };
}

/**
 * 更新提示词内容并写入文件
 */
export function updatePrompt(
  id: string,
  patch: { systemPrompt?: string; userPrompt?: string; name?: string; description?: string },
): boolean {
  initPromptStore();
  const existing = cache.get(id);
  if (!existing) return false;

  const updated: PromptDefinition = {
    ...existing,
    ...(patch.systemPrompt !== undefined && { systemPrompt: patch.systemPrompt }),
    ...(patch.userPrompt !== undefined && { userPrompt: patch.userPrompt }),
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.description !== undefined && { description: patch.description }),
  };

  // Write to file
  const filePath = path.join(PROMPTS_DIR, `${id}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
    cache.set(id, updated);
    return true;
  } catch (err) {
    console.error(`[PromptStore] Failed to write ${filePath}:`, err);
    return false;
  }
}

/**
 * 重置提示词为 Git 版本（从文件重新读取）
 */
export function resetPrompt(id: string): boolean {
  initPromptStore();
  const filePath = path.join(PROMPTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return false;
  const prompt = loadPromptFile(filePath);
  if (!prompt) return false;
  cache.set(id, prompt);
  return true;
}
