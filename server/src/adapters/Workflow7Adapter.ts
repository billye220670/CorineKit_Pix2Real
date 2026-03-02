import type { WorkflowAdapter } from './BaseAdapter.js';

export const workflow7Adapter: WorkflowAdapter = {
  id: 7,
  name: '快速出图',
  needsPrompt: false,
  basePrompt: '',
  outputDir: '7-快速出图',

  buildPrompt(_imageName: string, _userPrompt?: string): object {
    throw new Error('Workflow 7 uses a dedicated route; call POST /api/workflow/7/execute with JSON body instead.');
  },
};
