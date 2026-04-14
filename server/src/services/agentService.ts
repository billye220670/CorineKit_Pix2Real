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
