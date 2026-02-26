import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const sessionsBase = path.resolve(__dirname, '../../../sessions');

// ── Directory helpers ──────────────────────────────────────────────────────

export function ensureSessionDirs(sessionId: string): void {
  for (let tab = 0; tab <= 5; tab++) {
    fs.mkdirSync(path.join(sessionsBase, sessionId, `tab-${tab}`, 'input'), { recursive: true });
    fs.mkdirSync(path.join(sessionsBase, sessionId, `tab-${tab}`, 'masks'), { recursive: true });
  }
}

// ── Image / Mask I/O ───────────────────────────────────────────────────────

export function saveInputImage(
  sessionId: string,
  tabId: number,
  imageId: string,
  ext: string,
  buffer: Buffer,
): string {
  ensureSessionDirs(sessionId);
  const filename = `${imageId}${ext}`;
  const filePath = path.join(sessionsBase, sessionId, `tab-${tabId}`, 'input', filename);
  fs.writeFileSync(filePath, buffer);
  return `/api/session-files/${sessionId}/tab-${tabId}/input/${filename}`;
}

export function saveMask(
  sessionId: string,
  tabId: number,
  maskKey: string,
  buffer: Buffer,
): void {
  ensureSessionDirs(sessionId);
  // maskKey may contain ":" which is invalid in file names on Windows — replace with "_"
  const safeName = maskKey.replace(/:/g, '_') + '.png';
  const filePath = path.join(sessionsBase, sessionId, `tab-${tabId}`, 'masks', safeName);
  fs.writeFileSync(filePath, buffer);
}

// ── Session State JSON ─────────────────────────────────────────────────────

export interface SessionState {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  activeTab: number;
  tabData: Record<number, SerializedTabData>;
}

export interface SerializedTabData {
  images: SerializedImage[];
  prompts: Record<string, string>;
  tasks: Record<string, SerializedTask>;
  selectedOutputIndex: Record<string, number>;
  backPoseToggles: Record<string, boolean>;
}

export interface SerializedImage {
  id: string;
  originalName: string;
  ext: string; // e.g. ".png", ".jpg"
}

export interface SerializedTask {
  promptId: string;
  status: string;
  progress: number;
  outputs: Array<{ filename: string; url: string }>;
  error?: string;
}

export function saveState(sessionId: string, state: Omit<SessionState, 'sessionId' | 'createdAt' | 'updatedAt'>): void {
  ensureSessionDirs(sessionId);
  const stateFile = path.join(sessionsBase, sessionId, 'session.json');

  let createdAt = new Date().toISOString();
  if (fs.existsSync(stateFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as SessionState;
      createdAt = existing.createdAt;
    } catch { /* use default */ }
  }

  const full: SessionState = {
    sessionId,
    createdAt,
    updatedAt: new Date().toISOString(),
    ...state,
  };
  fs.writeFileSync(stateFile, JSON.stringify(full, null, 2), 'utf-8');
}

export function loadSession(sessionId: string): SessionState | null {
  const stateFile = path.join(sessionsBase, sessionId, 'session.json');
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as SessionState;
  } catch {
    return null;
  }
}

// ── Session Listing / Cleanup ──────────────────────────────────────────────

export interface SessionMeta {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export function listSessions(): SessionMeta[] {
  if (!fs.existsSync(sessionsBase)) return [];
  const dirs = fs.readdirSync(sessionsBase).filter((d) => {
    const p = path.join(sessionsBase, d);
    return fs.statSync(p).isDirectory();
  });

  const metas: SessionMeta[] = [];
  for (const dir of dirs) {
    const stateFile = path.join(sessionsBase, dir, 'session.json');
    if (!fs.existsSync(stateFile)) continue;
    try {
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as SessionState;
      metas.push({ sessionId: s.sessionId, createdAt: s.createdAt, updatedAt: s.updatedAt });
    } catch { /* skip corrupt sessions */ }
  }

  return metas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function deleteSession(sessionId: string): void {
  const sessionDir = path.join(sessionsBase, sessionId);
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
}

export function pruneOldSessions(keep = 5): void {
  const all = listSessions();
  const toDelete = all.slice(keep);
  for (const s of toDelete) {
    deleteSession(s.sessionId);
  }
}
