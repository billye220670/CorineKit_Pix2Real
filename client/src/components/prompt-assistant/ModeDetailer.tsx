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

export function ModeDetailer({ initialText, sessionKey }: { initialText: string; sessionKey: number }) {
  const [inputText, setInputText] = useState(initialText);
  const [resultText, setResultText] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultHovered, setResultHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialText) setInputText(initialText);
  }, [sessionKey]);

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

  const doCopy = () => {
    navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
          placeholder="使用 [] 或 【】 标记要扩写的部分，后跟点数表示详细度..."
        />
        <button
          onClick={handleExpand}
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
          {loading ? '扩写中...' : '扩写'}
        </button>
      </div>

      {/* Right - Result */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 12, marginBottom: 8, color: 'var(--color-text-secondary)' }}>
          扩写结果
        </label>
        <div
          style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}
          onMouseEnter={() => setResultHovered(true)}
          onMouseLeave={() => setResultHovered(false)}
        >
          <textarea
            value={resultText}
            readOnly
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
            placeholder="扩写后的提示词会出现在这里..."
          />
          {resultHovered && resultText && (
            <button style={copyBtnBase} onClick={doCopy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
