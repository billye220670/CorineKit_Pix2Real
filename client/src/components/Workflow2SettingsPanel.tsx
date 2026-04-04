import { useState, useEffect } from 'react';

const SETTINGS_KEY = 'wf2_settings';

function readSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') ?? {}; } catch { return {}; }
}

export function Workflow2SettingsPanel() {
  const [upscaleModel, setUpscaleModel] = useState<'seedvr2' | 'klein' | 'sd' | 'remacri'>(() => readSettings().upscaleModel ?? 'seedvr2');

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ upscaleModel }));
  }, [upscaleModel]);

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
          <div style={label}>放大模型</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button style={pillBtn(upscaleModel === 'seedvr2')} onClick={() => setUpscaleModel('seedvr2')}>SeedVR2</button>
            <button style={pillBtn(upscaleModel === 'klein')} onClick={() => setUpscaleModel('klein')}>Klein</button>
            <button style={pillBtn(upscaleModel === 'sd')} onClick={() => setUpscaleModel('sd')}>4xUltraSharp</button>
            <button style={pillBtn(upscaleModel === 'remacri')} onClick={() => setUpscaleModel('remacri')}>Remacri</button>
          </div>
        </div>
      </div>
    </div>
  );
}
