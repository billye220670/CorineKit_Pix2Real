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

export function ModeNextScene({ initialText }: { initialText: string }) {
  const [inputText, setInputText] = useState(initialText);
  const [resultText, setResultText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!inputText.trim()) return;
    setLoading(true);
    try {
      const result = await callAssistant(SYSTEM_PROMPTS.nextScene, inputText);
      setResultText(result);
    } catch (err) {
      alert('错误：' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%' }}>
      {/* Left - Current Scene */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 12, marginBottom: 6, color: 'var(--color-text-secondary)' }}>
          当前镜头
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
          placeholder="输入当前分镜的描述..."
        />
        <button
          onClick={handleGenerate}
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
          {loading ? '生成中...' : '脑补后续'}
        </button>
      </div>

      {/* Right - Next Scene */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 12, marginBottom: 6, color: 'var(--color-text-secondary)' }}>
          下一镜头
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
          placeholder="下一镜头会出现在这里..."
        />
      </div>
    </div>
  );
}
