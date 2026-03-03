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

export function ModeVariations({ initialText }: { initialText: string }) {
  const [inputText, setInputText] = useState(initialText);
  const [variations, setVariations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!inputText.trim()) return;
    setLoading(true);
    try {
      const result = await callAssistant(SYSTEM_PROMPTS.variations, inputText);
      // Parse numbered list: "1. ...\n2. ...\n..."
      const lines = result.split('\n').filter((l) => l.trim());
      const parsed = lines
        .map((l) => l.replace(/^\d+\.\s*/, '').trim())
        .filter((l) => l.length > 0);
      setVariations(parsed.slice(0, 5));
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
          placeholder="输入提示词，使用 #...@0.5 标记要变更的部分..."
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
          {loading ? '生成中...' : '创建变体'}
        </button>
      </div>

      {/* Right - Results */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <label style={{ fontSize: 12, marginBottom: 6, color: 'var(--color-text-secondary)' }}>
          生成的变体 ({variations.length}/5)
        </label>
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {variations.map((variant, i) => (
            <textarea
              key={i}
              value={variant}
              readOnly
              style={{
                flex: 1,
                padding: 8,
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                color: 'var(--color-text)',
                fontFamily: 'mono',
                fontSize: 11,
                resize: 'none',
                minHeight: 60,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
