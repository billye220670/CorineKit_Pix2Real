import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WorkflowAdapter } from './BaseAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-快速生成视频RAM.json');

export const workflow3Adapter: WorkflowAdapter = {
  id: 3,
  name: '快速生成视频',
  needsPrompt: true,
  basePrompt: '女孩原地挣扎，但被紧紧固定住, 表情不变',
  outputDir: '3-快速生成视频',

  buildPrompt(imageName: string, userPrompt?: string): object {
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

    // Node "206" (LoadImage): set uploaded image name
    template['206'].inputs.image = imageName;

    // Node "163" (CLIPTextEncode "Positive Input"): set prompt
    // User input replaces the entire prompt (not appended)
    const prompt = (userPrompt && userPrompt.trim()) ? userPrompt.trim() : this.basePrompt;
    template['163'].inputs.text = prompt;

    // Node "165" (WanMoeKSampler): randomize seed
    template['165'].inputs.seed = Math.floor(Math.random() * 1125899906842624);

    return template;
  },
};
