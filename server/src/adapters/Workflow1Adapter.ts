import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WorkflowAdapter } from './BaseAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, '../../../ComfyUI_API/Pix2Real-👻真人精修NEW.json');

export const workflow1Adapter: WorkflowAdapter = {
  id: 1,
  name: '真人精修',
  needsPrompt: true,
  basePrompt: 'score_9, score_8_up, score_7_up, masterpiece, realistic, HDR, UHD, 8K, best quality, highres, absurdres, ultra-highres, Highly detailed, clear details, detailed skin, skin textures, fair skin, newest, \nA Korean girl, completely nude, nude， breasts, nipples',
  outputDir: '1-真人精修',

  buildPrompt(imageName: string, userPrompt?: string): object {
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

    // Node "247" (LoadImage): set uploaded image name
    template['247'].inputs.image = imageName;

    // Node "233" (CLIPTextEncode - positive): set prompt
    // IMPORTANT: This is the CLIP text encode node, NOT the SAM node
    let prompt = this.basePrompt;
    if (userPrompt && userPrompt.trim()) {
      prompt += ', ' + userPrompt.trim();
    }
    template['233'].inputs.text = prompt;

    // Node "392" (easy seed): randomize seed
    template['392'].inputs.seed = Math.floor(Math.random() * 1125899906842624);

    return template;
  },
};
