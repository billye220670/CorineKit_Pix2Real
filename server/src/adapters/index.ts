import type { WorkflowAdapter } from './BaseAdapter.js';
import { workflow0Adapter } from './Workflow0Adapter.js';
import { workflow1Adapter } from './Workflow1Adapter.js';
import { workflow2Adapter } from './Workflow2Adapter.js';
import { workflow3Adapter } from './Workflow3Adapter.js';
import { workflow4Adapter } from './Workflow4Adapter.js';
import { workflow5Adapter } from './Workflow5Adapter.js';
import { workflow6Adapter } from './Workflow6Adapter.js';
import { workflow7Adapter } from './Workflow7Adapter.js';
import { workflow8Adapter } from './Workflow8Adapter.js';
import { workflow9Adapter } from './Workflow9Adapter.js';
import { workflow10Adapter } from './Workflow10Adapter.js';

export const adapters: Record<number, WorkflowAdapter> = {
  0: workflow0Adapter,
  1: workflow1Adapter,
  2: workflow2Adapter,
  3: workflow3Adapter,
  4: workflow4Adapter,
  5: workflow5Adapter,
  6: workflow6Adapter,
  7: workflow7Adapter,
  8: workflow8Adapter,
  9: workflow9Adapter,
  10: workflow10Adapter,
};

export function getAdapter(id: number): WorkflowAdapter | undefined {
  return adapters[id];
}

export { type WorkflowAdapter } from './BaseAdapter.js';
