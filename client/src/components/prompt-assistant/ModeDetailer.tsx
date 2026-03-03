import { useState } from 'react';
import { SYSTEM_PROMPTS } from './systemPrompts.js';

async function callAssistant(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch('/api/workflow/prompt-assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userPrompt }),
  });
  if (!res.ok) throw new Error(await res.text());
  const { text } = await res.json();
  return text;
}

export function ModeDetailer({ initialText }: { initialText: string }) {
  const [inputText, setInputText] = useState(initialText);
  const [resultText, setResultText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleExpand = async () => {
    if (!inputText.trim()) return;
    setLoading(true);
    try {
      const result = await callAssistant(SYSTEM_PROMPTS.detailer, inputText);
      setResultText(result);
    } catch (err) {
      alert('错误：' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%' }}>
      {/* Left - Input */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 12, marginBottom: 6, color: 'var(--color-text-secondary)' }}>
          原始提示词
        </label>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          style={{
            flex: 1,
            padding: 8,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            color: 'var(--color-text)',
            fontFamily: 'mono',
            fontSize: 12,
            resize: 'none',
          }}
          placeholder="使用 [] 或 【】 标记要扩写的部分，后跟点数表示详细度..."
        />
        <button
          onClick={handleExpand}
          disabled={loading || !inputText.trim()}
          style={{
            marginTop: 8,
            padding: '8px 16px',
            background: 'var(--color-primary)',
            border: 'none',
            borderRadius: 4,
            color: 'white',
            cursor: 'pointer',
            fontSize: 12,
            opacity: loading || !inputText.trim() ? 0.5 : 1,
          }}
        >
          {loading ? '扩写中...' : '扩写'}
        </button>
      </div>

      {/* Right - Result */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 12, marginBottom: 6, color: 'var(--color-text-secondary)' }}>
          扩写结果
        </label>
        <textarea
          value={resultText}
          readOnly
          style={{
            flex: 1,
            padding: 8,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            color: 'var(--color-text)',
            fontFamily: 'mono',
            fontSize: 12,
            resize: 'none',
          }}
          placeholder="扩写后的提示词会出现在这里..."
        />
      </div>
    </div>
  );
}
