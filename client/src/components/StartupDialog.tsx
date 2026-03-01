import type { StartupDialogState } from '../hooks/useSession.js';

export function StartupDialog({ onRestore, onStartNew }: StartupDialogState) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--card-bg, #1a1a1a)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: '28px 32px',
          width: 'min(90vw, 420px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
            发现上次会话
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            检测到上次未关闭的会话，是否继续？
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onStartNew}
            style={{
              padding: '8px 20px',
              backgroundColor: 'transparent',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            开新会话
          </button>
          <button
            onClick={onRestore}
            style={{
              padding: '8px 20px',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            恢复会话
          </button>
        </div>
      </div>
    </div>
  );
}
