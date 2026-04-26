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
    fs.mkdirSync(path.join(sessionsBase, sessionId, `tab-${tab}`, 'output'), { recursive: true });
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
  const dir = path.join(sessionsBase, sessionId, `tab-${tabId}`, 'input');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${imageId}${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/api/session-files/${sessionId}/tab-${tabId}/input/${filename}`;
}

export function saveOutputFile(
  sessionId: string,
  tabId: number,
  filename: string,
  buffer: Buffer,
): string {
  const dir = path.join(sessionsBase, sessionId, `tab-${tabId}`, 'output');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/api/session-files/${sessionId}/tab-${tabId}/output/${encodeURIComponent(filename)}`;
}

export function saveMask(
  sessionId: string,
  tabId: number,
  maskKey: string,
  buffer: Buffer,
): void {
  const dir = path.join(sessionsBase, sessionId, `tab-${tabId}`, 'masks');
  fs.mkdirSync(dir, { recursive: true });
  // maskKey may contain ":" which is invalid in file names on Windows — replace with "_"
  const safeName = maskKey.replace(/:/g, '_') + '.png';
  fs.writeFileSync(path.join(dir, safeName), buffer);
}

// ── Session State JSON ─────────────────────────────────────────────────────

export interface SessionState {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  activeTab: number;
  tabData: Record<number, SerializedTabData>;
  manualCover?: boolean;
  coverExt?: string;
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
  manualCover?: boolean;
  coverExt?: string;
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
      metas.push({ sessionId: s.sessionId, createdAt: s.createdAt, updatedAt: s.updatedAt, manualCover: s.manualCover, coverExt: s.coverExt });
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

/**
 * Copy an image from a session-relative URL path to sessions/{sessionId}/cover{ext}.
 * Marks manualCover = true in session.json so auto-cover is disabled.
 */
export function saveCover(sessionId: string, sourceUrl: string): { coverUrl: string } {
  // sourceUrl like /api/session-files/{sessionId}/tab-0/output/xxx.png
  // or /api/session-files/{sessionId}/tab-0/input/xxx.jpg
  const prefix = `/api/session-files/`;
  if (!sourceUrl.startsWith(prefix)) {
    throw new Error('Invalid source URL for cover');
  }
  const relativePath = decodeURIComponent(sourceUrl.slice(prefix.length));
  const srcFile = path.join(sessionsBase, relativePath);
  if (!fs.existsSync(srcFile)) {
    throw new Error('Source file not found');
  }
  const ext = path.extname(srcFile).toLowerCase() || '.png';
  const coverFile = path.join(sessionsBase, sessionId, `cover${ext}`);

  // Remove any existing cover files with different extensions
  const sessionDir = path.join(sessionsBase, sessionId);
  if (fs.existsSync(sessionDir)) {
    for (const f of fs.readdirSync(sessionDir)) {
      if (f.startsWith('cover.')) {
        fs.unlinkSync(path.join(sessionDir, f));
      }
    }
  }

  fs.copyFileSync(srcFile, coverFile);

  // Update session.json to mark manualCover
  const stateFile = path.join(sessionsBase, sessionId, 'session.json');
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as SessionState;
      state.manualCover = true;
      state.coverExt = ext;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  return { coverUrl: `/api/session-files/${sessionId}/cover${ext}` };
}

export function pruneOldSessions(keep = 5): void {
  const all = listSessions();
  const toDelete = all.slice(keep);
  for (const s of toDelete) {
    deleteSession(s.sessionId);
  }
}
