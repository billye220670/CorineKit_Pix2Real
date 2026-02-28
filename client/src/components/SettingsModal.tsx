import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useSettingsStore, type ReversePromptModel } from '../hooks/useSettingsStore.js';
import { SegmentedControl } from './SegmentedControl.js';

const REVERSE_PROMPT_MODELS: { value: ReversePromptModel; label: string }[] = [
  { value: 'Qwen3VL', label: 'Qwen3VL' },
  { value: 'Florence', label: 'Florence' },
  { value: 'WD-14', label: 'WD-14' },
];

export function SettingsModal() {
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const reversePromptModel = useSettingsStore((s) => s.reversePromptModel);
  const setReversePromptModel = useSettingsStore((s) => s.setReversePromptModel);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSettings(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, closeSettings]);

  if (!settingsOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={closeSettings}
    >
      <div
        style={{
          width: 'min(92vw, 1200px)',
          height: 'min(90vh, 820px)',
          backgroundColor: 'var(--card-bg, #1a1a1a)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)' }}>设置</span>
          <button
            onClick={closeSettings}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 4, background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-secondary)', borderRadius: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 28px' }}>

          {/* Section: 反推提示词 */}
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 16,
          }}>
            反推提示词
          </div>

          {/* Row: 反推模型 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 0',
            borderBottom: '1px solid var(--color-border)',
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 3 }}>
                反推模型
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                用于图像提示词反推的 AI 模型
              </div>
            </div>
            <SegmentedControl
              options={REVERSE_PROMPT_MODELS}
              value={reversePromptModel}
              onChange={(v) => setReversePromptModel(v as ReversePromptModel)}
            />
          </div>

        </div>
      </div>
    </div>
  );
}
