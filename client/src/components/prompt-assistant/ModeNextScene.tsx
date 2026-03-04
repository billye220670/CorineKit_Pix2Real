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

export function ModeNextScene({ initialText, sessionKey }: { initialText: string; sessionKey: number }) {
  const [inputText, setInputText] = useState(initialText);
  const [resultText, setResultText] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultHovered, setResultHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialText) setInputText(initialText);
  }, [sessionKey]);

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

  const doCopy = () => {
    navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* Left - Current Scene */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 12, marginBottom: 8, color: 'var(--color-text-secondary)' }}>
          当前镜头
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
          placeholder="输入当前分镜的描述..."
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
          {loading ? '生成中...' : '脑补后续'}
        </button>
      </div>

      {/* Right - Next Scene */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 12, marginBottom: 8, color: 'var(--color-text-secondary)' }}>
          下一镜头
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
            placeholder="下一镜头会出现在这里..."
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
