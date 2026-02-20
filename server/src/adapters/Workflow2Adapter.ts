import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WorkflowAdapter } from './BaseAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, '../../../ComfyUI_API/2-Pix2Real-精修放大.json');

export const workflow2Adapter: WorkflowAdapter = {
  id: 2,
  name: '精修放大',
  needsPrompt: false,
  basePrompt: '',
  outputDir: '2-精修放大',

  buildPrompt(imageName: string): object {
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

    // Node "1145" (LoadImage): set uploaded image name
    template['1145'].inputs.image = imageName;

    // Node "1148" (SeedVR2VideoUpscaler): randomize seed
    template['1148'].inputs.seed = Math.floor(Math.random() * 4294967295);

    return template;
  },
};
