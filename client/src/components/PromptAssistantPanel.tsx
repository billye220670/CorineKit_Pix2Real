import { X } from 'lucide-react';
import { usePromptAssistantStore, type PromptMode } from '../hooks/usePromptAssistantStore.js';
import { ModeConvert } from './prompt-assistant/ModeConvert.js';
import { ModeVariations } from './prompt-assistant/ModeVariations.js';
import { ModeDetailer } from './prompt-assistant/ModeDetailer.js';
import { ModeNextScene } from './prompt-assistant/ModeNextScene.js';
import { ModeStoryboarder } from './prompt-assistant/ModeStoryboarder.js';
import { ModeTagAssemble } from './prompt-assistant/ModeTagAssemble.js';

const TABS: Array<{ id: PromptMode; label: string }> = [
  { id: 'convert', label: '标签转换' },
  { id: 'variations', label: '创建变体' },
  { id: 'detailer', label: '按需扩写' },
  { id: 'nextScene', label: '脑补后续' },
  { id: 'storyboarder', label: '分镜生成' },
  { id: 'tagAssemble', label: '标签合成器' },
];

export function PromptAssistantPanel() {
  const { isOpen, activeMode, initialText, closePanel, setMode } = usePromptAssistantStore();

  if (!isOpen) return null;

  const renderMode = () => {
    switch (activeMode) {
      case 'convert':
        return <ModeConvert initialText={initialText} />;
      case 'variations':
        return <ModeVariations initialText={initialText} />;
      case 'detailer':
        return <ModeDetailer initialText={initialText} />;
      case 'nextScene':
        return <ModeNextScene initialText={initialText} />;
      case 'storyboarder':
        return <ModeStoryboarder initialText={initialText} />;
      case 'tagAssemble':
        return <ModeTagAssemble />;
      default:
        return null;
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: '90%',
          maxWidth: 1000,
          height: '80vh',
          maxHeight: 700,
          background: 'var(--card-bg, #1e1e1e)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>提示词助理</h2>
          <button
            onClick={closePanel}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              color: 'var(--color-text-secondary)',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Bar */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            gap: 0,
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              style={{
                flex: 1,
                padding: '10px 12px',
                background: activeMode === tab.id ? 'var(--color-surface)' : 'transparent',
                border: 'none',
                borderBottom:
                  activeMode === tab.id ? '2px solid var(--color-primary)' : '2px solid transparent',
                color:
                  activeMode === tab.id ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                transition: 'all 0.2s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            padding: 16,
          }}
        >
          {renderMode()}
        </div>
      </div>
    </div>
  );
}
