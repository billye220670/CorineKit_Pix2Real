import { useCallback, useState, useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useDragStore } from '../hooks/useDragStore.js';
import { showToast } from '../hooks/useToast.js';
import { QueuePanel } from './QueuePanel.js';
import {
  Wand2, Sparkles, ZoomIn, Scissors, Video, Maximize2, ListOrdered, Palette, ImagePlus, UserRound, Zap, PenSquare,
} from 'lucide-react';

const GROUPS: { label: string; ids: number[] }[] = [
  { label: '图像生成', ids: [7, 9] },
  { label: '图像处理', ids: [2] },
  { label: '风格转换', ids: [0, 6] },
  { label: '区域重绘', ids: [1, 5, 8, 10] },
  // { label: '视频处理', ids: [3, 4] },  // 暂时屏蔽
];

const WORKFLOW_ICONS: Record<number, LucideIcon> = {
  0: Wand2,
  1: Sparkles,
  2: ZoomIn,
  3: Video,
  4: Maximize2,
  5: Scissors,
  6: Palette,
  7: ImagePlus,
  8: UserRound,
  9: Zap,
  10: PenSquare,
};

export function Sidebar() {
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const workflows = useWorkflowStore((s) => s.workflows);
  const setActiveTab = useWorkflowStore((s) => s.setActiveTab);
  const tabData = useWorkflowStore((s) => s.tabData);
  const addImagesToTab = useWorkflowStore((s) => s.addImagesToTab);

  const [dragOverTab, setDragOverTab] = useState<number | null>(null);
  const dragging = useDragStore((s) => s.dragging);
  const isAnyDragging = dragging !== null;
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isQueueClosing, setIsQueueClosing] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const queueWrapperRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const buttonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const hasInitialized = useRef(false);
  const [indicatorStyle, setIndicatorStyle] = useState<{ top: number; height: number; animate: boolean } | null>(null);

  // Native dragover listener — React's synthetic events can miss preventDefault()
  // for drag events; binding directly to the DOM element is reliable.
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const onDragOver = (e: DragEvent) => {
      const hasCard = e.dataTransfer?.types.includes('application/x-workflow-image');
      const hasThumb = e.dataTransfer?.types.includes('application/x-thumb-output');
      if (hasCard || hasThumb) {
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

  // Compute floating indicator position for active tab
  useEffect(() => {
    const nav = navRef.current;
    const btn = buttonRefs.current.get(activeTab);
    if (!nav || !btn) return;
    const navRect = nav.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setIndicatorStyle({
      top: btnRect.top - navRect.top + nav.scrollTop,
      height: btnRect.height,
      animate: hasInitialized.current,
    });
    hasInitialized.current = true;
  }, [activeTab]);

  const openQueue = useCallback(() => {
    setIsQueueClosing(false);
    setIsQueueOpen(true);
  }, []);

  const closeQueue = useCallback(() => {
    setIsQueueClosing(true);
    setTimeout(() => {
      setIsQueueOpen(false);
      setIsQueueClosing(false);
    }, 150);
  }, []);

  // Close queue panel when clicking outside
  useEffect(() => {
    if (!isQueueOpen) return;
    const handler = (e: MouseEvent) => {
      if (queueWrapperRef.current && !queueWrapperRef.current.contains(e.target as Node)) {
        closeQueue();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isQueueOpen, closeQueue]);

  // Copies selected image(s) to target tab
  const handleDrop = useCallback(async (e: React.DragEvent, targetTab: number) => {
    e.preventDefault();
    setDragOverTab(null);

    // Clean up dragging cursor state - handleDragEnd may not fire when dropping on sidebar
    document.body.classList.remove('is-dragging-card');

    // Tab 7 is text-to-image only; it does not accept image drops
    if (targetTab === 7) return;
    // Tab 9 is text-to-image only; it does not accept image drops
    if (targetTab === 9) return;

    const imageId = e.dataTransfer.getData('application/x-workflow-image');
    if (imageId) {
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
      return;
    }

    // Handle output thumbnail drag
    if (e.dataTransfer.types.includes('application/x-thumb-output')) {
      const dragState = useDragStore.getState();
      if (dragState.dragging?.type !== 'output') return;
      const { imageId: srcImageId, outputIndex } = dragState.dragging;
      const state = useWorkflowStore.getState();
      let file: File | null = null;
      for (const tabEntry of Object.values(state.tabData)) {
        const img = tabEntry.images.find((i) => i.id === srcImageId);
        if (!img) continue;
        const outputs = tabEntry.tasks[srcImageId]?.outputs ?? [];
        const output = outputs[outputIndex];
        if (output) {
          try {
            const res = await fetch(output.url);
            const blob = await res.blob();
            file = new File([blob], output.filename, { type: blob.type });
          } catch { /* skip */ }
        }
        break;
      }
      if (!file) return;
      addImagesToTab(targetTab, [file]);
      const targetName = state.workflows.find((w) => w.id === targetTab)?.name ?? '';
      showToast(`已导入到「${targetName}」`);
    }
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
      <nav
        ref={navRef}
        onDragOver={(e) => {
          const hasCard = e.dataTransfer.types.includes('application/x-workflow-image');
          const hasThumb = e.dataTransfer.types.includes('application/x-thumb-output');
          if (hasCard || hasThumb) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
        }}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0', position: 'relative' }}
      >
        {/* Floating active indicator */}
        {indicatorStyle && (
          <div
            style={{
              position: 'absolute',
              left: 8,
              right: 8,
              top: indicatorStyle.top,
              height: indicatorStyle.height,
              backgroundColor: 'rgba(33, 150, 243, 0.13)',
              borderRadius: 8,
              transition: indicatorStyle.animate
                ? 'top 0.22s cubic-bezier(0.4, 0, 0.2, 1), height 0.22s cubic-bezier(0.4, 0, 0.2, 1)'
                : 'none',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        )}
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
              const isDropTarget = isDragOver && isAnyDragging;
              return (
                <button
                  key={id}
                  ref={(el) => {
                    if (el) buttonRefs.current.set(id, el);
                    else buttonRefs.current.delete(id);
                  }}
                  onClick={() => setActiveTab(id)}
                  onDragOver={(e) => {
                    const hasCard = e.dataTransfer.types.includes('application/x-workflow-image');
                    const hasThumb = e.dataTransfer.types.includes('application/x-thumb-output');
                    if (!hasCard && !hasThumb) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverTab(id);
                  }}
                  onDragLeave={(e) => {
                    const related = e.relatedTarget as Node | null;
                    if (!e.currentTarget.contains(related)) setDragOverTab(null);
                  }}
                  onDrop={(e) => handleDrop(e, id)}
                  data-drop-target={isDropTarget ? 'true' : undefined}
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: 'calc(100% - 16px)',
                    margin: '2px 8px',
                    padding: '9px 12px',
                    backgroundColor: isDropTarget
                      ? 'rgba(33, 150, 243, 0.18)'
                      : isDragOver
                        ? 'var(--color-surface-hover)'
                        : 'transparent',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    border: 'none',
                    boxShadow: isDropTarget ? 'inset 0 0 0 1.5px rgba(33,150,243,0.55)' : 'none',
                    borderRadius: 8,
                    fontSize: '13px',
                    fontWeight: isActive ? 500 : 300,
                    cursor: 'pointer',
                    textAlign: 'left',
                    opacity: isActive ? 1 : 0.75,
                    transition: 'background-color 0.15s, color 0.15s, opacity 0.15s, box-shadow 0.15s',
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
                  {!isDropTarget && hasProcessing && (
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-primary)',
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
          onClick={() => isQueueOpen ? closeQueue() : openQueue()}
          title="管理任务队列"
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '7px 12px',
            backgroundColor: isQueueOpen ? 'var(--color-surface-hover)' : 'transparent',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            fontSize: '13px',
            fontWeight: 300,
            cursor: 'pointer',
            opacity: isQueueOpen ? 1 : 0.75,
            transition: 'background-color 0.15s, opacity 0.15s',
          }}
        >
          <ListOrdered size={14} style={{ flexShrink: 0 }} />
          管理队列
          {queueCount > 0 && (
            <span style={{
              position: 'absolute',
              top: -6,
              right: -6,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 8,
              backgroundColor: '#2196F3',
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
            onClose={closeQueue}
            closing={isQueueClosing}
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
