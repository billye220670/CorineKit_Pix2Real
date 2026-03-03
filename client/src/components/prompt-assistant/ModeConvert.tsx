import { useState } from 'react';
import { ArrowRight, ArrowLeft } from 'lucide-react';
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

export function ModeConvert({ initialText }: { initialText: string }) {
  const [leftText, setLeftText] = useState(initialText);
  const [rightText, setRightText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleNaturalToTags = async () => {
    if (!leftText.trim()) return;
    setLoading(true);
    try {
      const result = await callAssistant(SYSTEM_PROMPTS.naturalToTags, leftText);
      setRightText(result);
    } catch (err) {
      alert('错误：' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  const handleTagsToNatural = async () => {
    if (!rightText.trim()) return;
    setLoading(true);
    try {
      const result = await callAssistant(SYSTEM_PROMPTS.tagsToNatural, rightText);
      setLeftText(result);
    } catch (err) {
      alert('错误：' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%' }}>
      {/* Left - Natural Language */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 12, marginBottom: 6, color: 'var(--color-text-secondary)' }}>
          自然语言
        </label>
        <textarea
          value={leftText}
          onChange={(e) => setLeftText(e.target.value)}
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
          placeholder="输入自然语言描述..."
        />
      </div>

      {/* Center - Arrow Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
        <button
          onClick={handleNaturalToTags}
          disabled={loading || !leftText.trim()}
          title="自然语言 → 标签"
          style={{
            width: 40,
            height: 40,
            background: 'var(--color-primary)',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            opacity: loading || !leftText.trim() ? 0.5 : 1,
          }}
        >
          <ArrowRight size={18} />
        </button>
        <button
          onClick={handleTagsToNatural}
          disabled={loading || !rightText.trim()}
          title="标签 → 自然语言"
          style={{
            width: 40,
            height: 40,
            background: 'var(--color-primary)',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            opacity: loading || !rightText.trim() ? 0.5 : 1,
          }}
        >
          <ArrowLeft size={18} />
        </button>
      </div>

      {/* Right - Tags */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 12, marginBottom: 6, color: 'var(--color-text-secondary)' }}>
          标签
        </label>
        <textarea
          value={rightText}
          onChange={(e) => setRightText(e.target.value)}
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
          placeholder="生成的标签会出现在这里..."
        />
      </div>
    </div>
  );
}
