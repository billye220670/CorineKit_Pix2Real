import { useWorkflowStore } from '../hooks/useWorkflowStore.js';

export function TabSwitcher() {
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const workflows = useWorkflowStore((s) => s.workflows);
  const setActiveTab = useWorkflowStore((s) => s.setActiveTab);
  const tabData = useWorkflowStore((s) => s.tabData);

  return (
    <nav style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
      {workflows.map((wf) => {
        const hasProcessing = Object.values(tabData[wf.id]?.tasks ?? {}).some(
          (t) => t.status === 'processing',
        );
        return (
          <button
            key={wf.id}
            onClick={() => setActiveTab(wf.id)}
            style={{
              position: 'relative',
              padding: 'var(--spacing-sm) var(--spacing-md)',
              backgroundColor: activeTab === wf.id ? 'var(--color-primary)' : 'transparent',
              color: activeTab === wf.id ? '#ffffff' : 'var(--color-text)',
              border: '1px solid',
              borderColor: activeTab === wf.id ? 'var(--color-primary)' : 'var(--color-border)',
              borderRadius: 0,
              fontSize: '13px',
              fontWeight: activeTab === wf.id ? 600 : 400,
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {wf.name}
            {hasProcessing && (
              <span style={{
                position: 'absolute',
                top: '-3px',
                right: '-3px',
                width: '8px',
                height: '8px',
                backgroundColor: activeTab === wf.id ? '#ffffff' : 'var(--color-primary)',
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
