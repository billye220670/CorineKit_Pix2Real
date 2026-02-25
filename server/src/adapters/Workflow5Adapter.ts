// server/src/adapters/Workflow5Adapter.ts
import type { WorkflowAdapter } from './BaseAdapter.js';

export const workflow5Adapter: WorkflowAdapter = {
  id: 5,
  name: '解除装备',
  needsPrompt: true,
  basePrompt: '',
  outputDir: '5-解除装备',

  buildPrompt(): object {
    throw new Error('Workflow 5 uses the dedicated /5/execute route');
  },
};
