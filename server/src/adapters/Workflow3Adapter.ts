import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WorkflowAdapter } from './BaseAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, '../../../ComfyUI_API/Wan22-Dasiwa.json');

export const workflow3Adapter: WorkflowAdapter = {
  id: 3,
  name: '图生视频',
  needsPrompt: true,
  basePrompt: '女孩轻微摇晃，微风吹拂头发',
  outputDir: '3-图生视频',

  buildPrompt(imageName: string, userPrompt?: string, options?: Record<string, any>): object {
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

    // Node "141" (LoadImage): set uploaded image name
    template['141'].inputs.image = imageName;

    // Node "240" (CLIPTextEncode): set prompt
    const prompt = (userPrompt && userPrompt.trim()) ? userPrompt.trim() : this.basePrompt;
    template['240'].inputs.text = prompt;

    // Node "258": video duration in seconds
    template['258'].inputs.value = options?.seconds ?? 4;

    // Node "413": frame rate (fps)
    template['413'].inputs.value = options?.fps ?? 16;

    // Node "458": quality / megapixels
    template['458'].inputs.megapixels = options?.megapixels ?? 1;

    // Node "203": randomize noise seed
    template['203'].inputs.noise_seed = Math.floor(Math.random() * 1125899906842624);

    return template;
  },
};
