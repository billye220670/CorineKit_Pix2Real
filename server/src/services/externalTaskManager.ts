// server/src/services/externalTaskManager.ts
// 对外 API（/api/v1）任务状态管理：以内存 Map 维护外部提交任务的生命周期。
// 设计要点：
//   - 主表 taskId → TaskRecord；反向索引 promptId → taskId，便于 WebSocket 回调
//     通过 ComfyUI 返回的 promptId 反查任务并更新进度/结果/错误。
//   - progress/complete/fail 均以 promptId 为入口。
//   - 定时清理已结束（completed/error）且超过 1 小时的记录，避免内存无限增长。

export type ExternalTaskStatus = 'queued' | 'processing' | 'completed' | 'error';

export interface ExternalTaskOutput {
  filename: string;
  url: string;
}

export interface ExternalTaskProgress {
  percentage: number;
  stage?: string;
}

export interface TaskRecord {
  taskId: string;
  promptId: string;
  workflowId: number;
  clientId: string;
  /** 任务所属的已验证 API Key，用于防止其他合法 key 越权查询/下载/取消。 */
  ownerApiKey: string;
  status: ExternalTaskStatus;
  progress: ExternalTaskProgress;
  outputs: ExternalTaskOutput[] | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

// 主表与反向索引
const tasks = new Map<string, TaskRecord>();
const promptIdToTaskId = new Map<string, string>();

/**
 * 生成唯一 taskId：ext_<时间戳>_<随机串>。
 */
function generateTaskId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `ext_${Date.now()}_${rand}`;
}

/**
 * 创建任务记录：写入主表与反向索引，返回 taskId。
 * 初始状态为 queued，进度 0。
 */
export function createTask(promptId: string, workflowId: number, clientId: string, ownerApiKey: string): string {
  const taskId = generateTaskId();
  const record: TaskRecord = {
    taskId,
    promptId,
    workflowId,
    clientId,
    ownerApiKey,
    status: 'queued',
    progress: { percentage: 0 },
    outputs: null,
    error: null,
    createdAt: new Date(),
    completedAt: null,
  };
  tasks.set(taskId, record);
  promptIdToTaskId.set(promptId, taskId);
  return taskId;
}

/**
 * 按 taskId 查询任务，不存在返回 undefined。
 */
export function getTask(taskId: string): TaskRecord | undefined {
  return tasks.get(taskId);
}

/**
 * 按 promptId 反查任务，不存在返回 undefined。
 */
export function getTaskByPromptId(promptId: string): TaskRecord | undefined {
  const taskId = promptIdToTaskId.get(promptId);
  if (!taskId) return undefined;
  return tasks.get(taskId);
}

/**
 * 更新进度（以 promptId 为入口）。会把状态置为 processing。
 * 找不到对应任务时静默忽略。
 */
export function updateProgress(promptId: string, percentage: number, stage?: string): void {
  const record = getTaskByPromptId(promptId);
  if (!record) return;
  record.status = 'processing';
  record.progress = { percentage, ...(stage !== undefined ? { stage } : {}) };
}

/**
 * 标记任务完成（以 promptId 为入口），写入产物并置进度 100。
 * 找不到对应任务时静默忽略。
 */
export function complete(promptId: string, outputs: ExternalTaskOutput[]): void {
  const record = getTaskByPromptId(promptId);
  if (!record) return;
  record.status = 'completed';
  record.outputs = outputs;
  record.progress = { percentage: 100, ...(record.progress.stage ? { stage: record.progress.stage } : {}) };
  record.completedAt = new Date();
}

/**
 * 标记任务失败（以 promptId 为入口），写入错误信息。
 * 找不到对应任务时静默忽略。
 */
export function fail(promptId: string, error: string): void {
  const record = getTaskByPromptId(promptId);
  if (!record) return;
  record.status = 'error';
  record.error = error;
  record.completedAt = new Date();
}

// ── 定时清理 ──────────────────────────────────────────────────────────────
// 每 10 分钟清理一次：status 为 completed/error 且 completedAt 距今超过 1 小时的记录，
// 同时移除反向索引。unref() 确保该定时器不会阻止 Node 进程退出。

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟
const RETENTION_MS = 60 * 60 * 1000; // 1 小时

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [taskId, record] of tasks) {
    if (
      (record.status === 'completed' || record.status === 'error') &&
      record.completedAt !== null &&
      now - record.completedAt.getTime() > RETENTION_MS
    ) {
      tasks.delete(taskId);
      promptIdToTaskId.delete(record.promptId);
    }
  }
}, CLEANUP_INTERVAL_MS);

cleanupTimer.unref();
