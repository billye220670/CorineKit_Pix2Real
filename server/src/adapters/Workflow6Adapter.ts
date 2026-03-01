import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WorkflowAdapter } from './BaseAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-真人转二次元.json');

export const workflow6Adapter: WorkflowAdapter = {
  id: 6,
  name: '真人转二次元',
  needsPrompt: true,
  basePrompt: '',
  outputDir: '6-真人转二次元',

  buildPrompt(imageName: string, userPrompt?: string): object {
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

    // Node "57" (LoadImage): set uploaded image
    template['57'].inputs.image = imageName;

    // Node "66" (TextInput_): user prompt
    // Empty string → ComfyUI's ifElse falls back to WD14 auto-tag path
    // Non-empty → used directly as positive prompt
    template['66'].inputs.text = (userPrompt && userPrompt.trim()) ? userPrompt.trim() : '';

    // Node "3" (KSampler): randomize seed
    template['3'].inputs.seed = Math.floor(Math.random() * 1125899906842624);

    // Node "15" (KSampler): randomize seed
    template['15'].inputs.seed = Math.floor(Math.random() * 1125899906842624);

    return template;
  },
};
