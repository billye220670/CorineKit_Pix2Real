export interface ImageItem {
  id: string;
  file: File;
  previewUrl: string;
  originalName: string;
  /** Persistent URL pointing to the session-stored copy of this image (set after session save/restore). */
  sessionUrl?: string;
  /** Video thumbnail (first frame) data URL, generated asynchronously for video files. */
  thumbnailUrl?: string;
  /** User-assigned display label. When set, overrides originalName for the card title. */
  label?: string;
  /** Actual filename on disk under input/, if renamed. Defaults to `${id}${ext}` when absent. */
  inputFilename?: string;
}

export interface WorkflowInfo {
  id: number;
  name: string;
  needsPrompt: boolean;
  basePrompt: string;
}

export type TaskStatus = 'idle' | 'uploading' | 'queued' | 'processing' | 'done' | 'error';

export interface TaskInfo {
  promptId: string;
  status: TaskStatus;
  progress: number;
  /** 当前阶段的中文名，如「加载主模型」「采样中」「VAE 解码」 */
  stage?: string;
  /** 当前是第几个节点（1-based） */
  stepIndex?: number;
  /** 工作流总节点数 */
  stepTotal?: number;
  outputs: Array<{ filename: string; url: string }>;
  error?: string;
}

export interface WSConnectedMessage {
  type: 'connected';
  clientId: string;
}

export interface WSProgressMessage {
  type: 'progress';
  promptId: string;
  value: number;
  max: number;
  percentage: number;
  /** 当前阶段中文名（服务端根据节点 class_type 映射） */
  stage?: string;
  /** 当前是第几个节点（1-based） */
  stepIndex?: number;
  /** 工作流总节点数 */
  stepTotal?: number;
}

export interface WSCompleteMessage {
  type: 'complete';
  promptId: string;
  outputs: Array<{ filename: string; url: string }>;
}

export interface WSErrorMessage {
  type: 'error';
  promptId: string;
  message: string;
}

export interface WSExecutionStartMessage {
  type: 'execution_start';
  promptId: string;
}

export type WSMessage = WSConnectedMessage | WSProgressMessage | WSCompleteMessage | WSErrorMessage | WSExecutionStartMessage;
