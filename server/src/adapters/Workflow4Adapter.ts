import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WorkflowAdapter } from './BaseAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, '../../../ComfyUI_API/FrameInterp.json');

export const workflow4Adapter: WorkflowAdapter = {
  id: 4,
  name: '视频补帧',
  needsPrompt: false,
  basePrompt: '',
  outputDir: '4-视频补帧',

  buildPrompt(videoName: string, _userPrompt?: string, options?: Record<string, any>): object {
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

    // Node "4" (VHS_LoadVideo): set uploaded video name
    template['4'].inputs.video = videoName;

    // Node "2": frame interpolation multiplier
    template['2'].inputs.multiplier = options?.multiplier ?? 2;

    return template;
  },
};
