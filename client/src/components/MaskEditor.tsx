// client/src/components/MaskEditor.tsx
import { useCallback } from 'react';
import { X } from 'lucide-react';
import { useMaskStore } from '../hooks/useMaskStore.js';

export function MaskEditor() {
  const editorState = useMaskStore((s) => s.editorState);
  const closeEditor = useMaskStore((s) => s.closeEditor);

  const handleClose = useCallback(() => {
    // TODO Task 6: save mask before closing
    closeEditor();
  }, [closeEditor]);

  if (!editorState) return null;

  const isModeB = editorState.mode === 'B';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--card-bg, #1a1a1a)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10,
          width: 'min(92vw, 1100px)',
          height: 'min(90vh, 780px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '10px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            gap: 8,
          }}
        >
          <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: '#e5e7eb' }}>
            蒙版编辑器
            <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7280', fontWeight: 400 }}>
              [{isModeB ? 'A|B混合模式' : '叠加模式'}]
            </span>
          </span>
          {isModeB && (
            <button
              style={{
                background: 'rgba(59,130,246,0.15)',
                border: '1px solid rgba(59,130,246,0.4)',
                borderRadius: 6,
                color: '#93c5fd',
                fontSize: 12,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
              onClick={() => {/* TODO Task 6: export */}}
            >
              导出
            </button>
          )}
          <button
            style={{
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
            }}
            onClick={handleClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {!isModeB && (
            <button
              style={{
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                color: '#d1d5db',
                fontSize: 12,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
              onClick={() => {/* TODO Task 6: sub-mode toggle */}}
            >
              预览模式 ▾
            </button>
          )}
          <button
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: '#d1d5db',
              fontSize: 12,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
            onClick={() => {/* TODO Task 6: clear mask */}}
          >
            清空蒙版
          </button>
          <button
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: '#d1d5db',
              fontSize: 12,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
            onClick={() => {/* TODO Task 6: invert mask */}}
          >
            反转蒙版
          </button>
        </div>

        {/* Main area: viewport + right panel */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Viewport placeholder */}
          <div
            style={{
              flex: 1,
              background: '#111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#4b5563',
              fontSize: 13,
            }}
          >
            {/* TODO Task 5: MaskCanvas goes here */}
            Canvas placeholder — mode: {editorState.mode}
          </div>

          {/* Right panel: brush controls */}
          <div
            style={{
              width: 160,
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              padding: '16px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>大小</div>
              <input type="range" min={1} max={500} defaultValue={40} style={{ width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>硬度</div>
              <input type="range" min={0} max={100} defaultValue={80} style={{ width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>不透明度</div>
              <input type="range" min={0} max={100} defaultValue={100} style={{ width: '100%' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
