import type { WorkflowAdapter } from './BaseAdapter.js';

export const workflow8Adapter: WorkflowAdapter = {
  id: 8,
  name: '黑兽换脸',
  needsPrompt: false,
  basePrompt: '',
  outputDir: '8-黑兽换脸',

  buildPrompt(_imageName: string, _userPrompt?: string): object {
    throw new Error('Workflow 8 uses the dedicated /8/execute route');
  },
};
