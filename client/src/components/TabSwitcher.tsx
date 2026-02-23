import { useCallback, useState, useRef, useLayoutEffect } from 'react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { showToast } from '../hooks/useToast.js';

export function TabSwitcher() {
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const workflows = useWorkflowStore((s) => s.workflows);
  const setActiveTab = useWorkflowStore((s) => s.setActiveTab);
  const tabData = useWorkflowStore((s) => s.tabData);
  const addImagesToTab = useWorkflowStore((s) => s.addImagesToTab);
  const [dragOverTab, setDragOverTab] = useState<number | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const idx = workflows.findIndex((wf) => wf.id === activeTab);
    const el = tabRefs.current[idx];
    if (!el) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeTab, workflows]);

  const handleDrop = useCallback(async (e: React.DragEvent, targetTab: number) => {
    e.preventDefault();
    setDragOverTab(null);

    const imageId = e.dataTransfer.getData('application/x-workflow-image');
    if (!imageId) return;

    const state = useWorkflowStore.getState();
    const selectedIds = state.selectedImageIds;

    // If the dragged card is part of a multi-selection, import all selected; otherwise single import
    const idsToImport = selectedIds.length > 0 && selectedIds.includes(imageId)
      ? selectedIds
      : [imageId];

    // Find which tab owns these images (use first found) and reject same-tab drops
    let sourceTabId: number | null = null;
    for (const [key, tabEntry] of Object.entries(state.tabData)) {
      if (tabEntry.images.some((i) => idsToImport.includes(i.id))) {
        sourceTabId = Number(key);
        break;
      }
    }
    if (sourceTabId === null || sourceTabId === targetTab) return;

    // Resolve files (prefer latest output, fall back to original)
    const files: File[] = [];
    for (const id of idsToImport) {
      let file: File | null = null;
      for (const tabEntry of Object.values(state.tabData)) {
        const img = tabEntry.images.find((i) => i.id === id);
        if (!img) continue;
        const outputs = tabEntry.tasks[id]?.outputs ?? [];
        if (outputs.length > 0) {
          const last = outputs[outputs.length - 1];
          try {
            const res = await fetch(last.url);
            const blob = await res.blob();
            file = new File([blob], last.filename, { type: blob.type });
          } catch {
            file = img.file;
          }
        } else {
          file = img.file;
        }
        break;
      }
      if (file) files.push(file);
    }

    if (files.length === 0) return;

    addImagesToTab(targetTab, files);
    const targetName = state.workflows.find((w) => w.id === targetTab)?.name ?? '';
    const label = files.length > 1 ? `${files.length} 张图片` : '';
    showToast(`已导入${label}到「${targetName}」`);
  }, [addImagesToTab]);

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
        const isDragging = dragOverTab === wf.id;
        return (
          <button
            key={wf.id}
            ref={(el) => { tabRefs.current[idx] = el; }}
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
              height: '100%',
              padding: '0 var(--spacing-lg)',
              backgroundColor: isDragging ? 'var(--color-surface-hover)' : 'transparent',
              color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
              border: 'none',
              boxShadow: isDragging ? 'inset 0 -2px 0 0 var(--color-primary)' : 'none',
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
