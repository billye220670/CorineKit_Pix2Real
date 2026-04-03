// server/src/adapters/Workflow10Adapter.ts
import type { WorkflowAdapter } from './BaseAdapter.js';

export const workflow10Adapter: WorkflowAdapter = {
  id: 10,
  name: '区域编辑',
  needsPrompt: true,
  basePrompt: '',
  outputDir: '10-区域编辑',

  buildPrompt(): object {
    throw new Error('Workflow 10 uses the dedicated /10/execute route');
  },
};
