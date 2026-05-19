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
    const multiplier = options?.multiplier ?? 2;
    template['2'].inputs.multiplier = multiplier;

    // Node "5" (VHS_VideoCombine): keep output duration unchanged
    // frame_rate = sourceFps * multiplier（默认源帧率 24fps，与原硬编码 48 = 24×2 的隐含假设一致）
    const sourceFps = options?.sourceFps ?? 24;
    template['5'].inputs.frame_rate = sourceFps * multiplier;

    return template;
  },
};
