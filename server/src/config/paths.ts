// server/src/config/paths.ts
// 集中化路径与配置管理：为运行时可切换的目录提供 getter，
// 为 Electron 打包场景预留 data root 覆盖入口。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 开发态：server/src/config/paths.ts → 编译后 server/dist/config/paths.js
// 相对 dist/config/ 回到项目根需要 ../../../
const defaultProjectRoot = path.resolve(__dirname, '../../..');

// Electron 打包时通过此环境变量覆盖数据根目录（写入 userData 路径）
const envDataRoot = process.env.CORINE_DATA_ROOT;

const projectRoot: string = envDataRoot
  ? path.resolve(envDataRoot)
  : defaultProjectRoot;

// ── config.json 持久化 ────────────────────────────────────────────────────

interface DiskConfig {
  sessionsBase?: string;
}

function getConfigFile(): string {
  return path.join(projectRoot, 'config.json');
}

let diskConfig: DiskConfig = {};
let sessionsBaseOverride: string | null = null;

export function loadConfigFromDisk(): void {
  const file = getConfigFile();
  if (!fs.existsSync(file)) {
    diskConfig = {};
    sessionsBaseOverride = null;
    return;
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as DiskConfig;
    diskConfig = parsed ?? {};
    if (typeof diskConfig.sessionsBase === 'string' && path.isAbsolute(diskConfig.sessionsBase)) {
      sessionsBaseOverride = path.resolve(diskConfig.sessionsBase);
    } else {
      sessionsBaseOverride = null;
    }
  } catch (err) {
    console.warn('[paths] config.json 解析失败，使用默认配置:', err);
    diskConfig = {};
    sessionsBaseOverride = null;
  }
}

function writeConfigToDisk(): void {
  const file = getConfigFile();
  try {
    fs.writeFileSync(file, JSON.stringify(diskConfig, null, 2), 'utf-8');
  } catch (err) {
    console.error('[paths] 写入 config.json 失败:', err);
    throw err;
  }
}

// ── sessions 路径 ─────────────────────────────────────────────────────────

export function getDefaultSessionsBase(): string {
  return path.join(projectRoot, 'sessions');
}

export function getSessionsBase(): string {
  return sessionsBaseOverride ?? getDefaultSessionsBase();
}

/**
 * 切换 sessions 根目录。
 * - 传入绝对路径：写入 config.json 覆盖默认值
 * - 传入 null：清除覆盖，还原为默认
 * 调用方保证路径合法（应由 validateSessionsBase 预先校验）。
 */
export function setSessionsBase(absOrNull: string | null): void {
  if (absOrNull === null) {
    delete diskConfig.sessionsBase;
    sessionsBaseOverride = null;
  } else {
    if (!path.isAbsolute(absOrNull)) {
      throw new Error('sessionsBase 必须是绝对路径');
    }
    const normalized = path.resolve(absOrNull);
    diskConfig.sessionsBase = normalized;
    sessionsBaseOverride = normalized;
  }
  writeConfigToDisk();
  // 确保目录存在
  const current = getSessionsBase();
  fs.mkdirSync(current, { recursive: true });
}

/**
 * 校验候选路径是否可作为 sessionsBase。
 * 返回错误消息字符串（不通过）或 null（通过）。
 */
export function validateSessionsBase(candidate: string): string | null {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return '路径不能为空';
  }
  if (!path.isAbsolute(candidate)) {
    return '必须是绝对路径';
  }
  const normalized = path.resolve(candidate);
  // 禁止嵌套在当前 sessionsBase 的子 tab 目录下（避免递归）
  const current = getSessionsBase();
  if (normalized.startsWith(current + path.sep) && normalized !== current) {
    // 允许指向同名目录，但不允许深入 tab 内部
    const rel = path.relative(current, normalized);
    if (rel.split(path.sep).some((seg) => /^tab-\d+$/.test(seg))) {
      return '不能嵌套在 session 的 tab 子目录下';
    }
  }
  // 尝试创建目录并探测写权限
  try {
    fs.mkdirSync(normalized, { recursive: true });
  } catch (err) {
    return `无法创建目录: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    const probe = path.join(normalized, `.corine_write_test_${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  } catch (err) {
    return `目录不可写: ${err instanceof Error ? err.message : String(err)}`;
  }
  return null;
}

// ── 其它数据目录（当前统一返回项目根子目录，预留 getter 便于后续扩展） ──

export function getOutputBase(): string {
  return path.join(projectRoot, 'output');
}

export function getModelMetaBase(): string {
  return path.join(projectRoot, 'model_meta');
}

export function getFavoritesBase(): string {
  return path.join(projectRoot, 'favorites');
}

export function getProjectRoot(): string {
  return projectRoot;
}
