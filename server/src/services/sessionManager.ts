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

  // Refuse renaming while a task is in-flight: rename vs. WebSocket 'complete' writes
  // would race on the output/ folder and leave task.outputs with mixed naming schemes.
  const taskCheck = td.tasks[imageId];
  if (taskCheck && !['idle', 'done', 'error'].includes(String(taskCheck.status))) {
    throw new Error('任务正在执行中，请等待完成后再重命名');
  }

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

// ── Batch card asset rename (transactional) ───────────────────────────────

export interface BatchRenameItem {
  imageId: string;
  label: string;
}

export interface BatchRenamedCardResult {
  imageId: string;
  result: RenamedCardResult;
}

/**
 * Batch version of renameCardAssets with all-or-nothing semantics.
 * - Pre-validates all items (label sanity, task status, filename collisions — both
 *   against existing files and within the batch itself)
 * - Only after all pre-checks pass does it perform fs.renameSync and persist session.json
 * - Throws on any issue, leaving the filesystem untouched
 */
export function renameCardAssetsBatch(
  sessionId: string,
  tabId: number,
  items: BatchRenameItem[],
): BatchRenamedCardResult[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const stateFile = path.join(sessionsBase, sessionId, 'session.json');
  if (!fs.existsSync(stateFile)) throw new Error('Session not found');

  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as SessionState;
  const td = state.tabData[tabId];
  if (!td) throw new Error(`Tab ${tabId} not found in session`);

  const inputDir = path.join(sessionsBase, sessionId, `tab-${tabId}`, 'input');
  const outputDir = path.join(sessionsBase, sessionId, `tab-${tabId}`, 'output');

  // ── Phase 1: Plan all renames, detecting every possible conflict ───────
  interface Plan {
    imageId: string;
    safeLabel: string;
    imgIdx: number;
    // input rename (may be undefined if image not found, though we require it)
    inputOld?: string;
    inputNew?: string;
    inputOldPath?: string;
    inputNewPath?: string;
    // output renames
    outputPlans: Array<{ oldPath: string; newPath: string; newName: string }>;
  }

  const plans: Plan[] = [];
  // Track in-batch target paths to detect collisions between items (e.g. two
  // cards both targeting "same_raw.png") — would otherwise overwrite each other.
  const batchTargetPaths = new Set<string>();
  const batchSourcePaths = new Set<string>(); // paths that will be renamed away

  for (const item of items) {
    const safeLabel = sanitizeLabel(item.label);
    if (!safeLabel) throw new Error(`Invalid label for image ${item.imageId}`);

    const imgIdx = td.images.findIndex((i) => i.id === item.imageId);
    if (imgIdx < 0) throw new Error(`Image ${item.imageId} not found in tab ${tabId}`);
    const img = td.images[imgIdx];

    const task = td.tasks[item.imageId];
    if (task && !['idle', 'done', 'error'].includes(String(task.status))) {
      throw new Error(`任务正在执行中，无法重命名（imageId=${item.imageId}）`);
    }

    const plan: Plan = { imageId: item.imageId, safeLabel, imgIdx, outputPlans: [] };

    // Plan input rename
    const oldInputName = img.inputFilename ?? `${img.id}${img.ext}`;
    const targetInputName = `${safeLabel}_raw${img.ext}`;
    plan.inputOld = oldInputName;
    plan.inputNew = targetInputName;
    plan.inputOldPath = path.join(inputDir, oldInputName);
    plan.inputNewPath = path.join(inputDir, targetInputName);
    batchSourcePaths.add(plan.inputOldPath);

    // Plan output renames
    if (task?.outputs?.length) {
      for (let i = 0; i < task.outputs.length; i++) {
        const out = task.outputs[i];
        const outExt = path.extname(out.filename) || '.png';
        const newName = `${safeLabel}_${i + 1}${outExt}`;
        const oldPath = path.join(outputDir, out.filename);
        const newPath = path.join(outputDir, newName);
        plan.outputPlans.push({ oldPath, newPath, newName });
        batchSourcePaths.add(oldPath);
      }
    }

    plans.push(plan);
  }

  // Collision checks: (a) within batch, (b) against existing unrelated files
  const checkCollision = (newPath: string, label: string) => {
    if (batchTargetPaths.has(newPath)) {
      throw new Error(`批内文件名冲突：${path.basename(newPath)}（${label}）`);
    }
    batchTargetPaths.add(newPath);
    // Against existing files: only a problem if the file exists AND is not one of the
    // sources being renamed away in this same batch (swaps are allowed in principle,
    // though a two-step rename would be required — currently we just reject).
    if (fs.existsSync(newPath) && !batchSourcePaths.has(newPath)) {
      throw new Error(`文件名冲突：${path.basename(newPath)} 已存在`);
    }
  };

  for (const plan of plans) {
    if (plan.inputOldPath && plan.inputNewPath && plan.inputOldPath !== plan.inputNewPath) {
      checkCollision(plan.inputNewPath, plan.safeLabel);
    }
    for (const op of plan.outputPlans) {
      if (op.oldPath !== op.newPath) {
        checkCollision(op.newPath, plan.safeLabel);
      }
    }
  }

  // ── Phase 2: Execute all renames (still throw on unexpected fs errors) ──
  // Because we validated collisions up-front, fs.renameSync failures here
  // would be truly exceptional (e.g. EPERM/EBUSY) and are surfaced as-is.
  const results: BatchRenamedCardResult[] = [];

  for (const plan of plans) {
    const img = td.images[plan.imgIdx];
    let newInputFilename: string | undefined;
    let newInputUrl: string | undefined;

    if (plan.inputOldPath && plan.inputNewPath && plan.inputOldPath !== plan.inputNewPath) {
      if (fs.existsSync(plan.inputOldPath)) {
        fs.renameSync(plan.inputOldPath, plan.inputNewPath);
      }
    }
    newInputFilename = plan.inputNew;
    newInputUrl = `/api/session-files/${sessionId}/tab-${tabId}/input/${plan.inputNew}`;

    const newOutputs: Array<{ filename: string; url: string }> = [];
    for (const op of plan.outputPlans) {
      if (op.oldPath !== op.newPath && fs.existsSync(op.oldPath)) {
        fs.renameSync(op.oldPath, op.newPath);
      }
      newOutputs.push({
        filename: op.newName,
        url: `/api/session-files/${sessionId}/tab-${tabId}/output/${encodeURIComponent(op.newName)}`,
      });
    }

    // Mutate session state in-place (persist once after the loop)
    img.label = plan.safeLabel;
    if (newInputFilename) img.inputFilename = newInputFilename;
    td.images[plan.imgIdx] = img;
    const task = td.tasks[plan.imageId];
    if (task && newOutputs.length) {
      task.outputs = newOutputs;
      td.tasks[plan.imageId] = task;
    }

    results.push({
      imageId: plan.imageId,
      result: {
        label: plan.safeLabel,
        inputFilename: newInputFilename,
        inputUrl: newInputUrl,
        outputs: newOutputs,
      },
    });
  }

  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');

  return results;
}
