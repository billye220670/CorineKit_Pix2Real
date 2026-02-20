import type { WorkflowAdapter } from './BaseAdapter.js';
import { workflow0Adapter } from './Workflow0Adapter.js';
import { workflow1Adapter } from './Workflow1Adapter.js';
import { workflow2Adapter } from './Workflow2Adapter.js';
import { workflow3Adapter } from './Workflow3Adapter.js';
import { workflow4Adapter } from './Workflow4Adapter.js';

export const adapters: Record<number, WorkflowAdapter> = {
  0: workflow0Adapter,
  1: workflow1Adapter,
  2: workflow2Adapter,
  3: workflow3Adapter,
  4: workflow4Adapter,
};

export function getAdapter(id: number): WorkflowAdapter | undefined {
  return adapters[id];
}

export { type WorkflowAdapter } from './BaseAdapter.js';
