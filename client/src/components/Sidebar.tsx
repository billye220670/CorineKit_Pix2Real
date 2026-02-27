import { useCallback, useState, useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { showToast } from '../hooks/useToast.js';
import { QueuePanel } from './QueuePanel.js';
import {
  Wand2, Sparkles, ZoomIn, Scissors, Video, Maximize2, ListOrdered,
} from 'lucide-react';

const GROUPS: { label: string; ids: number[] }[] = [
  { label: '图像处理', ids: [0, 1, 2, 5] },
  { label: '视频处理', ids: [3, 4] },
];

const WORKFLOW_ICONS: Record<number, LucideIcon> = {
  0: Wand2,
  1: Sparkles,
  2: ZoomIn,
  3: Video,
  4: Maximize2,
  5: Scissors,
};

export function Sidebar() {
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const workflows = useWorkflowStore((s) => s.workflows);
  const setActiveTab = useWorkflowStore((s) => s.setActiveTab);
  const tabData = useWorkflowStore((s) => s.tabData);
  const addImagesToTab = useWorkflowStore((s) => s.addImagesToTab);

  const [dragOverTab, setDragOverTab] = useState<number | null>(null);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const queueWrapperRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  // Native dragover listener — React's synthetic events can miss preventDefault()
  // for drag events; binding directly to the DOM element is reliable.
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('application/x-workflow-image')) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      }
    };
    el.addEventListener('dragover', onDragOver);
    return () => el.removeEventListener('dragover', onDragOver);
  }, []);

  // Queue count polling (every 2s)
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/workflow/queue');
        if (res.ok) {
          const data = await res.json() as { running: unknown[]; pending: unknown[] };
          setQueueCount(data.running.length + data.pending.length);
        }
      } catch { /* ComfyUI not ready */ }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, []);

  // Close queue panel when clicking outside
  useEffect(() => {
    if (!isQueueOpen) return;
    const handler = (e: MouseEvent) => {
      if (queueWrapperRef.current && !queueWrapperRef.current.contains(e.target as Node)) {
        setIsQueueOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isQueueOpen]);

  // Same drop logic as TabSwitcher — copies selected image(s) to target tab
  const handleDrop = useCallback(async (e: React.DragEvent, targetTab: number) => {
    e.preventDefault();
    setDragOverTab(null);

    const imageId = e.dataTransfer.getData('application/x-workflow-image');
    if (!imageId) return;

    const state = useWorkflowStore.getState();
    const selectedIds = state.selectedImageIds;
    const idsToImport = selectedIds.length > 0 && selectedIds.includes(imageId)
      ? selectedIds
      : [imageId];

    let sourceTabId: number | null = null;
    for (const [key, tabEntry] of Object.entries(state.tabData)) {
      if (tabEntry.images.some((i) => idsToImport.includes(i.id))) {
        sourceTabId = Number(key);
        break;
      }
    }
    if (sourceTabId === null || sourceTabId === targetTab) return;

    const files: File[] = [];
    for (const id of idsToImport) {
      let file: File | null = null;
      for (const tabEntry of Object.values(state.tabData)) {
        const img = tabEntry.images.find((i) => i.id === id);
        if (!img) continue;
        const outputs = tabEntry.tasks[id]?.outputs ?? [];
        const selectedIdx = tabEntry.selectedOutputIndex?.[id] ?? (outputs.length - 1);
        if (outputs.length > 0 && selectedIdx !== -1) {
          const selected = outputs[selectedIdx] ?? outputs[outputs.length - 1];
          try {
            const res = await fetch(selected.url);
            const blob = await res.blob();
            file = new File([blob], selected.filename, { type: blob.type });
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
    <aside
      ref={asideRef}
      style={{
        width: 160,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        // No overflow:hidden here — the queue panel needs to overlay upward outside this element
      }}
    >
      {/* Workflow groups */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
        {GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 4 }}>
            {/* Group label */}
            <div style={{
              padding: '8px 16px 4px',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-text-secondary)',
              letterSpacing: '0.04em',
              userSelect: 'none',
            }}>
              {group.label}
            </div>

            {/* Workflow items */}
            {group.ids.map((id) => {
              const wf = workflows.find((w) => w.id === id);
              if (!wf) return null;
              const isActive = activeTab === id;
              const isDragOver = dragOverTab === id;
              const hasProcessing = Object.values(tabData[id]?.tasks ?? {}).some(
                (t) => t.status === 'processing',
              );
              const Icon = WORKFLOW_ICONS[id];
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverTab(id);
                  }}
                  onDragLeave={(e) => {
                    const related = e.relatedTarget as Node | null;
                    if (!e.currentTarget.contains(related)) setDragOverTab(null);
                  }}
                  onDrop={(e) => handleDrop(e, id)}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '11px 16px',
                    backgroundColor: isActive
                      ? 'var(--color-primary)'
                      : isDragOver
                      ? 'var(--color-surface-hover)'
                      : 'transparent',
                    color: isActive ? '#ffffff' : 'var(--color-text-secondary)',
                    border: 'none',
                    borderRadius: 0,
                    fontSize: '13px',
                    fontWeight: isActive ? 500 : 300,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background-color 0.15s, color 0.15s',
                  }}
                >
                  <Icon size={14} style={{ flexShrink: 0 }} />
                  <span style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {wf.name}
                  </span>
                  {hasProcessing && (
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: isActive ? '#ffffff' : 'var(--color-primary)',
                      flexShrink: 0,
                      animation: 'pulse 1.5s ease-in-out infinite',
                    }} />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Queue button at bottom */}
      <div
        ref={queueWrapperRef}
        style={{
          borderTop: '1px solid var(--color-border)',
          padding: '12px',
          position: 'relative',
        }}
      >
        <button
          onClick={() => setIsQueueOpen((v) => !v)}
          title="管理任务队列"
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '7px 12px',
            backgroundColor: isQueueOpen ? 'var(--color-surface-hover)' : 'transparent',
            color: isQueueOpen ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 16,
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <ListOrdered size={14} style={{ flexShrink: 0 }} />
          管理队列
          {queueCount > 0 && (
            <span style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              borderRadius: 9,
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              fontSize: '10px',
              fontWeight: 700,
              lineHeight: 1,
            }}>
              {queueCount}
            </span>
          )}
        </button>

        {/* Queue panel opens upward */}
        {isQueueOpen && (
          <QueuePanel
            onClose={() => setIsQueueOpen(false)}
            popupStyle={{
              top: 'auto',
              bottom: 'calc(100% + 4px)',
              left: 16,
              right: 'auto',
              width: 380,
            }}
          />
        )}
      </div>
    </aside>
  );
}
