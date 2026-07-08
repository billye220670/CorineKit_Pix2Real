// server/src/config/externalApiConfig.ts
// 对外 API（/api/v1）配置读取：从项目根 config.json 的 externalApi 块读取开关、
// 允许的 API Key 列表与 CORS 来源，支持环境变量覆盖（优先级高于 config.json）。
// 读取方式与 config/paths.ts 保持一致：projectRoot 支持 CORINE_DATA_ROOT 覆盖。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 开发态：server/src/config/externalApiConfig.ts → 编译后 server/dist/config/externalApiConfig.js
// 相对 dist/config/ 回到项目根需要 ../../../
const defaultProjectRoot = path.resolve(__dirname, '../../..');

// Electron 打包时通过此环境变量覆盖数据根目录（与 paths.ts 一致）
const envDataRoot = process.env.CORINE_DATA_ROOT;

const projectRoot: string = envDataRoot
  ? path.resolve(envDataRoot)
  : defaultProjectRoot;

interface ExternalApiBlock {
  enabled?: boolean;
  apiKeys?: string[];
  corsOrigins?: string[];
}

interface DiskConfigWithExternal {
  externalApi?: ExternalApiBlock;
}

function getConfigFile(): string {
  return path.join(projectRoot, 'config.json');
}

/**
 * 每次读取 config.json，保证运行时修改（例如通过设置面板写入）能够即时生效。
 * 解析失败或缺失 externalApi 块时返回安全默认（enabled=false、空数组）。
 */
function readExternalApiBlock(): ExternalApiBlock {
  const file = getConfigFile();
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as DiskConfigWithExternal;
    return parsed?.externalApi ?? {};
  } catch (err) {
    console.warn('[externalApiConfig] config.json 解析失败，使用安全默认:', err);
    return {};
  }
}

/**
 * 对外 API 是否开启。
 * 仅当 config.json 中 externalApi.enabled === true 时返回 true。
 */
export function isExternalApiEnabled(): boolean {
  return readExternalApiBlock().enabled === true;
}

/**
 * 允许的 API Key 列表。
 * 合并来源：config.json externalApi.apiKeys + 环境变量 EXTERNAL_API_KEY（单个 key）。
 * 环境变量优先级更高（并入允许列表）。返回去重后的非空字符串数组。
 */
export function getExternalApiKeys(): string[] {
  const block = readExternalApiBlock();
  const keys: string[] = [];

  if (Array.isArray(block.apiKeys)) {
    for (const k of block.apiKeys) {
      if (typeof k === 'string' && k.trim()) {
        keys.push(k.trim());
      }
    }
  }

  const envKey = process.env.EXTERNAL_API_KEY;
  if (typeof envKey === 'string' && envKey.trim()) {
    keys.push(envKey.trim());
  }

  return Array.from(new Set(keys));
}

/**
 * 允许的 CORS 来源列表。
 * 合并来源：config.json externalApi.corsOrigins + 环境变量 EXTERNAL_ORIGINS（逗号分隔）。
 * 环境变量优先级更高（并入允许列表）。返回去重后的非空字符串数组。
 */
export function getExternalCorsOrigins(): string[] {
  const block = readExternalApiBlock();
  const origins: string[] = [];

  if (Array.isArray(block.corsOrigins)) {
    for (const o of block.corsOrigins) {
      if (typeof o === 'string' && o.trim()) {
        origins.push(o.trim());
      }
    }
  }

  const envOrigins = process.env.EXTERNAL_ORIGINS;
  if (typeof envOrigins === 'string' && envOrigins.trim()) {
    for (const o of envOrigins.split(',')) {
      if (o.trim()) {
        origins.push(o.trim());
      }
    }
  }

  return Array.from(new Set(origins));
}
