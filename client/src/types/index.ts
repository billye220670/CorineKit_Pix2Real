export interface ImageItem {
  id: string;
  file: File;
  previewUrl: string;
  originalName: string;
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
