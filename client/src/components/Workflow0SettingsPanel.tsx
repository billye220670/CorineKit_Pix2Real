import { useState, useEffect } from 'react';

const SETTINGS_KEY = 'wf0_settings';

function readSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') ?? {}; } catch { return {}; }
}

export function Workflow0SettingsPanel() {
  const [drawModel, setDrawModel] = useState<'qwen' | 'klein'>(() => readSettings().drawModel ?? 'qwen');

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ drawModel }));
  }, [drawModel]);

  const label: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    letterSpacing: '0.04em',
    marginBottom: 6,
  };

  const pillBtn = (active: boolean): React.CSSProperties => ({
    padding: '4px 8px',
    fontSize: '12px',
    border: active ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
    borderRadius: 6,
    backgroundColor: active ? 'rgba(33,150,243,0.12)' : 'transparent',
    color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background-color 0.12s, border-color 0.12s, color 0.12s',
  });

  return (
    <div style={{
      width: 220,
      flexShrink: 0,
      borderLeft: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-surface)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={label}>绘制模型</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={pillBtn(drawModel === 'qwen')} onClick={() => setDrawModel('qwen')}>Qwen</button>
            <button style={pillBtn(drawModel === 'klein')} onClick={() => setDrawModel('klein')}>Klein</button>
          </div>
        </div>
      </div>
    </div>
  );
}
