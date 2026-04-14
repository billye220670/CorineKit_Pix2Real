import fs from 'fs';
import path from 'path';
import { sessionsBase } from './sessionManager.js';

export interface GenerationRecord {
  id: string;
  sessionId: string;
  timestamp: number;
  workflowId: number;
  workflowName: string;
  tabId: number;
  config: {
    model: string;
    loras: Array<{model: string; enabled: boolean; strength: number}>;
    prompt: string;
    negativePrompt?: string;
    params: {
      width: number;
      height: number;
      steps: number;
      cfg: number;
      sampler: string;
      scheduler: string;
    };
    // ZIT-specific
    unetModel?: string;
    shiftEnabled?: boolean;
    shift?: number;
  };
  result: {
    imageId: string;
    outputs: Array<{filename: string; url: string}>;
  };
  metadata: {
    isFavorited: boolean;
    favoriteTime?: number;
  };
}

function getLogPath(sessionId: string): string {
  return path.join(sessionsBase, sessionId, 'generation-log.json');
}

export function readGenerationLog(sessionId: string): GenerationRecord[] {
  const logPath = getLogPath(sessionId);
  if (!fs.existsSync(logPath)) return [];
  try {
    const data = fs.readFileSync(logPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function appendGenerationLog(sessionId: string, record: GenerationRecord): void {
  const logPath = getLogPath(sessionId);
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const logs = readGenerationLog(sessionId);
  logs.push(record);
  fs.writeFileSync(logPath, JSON.stringify(logs, null, 2), 'utf-8');
}

// ── Favorites ─────────────────────────────────────────────────────────────────

function getFavoritesPath(sessionId: string): string {
  return path.join(sessionsBase, sessionId, 'favorites.json');
}

export function readFavorites(sessionId: string): Record<string, { tabId: number; favoritedAt: number }> {
  const p = getFavoritesPath(sessionId);
  if (!fs.existsSync(p)) return {};
  try {
    const data = fs.readFileSync(p, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function writeFavorite(sessionId: string, imageId: string, tabId: number, isFavorited: boolean): void {
  const p = getFavoritesPath(sessionId);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const favorites = readFavorites(sessionId);
  if (isFavorited) {
    favorites[imageId] = { tabId, favoritedAt: Date.now() };
  } else {
    delete favorites[imageId];
  }
  fs.writeFileSync(p, JSON.stringify(favorites, null, 2), 'utf-8');
}
