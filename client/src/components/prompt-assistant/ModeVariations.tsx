import { useState, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';
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

const copyBtnBase = {
  position: 'absolute' as const,
  bottom: 8,
  right: 8,
  padding: '4px 7px',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'var(--color-text-secondary)',
  display: 'flex',
  alignItems: 'center',
  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
  zIndex: 1,
};

export function ModeVariations({ initialText, sessionKey }: { initialText: string; sessionKey: number }) {
  const [inputText, setInputText] = useState(initialText);
  const [variations, setVariations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (initialText) setInputText(initialText);
  }, [sessionKey]);

  const handleGenerate = async () => {
    if (!inputText.trim()) return;
    setLoading(true);
    try {
      const result = await callAssistant(SYSTEM_PROMPTS.variations, inputText);
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

  const doCopy = (text: string, i: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* Left - Input */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 12, marginBottom: 8, color: 'var(--color-text-secondary)' }}>
          原始提示词
        </label>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          style={{
            flex: 1,
            padding: 10,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            color: 'var(--color-text)',
            fontFamily: 'mono',
            fontSize: 12,
            lineHeight: 1.6,
            resize: 'none',
          }}
          placeholder="输入提示词，使用 #...@0.5 标记要变更的部分..."
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !inputText.trim()}
          style={{
            marginTop: 10,
            padding: '8px 16px',
            background: 'var(--color-primary)',
            border: 'none',
            borderRadius: 5,
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
        <label style={{ fontSize: 12, marginBottom: 8, color: 'var(--color-text-secondary)' }}>
          生成的变体 ({variations.length}/5)
        </label>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {variations.map((variant, i) => (
            <div
              key={i}
              style={{ position: 'relative' }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <div
                style={{
                  padding: 10,
                  paddingBottom: 32,
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 5,
                  color: 'var(--color-text)',
                  fontFamily: 'mono',
                  fontSize: 11,
                  lineHeight: 1.65,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {variant}
              </div>
              {hoveredIdx === i && (
                <button style={copyBtnBase} onClick={() => doCopy(variant, i)}>
                  {copiedIdx === i ? <Check size={13} /> : <Copy size={13} />}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
