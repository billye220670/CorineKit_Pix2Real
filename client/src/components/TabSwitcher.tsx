import { useCallback, useState, useRef, useLayoutEffect } from 'react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';

export function TabSwitcher() {
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const workflows = useWorkflowStore((s) => s.workflows);
  const setActiveTab = useWorkflowStore((s) => s.setActiveTab);
  const tabData = useWorkflowStore((s) => s.tabData);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const idx = workflows.findIndex((wf) => wf.id === activeTab);
    const el = tabRefs.current[idx];
    if (!el) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeTab, workflows]);

  return (
    <nav style={{
      display: 'flex',
      alignSelf: 'stretch',
      alignItems: 'center',
      position: 'relative',
      gap: 0,
    }}>
      {/* Animated sliding indicator */}
      {indicator && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: indicator.left,
          width: indicator.width,
          height: '2px',
          backgroundColor: 'var(--color-primary)',
          transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: 'none',
        }} />
      )}
      {workflows.map((wf, idx) => {
        const hasProcessing = Object.values(tabData[wf.id]?.tasks ?? {}).some(
          (t) => t.status === 'processing',
        );
        const isActive = activeTab === wf.id;
        return (
          <button
            key={wf.id}
            ref={(el) => { tabRefs.current[idx] = el; }}
            onClick={() => setActiveTab(wf.id)}
            style={{
              position: 'relative',
              height: '100%',
              padding: '0 var(--spacing-lg)',
              backgroundColor: 'transparent',
              color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
              border: 'none',
              borderRadius: 0,
              fontSize: '15px',
              fontWeight: isActive ? 700 : 400,
              cursor: 'pointer',
              transition: 'color 0.15s, background-color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {wf.name}
            {hasProcessing && (
              <span style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '6px',
                height: '6px',
                backgroundColor: 'var(--color-primary)',
                borderRadius: '50%',
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
            )}
          </button>
        );
      })}
    </nav>
  );
}
