import { useSettingsStore } from '../hooks/useSettingsStore.js';

export async function callPromptAssistant(params: { systemPrompt: string; userPrompt: string }): Promise<{ text: string }> {
  const { llmModel } = useSettingsStore.getState();
  const endpoint = llmModel === 'grok'
    ? '/api/workflow/prompt-assistant-grok'
    : '/api/workflow/prompt-assistant';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(error.error || `请求失败: ${res.status}`);
  }

  return res.json();
}

export async function callSmartLora(prompt: string): Promise<{ loras: Array<{ model: string; strength: number }> }> {
  const res = await fetch('/api/workflow/smart-lora', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error('智能LoRA推荐请求失败');
  return res.json();
}
