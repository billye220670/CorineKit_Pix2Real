import { useCallback, useState } from 'react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { showToast } from '../hooks/useToast.js';

export function TabSwitcher() {
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const workflows = useWorkflowStore((s) => s.workflows);
  const setActiveTab = useWorkflowStore((s) => s.setActiveTab);
  const tabData = useWorkflowStore((s) => s.tabData);
  const addImagesToTab = useWorkflowStore((s) => s.addImagesToTab);
  const [dragOverTab, setDragOverTab] = useState<number | null>(null);

  const handleDrop = useCallback(async (e: React.DragEvent, targetTab: number) => {
    e.preventDefault();
    setDragOverTab(null);

    const imageId = e.dataTransfer.getData('application/x-workflow-image');
    if (!imageId) return;

    const state = useWorkflowStore.getState();
    let sourceFile: File | null = null;

    let sourceTabId: number | null = null;

    for (const [key, tabEntry] of Object.entries(state.tabData)) {
      const img = tabEntry.images.find((i) => i.id === imageId);
      if (!img) continue;
      sourceTabId = Number(key);

      const outputs = tabEntry.tasks[imageId]?.outputs ?? [];
      if (outputs.length > 0) {
        const last = outputs[outputs.length - 1];
        try {
          const res = await fetch(last.url);
          const blob = await res.blob();
          sourceFile = new File([blob], last.filename, { type: blob.type });
        } catch {
          sourceFile = img.file;
        }
      } else {
        sourceFile = img.file;
      }
      break;
    }

    if (sourceTabId === null || sourceTabId === targetTab || !sourceFile) return;

    addImagesToTab(targetTab, [sourceFile]);
    const targetName = state.workflows.find((w) => w.id === targetTab)?.name ?? '';
    showToast(`已导入到「${targetName}」`);
  }, [addImagesToTab]);

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
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverTab(wf.id); }}
            onDragLeave={(e) => {
              const related = e.relatedTarget as Node | null;
              if (!e.currentTarget.contains(related)) {
                setDragOverTab(null);
              }
            }}
            onDrop={(e) => handleDrop(e, wf.id)}
            style={{
              position: 'relative',
              padding: 'var(--spacing-sm) var(--spacing-md)',
              backgroundColor: activeTab === wf.id ? 'var(--color-primary)' : 'transparent',
              color: activeTab === wf.id ? '#ffffff' : 'var(--color-text)',
              border: '1px solid',
              borderColor: dragOverTab === wf.id
                ? 'var(--color-primary)'
                : activeTab === wf.id
                  ? 'var(--color-primary)'
                  : 'var(--color-border)',
              outline: dragOverTab === wf.id ? '2px solid var(--color-primary)' : 'none',
              outlineOffset: '2px',
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
