import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WorkflowAdapter } from './BaseAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, '../../../ComfyUI_API/4-Pix2Real-视频放大.json');

export const workflow4Adapter: WorkflowAdapter = {
  id: 4,
  name: '视频放大',
  needsPrompt: false,
  basePrompt: '',
  outputDir: '4-视频放大',

  buildPrompt(imageName: string): object {
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

    // Node "968" (VHS_LoadVideo): set uploaded video name
    template['968'].inputs.video = imageName;

    // Node "1153" (SeedVR2VideoUpscaler): randomize seed
    template['1153'].inputs.seed = Math.floor(Math.random() * 4294967295);

    return template;
  },
};
