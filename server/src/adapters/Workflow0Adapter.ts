import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WorkflowAdapter } from './BaseAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, '../../../ComfyUI_API/👻二次元转真人(NoUnload).json');

export const workflow0Adapter: WorkflowAdapter = {
  id: 0,
  name: '二次元转真人',
  needsPrompt: true,
  basePrompt: 'transform the image to realistic photograph, Asian',
  outputDir: '0-二次元转真人',

  buildPrompt(imageName: string, userPrompt?: string): object {
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

    // Node "15" (LoadImage): set uploaded image name
    template['15'].inputs.image = imageName;

    // Node "17" (TextEncodeQwenImageEditPlus): set prompt
    let prompt = this.basePrompt;
    if (userPrompt && userPrompt.trim()) {
      prompt += ', ' + userPrompt.trim();
    }
    template['17'].inputs.prompt = prompt;

    // Node "14" (KSampler): randomize seed
    template['14'].inputs.seed = Math.floor(Math.random() * 1125899906842624);

    return template;
  },
};
