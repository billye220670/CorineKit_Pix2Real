import type { WorkflowAdapter } from './BaseAdapter.js';

export const workflow9Adapter: WorkflowAdapter = {
  id: 9,
  name: 'ZIT快出',
  needsPrompt: false,
  basePrompt: '',
  outputDir: '9-ZIT快出',

  buildPrompt(_imageName: string, _userPrompt?: string): object {
    throw new Error('Workflow 9 uses a dedicated route; call POST /api/workflow/9/execute with JSON body instead.');
  },
};
