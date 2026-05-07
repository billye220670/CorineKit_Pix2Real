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
  /** User-assigned display label (overrides originalName for UI display and asset naming). */
  label?: string;
  /** Actual filename on disk under input/, if renamed. Defaults to `${id}${ext}` when absent. */
  inputFilename?: string;
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

// ── Card asset rename ──────────────────────────────────────────────────────

export interface RenamedCardResult {
  label: string;
  inputFilename?: string;
  inputUrl?: string;
  outputs: Array<{ filename: string; url: string }>;
}

/**
 * Sanitize a user-provided label so it's safe as a filename prefix on all OSes.
 * Invalid chars (\/:*?"<>|) are replaced with "_"; leading/trailing whitespace and dots stripped.
 */
function sanitizeLabel(input: string): string {
  let s = input.replace(/[\\/:*?"<>|]/g, '_').trim();
  // Strip trailing dots/spaces (Windows doesn't allow them)
  s = s.replace(/[. ]+$/g, '');
  return s;
}

/**
 * Rename a card's on-disk assets under sessions/{sessionId}/tab-{tab}/.
 * - Input file is renamed to `{label}_raw{ext}`
 * - Output files (if any) are renamed to `{label}_{1..N}{ext}` preserving order
 * Updates session.json accordingly and returns the new URLs/filenames.
 *
 * Throws if a target path collides with an unrelated existing file.
 */
export function renameCardAssets(
  sessionId: string,
  tabId: number,
  imageId: string,
  newLabel: string,
): RenamedCardResult {
  const safeLabel = sanitizeLabel(newLabel);
  if (!safeLabel) throw new Error('Invalid label');

  const stateFile = path.join(sessionsBase, sessionId, 'session.json');
  if (!fs.existsSync(stateFile)) throw new Error('Session not found');

  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as SessionState;
  const td = state.tabData[tabId];
  if (!td) throw new Error(`Tab ${tabId} not found in session`);

  const imgIdx = td.images.findIndex((i) => i.id === imageId);
  const img = imgIdx >= 0 ? td.images[imgIdx] : undefined;

  const inputDir = path.join(sessionsBase, sessionId, `tab-${tabId}`, 'input');
  const outputDir = path.join(sessionsBase, sessionId, `tab-${tabId}`, 'output');

  // ── Rename input file ────────────────────────────────────────────────
  let newInputFilename: string | undefined;
  let newInputUrl: string | undefined;
  if (img) {
    const oldInputName = img.inputFilename ?? `${img.id}${img.ext}`;
    const oldInputPath = path.join(inputDir, oldInputName);
    const targetInputName = `${safeLabel}_raw${img.ext}`;
    const targetInputPath = path.join(inputDir, targetInputName);

    if (oldInputPath !== targetInputPath) {
      // Collision check: target exists and isn't our own old file
      if (fs.existsSync(targetInputPath)) {
        throw new Error(`文件名冲突：${targetInputName} 已存在`);
      }
      if (fs.existsSync(oldInputPath)) {
        fs.renameSync(oldInputPath, targetInputPath);
      }
    }
    newInputFilename = targetInputName;
    newInputUrl = `/api/session-files/${sessionId}/tab-${tabId}/input/${targetInputName}`;
  }

  // ── Rename output files ──────────────────────────────────────────────
  const task = td.tasks[imageId];
  const newOutputs: Array<{ filename: string; url: string }> = [];
  if (task?.outputs?.length) {
    // Pre-check all collisions first (before doing any renames)
    const plannedRenames: Array<{ oldPath: string; newPath: string; newName: string }> = [];
    for (let i = 0; i < task.outputs.length; i++) {
      const out = task.outputs[i];
      const outExt = path.extname(out.filename) || '.png';
      const newName = `${safeLabel}_${i + 1}${outExt}`;
      const oldPath = path.join(outputDir, out.filename);
      const newPath = path.join(outputDir, newName);
      plannedRenames.push({ oldPath, newPath, newName });
    }
    // Collision check across all outputs
    for (const plan of plannedRenames) {
      if (plan.oldPath === plan.newPath) continue;
      if (fs.existsSync(plan.newPath)) {
        throw new Error(`文件名冲突：${path.basename(plan.newPath)} 已存在`);
      }
    }
    // Perform renames
    for (const plan of plannedRenames) {
      if (plan.oldPath !== plan.newPath && fs.existsSync(plan.oldPath)) {
        fs.renameSync(plan.oldPath, plan.newPath);
      }
      newOutputs.push({
        filename: plan.newName,
        url: `/api/session-files/${sessionId}/tab-${tabId}/output/${encodeURIComponent(plan.newName)}`,
      });
    }
  }

  // ── Persist changes in session.json ──────────────────────────────────
  if (img) {
    img.label = safeLabel;
    if (newInputFilename) img.inputFilename = newInputFilename;
    td.images[imgIdx] = img;
  }
  if (task && newOutputs.length) {
    task.outputs = newOutputs;
    td.tasks[imageId] = task;
  }
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');

  return {
    label: safeLabel,
    inputFilename: newInputFilename,
    inputUrl: newInputUrl,
    outputs: newOutputs,
  };
}
