export interface WorkflowAdapter {
  id: number;
  name: string;
  needsPrompt: boolean;
  basePrompt: string;
  outputDir: string;
  buildPrompt(imageName: string, userPrompt?: string): object;
}

export interface ProgressEvent {
  type: 'progress';
  promptId: string;
  value: number;
  max: number;
  percentage: number;
}

export interface CompleteEvent {
  type: 'complete';
  promptId: string;
  outputs: OutputFile[];
}

export interface ErrorEvent {
  type: 'error';
  promptId: string;
  message: string;
}

export type WSEvent = ProgressEvent | CompleteEvent | ErrorEvent;

export interface OutputFile {
  filename: string;
  subfolder: string;
  type: string;
}

export interface QueueResponse {
  prompt_id: string;
}

export interface HistoryEntry {
  outputs: Record<string, {
    images?: OutputFile[];
    gifs?: Array<{ filename: string; subfolder: string; type: string }>;
  }>;
  status: {
    completed: boolean;
    status_str: string;
  };
}
