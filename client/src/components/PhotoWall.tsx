import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useMaskStore } from '../hooks/useMaskStore.js';
import { useDragStore } from '../hooks/useDragStore.js';
import { maskKey } from '../config/maskConfig.js';
import { ImageCard } from './ImageCard.js';
import { Play, Trash2, Type, Check, Minus, Eraser } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket.js';

export type ViewSize = 'small' | 'medium' | 'large';

export const VIEW_CONFIG: Record<ViewSize, { columnWidth: string; label: string; estimatedCardHeight: number }> = {
  small: { columnWidth: '180px', label: '小', estimatedCardHeight: 320 },
  medium: { columnWidth: '280px', label: '中', estimatedCardHeight: 450 },
  large: { columnWidth: '600px', label: '大', estimatedCardHeight: 600 },
};

// LazyCard: lightweight wrapper using IntersectionObserver for lazy rendering
const LazyCard = memo(function LazyCard({ children, estimatedHeight }: { children: React.ReactNode; estimatedHeight: number }) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const wasPlaceholder = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          // Once visible, stop observing to prevent flickering
          observer.unobserve(el);
        }
      },
      // Asymmetric rootMargin: small top (200px) to reduce upward content shift,
      // large bottom (1200px) to preload while scrolling down
      { rootMargin: '200px 0px 1200px 0px' }
    );
    
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Manual scroll compensation when transitioning from placeholder to real content
  useEffect(() => {
    if (isVisible && wasPlaceholder.current && ref.current) {
      wasPlaceholder.current = false;
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        
        const scrollContainer = el.closest('[data-photo-wall-scroll]') as HTMLElement | null;
        if (!scrollContainer) return;
        
        const rect = el.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        
        // If this card is above the viewport (its bottom is above the container's visible area)
        // its height change may have caused viewport shift - compensate scrollTop
        if (rect.bottom < containerRect.top) {
          const actualHeight = el.offsetHeight;
          const heightDiff = actualHeight - estimatedHeight;
          if (heightDiff > 0) {
            scrollContainer.scrollTop += heightDiff;
          }
        }
      });
    }
  }, [isVisible, estimatedHeight]);

  if (!isVisible) {
    return (
      <div
        ref={ref}
        style={{
          minHeight: estimatedHeight,
          borderRadius: 'var(--radius-lg, 12px)',
          background: 'rgba(128, 128, 128, 0.05)',
          overflowAnchor: 'none', // Don't use placeholder as scroll anchor
        }}
      />
    );
  }

  return (
    <div
      ref={ref}
      style={{}}
    >
      {children}
    </div>
  );
});

interface PhotoWallProps {
  viewSize: ViewSize;
}

export function PhotoWall({ viewSize }: PhotoWallProps) {
  const images = useWorkflowStore((s) => s.tabData[s.activeTab]?.images ?? []);
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const clientId = useWorkflowStore((s) => s.clientId);
  const sessionId = useWorkflowStore((s) => s.sessionId);
  const prompts = useWorkflowStore((s) => s.tabData[s.activeTab]?.prompts ?? {});
  const startTask = useWorkflowStore((s) => s.startTask);
  const tasks = useWorkflowStore((s) => s.tabData[s.activeTab]?.tasks ?? {});
  const removeImages = useWorkflowStore((s) => s.removeImages);
  const removeOutput = useWorkflowStore((s) => s.removeOutput);
  const setPrompts = useWorkflowStore((s) => s.setPrompts);
  const selectedImageIds = useWorkflowStore((s) => s.selectedImageIds);
  const setSelectedImageIds = useWorkflowStore((s) => s.setSelectedImageIds);
  const enterMultiSelect = useWorkflowStore((s) => s.enterMultiSelect);
  const toggleImageSelection = useWorkflowStore((s) => s.toggleImageSelection);
  const clearSelection = useWorkflowStore((s) => s.clearSelection);
  const flashingImageId = useWorkflowStore((s) => s.flashingImageId);
  const deleteMask = useMaskStore((s) => s.deleteMask);
  const masks = useMaskStore((s) => s.masks);
  const backPoseToggles = useWorkflowStore((s) => s.tabData[s.activeTab]?.backPoseToggles ?? {});
  const dragging = useDragStore((s) => s.dragging);
  const setDragging = useDragStore((s) => s.setDragging);
  const { sendMessage } = useWebSocket();

  const [bulkPrompt, setBulkPrompt] = useState('');
  const [isOverDeleteZone, setIsOverDeleteZone] = useState(false);
  const deleteZoneDragCount = useRef(0);

  // Reset hover state when drag ends
  useEffect(() => {
    if (!dragging) {
      deleteZoneDragCount.current = 0;
      setIsOverDeleteZone(false);
    }
  }, [dragging]);

  // Auto-scroll to bottom when a new card is generated (flashingImageId changes)
  useEffect(() => {
    if (!flashingImageId) return;
    const timer = setTimeout(() => {
      const container = document.querySelector('[data-photo-wall-scroll]');
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [flashingImageId]);

  const isMultiSelectMode = selectedImageIds.length > 0;
  const selectedCount = selectedImageIds.length;
  const allSelected = images.length > 0 && selectedCount === images.length;
  const someSelected = selectedCount > 0 && selectedCount < images.length;

  const maskEntryToBlob = useCallback(async (entry: import('../hooks/useMaskStore.js').MaskEntry): Promise<Blob> => {
    const { data, workingWidth: w, workingHeight: h, originalWidth: ow, originalHeight: oh } = entry;
    const working = new OffscreenCanvas(w, h);
    const ctx = working.getContext('2d')!;
    const id = new ImageData(w, h);
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i + 3] > 0 ? 255 : 0;
      id.data[i]     = v;
      id.data[i + 1] = v;
      id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    if (ow !== w || oh !== h) {
      const out = new OffscreenCanvas(ow, oh);
      out.getContext('2d')!.drawImage(working, 0, 0, ow, oh);
      return out.convertToBlob({ type: 'image/png' });
    }
    return working.convertToBlob({ type: 'image/png' });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      clearSelection();
    } else {
      setSelectedImageIds(images.map((img) => img.id));
    }
  }, [allSelected, images, clearSelection, setSelectedImageIds]);

  const hasIdleSelected = activeTab === 7 ? false : images.some((img) => {
    if (!selectedImageIds.includes(img.id)) return false;
    const task = tasks[img.id];
    if (task && task.status !== 'idle') return false;
    if ((activeTab === 5 || activeTab === 10) && !masks[maskKey(img.id, -1)]) return false;
    return true;
  });

  const handleBatchExecute = async () => {
    if (!clientId) return;
    const targetImages = isMultiSelectMode
      ? images.filter((img) => selectedImageIds.includes(img.id))
      : images;

    for (const img of targetImages) {
      const task = tasks[img.id];
      if (task && task.status !== 'idle') continue;

      // ── Workflow 5: 解除装备 ──────────────────────────────────────
      if (activeTab === 5) {
        const maskEntry = masks[maskKey(img.id, -1)];
        if (!maskEntry) continue; // skip: no mask painted for this image

        const maskBlob = await maskEntryToBlob(maskEntry);
        const backPose = backPoseToggles[img.id] ?? false;

        const formData = new FormData();
        formData.append('image',    img.file);
        formData.append('mask',     maskBlob, 'mask.png');
        formData.append('clientId', clientId);
        formData.append('prompt',   prompts[img.id] || '');
        formData.append('backPose', String(backPose));

        try {
          const res = await fetch(`/api/workflow/5/execute?clientId=${clientId}`, {
            method: 'POST',
            body: formData,
          });
          if (!res.ok) { console.error('Execute failed:', await res.text()); continue; }
          const data = await res.json();
          startTask(img.id, data.promptId);
          sendMessage({ type: 'register', promptId: data.promptId, workflowId: 5, sessionId, tabId: 5 });
        } catch (err) {
          console.error('Execute error:', err);
        }
        continue;
      }

      // ── Workflow 10: 区域编辑 ─────────────────────────────────────
      if (activeTab === 10) {
        const maskEntry = masks[maskKey(img.id, -1)];
        if (!maskEntry) continue; // skip: no mask painted for this image

        const maskBlob = await maskEntryToBlob(maskEntry);
        const backPose = backPoseToggles[img.id] ?? false;

        const formData = new FormData();
        formData.append('image',    img.file);
        formData.append('mask',     maskBlob, 'mask.png');
        formData.append('clientId', clientId);
        formData.append('prompt',   prompts[img.id] || '');
        formData.append('backPose', String(backPose));

        try {
          const res = await fetch(`/api/workflow/10/execute?clientId=${clientId}`, {
            method: 'POST',
            body: formData,
          });
          if (!res.ok) { console.error('Execute failed:', await res.text()); continue; }
          const data = await res.json();
          startTask(img.id, data.promptId);
          sendMessage({ type: 'register', promptId: data.promptId, workflowId: 10, sessionId, tabId: 10 });
        } catch (err) {
          console.error('Execute error:', err);
        }
        continue;
      }

      // ── Generic workflows ─────────────────────────────────────────
      const formData = new FormData();
      formData.append('image',    img.file);
      formData.append('clientId', clientId);
      formData.append('prompt',   prompts[img.id] || '');

      try {
        const res = await fetch(`/api/workflow/${activeTab}/execute?clientId=${clientId}`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) { console.error('Execute failed:', await res.text()); continue; }
        const data = await res.json();
        startTask(img.id, data.promptId);
        sendMessage({ type: 'register', promptId: data.promptId, workflowId: activeTab, sessionId, tabId: activeTab });
      } catch (err) {
        console.error('Execute error:', err);
      }
    }
  };

  const handleBatchDelete = useCallback(() => {
    if (!window.confirm(`确认删除所选的 ${selectedImageIds.length} 张图片？`)) return;
    removeImages(selectedImageIds);
  }, [selectedImageIds, removeImages]);

  const handleBulkReplacePrompts = useCallback(() => {
    const isEmpty = !bulkPrompt.trim();
    const msg = isEmpty
      ? `确认将所选 ${selectedImageIds.length} 张图片的提示词全部清空？`
      : `确认将所选 ${selectedImageIds.length} 张图片的提示词替换为「${bulkPrompt}」？`;
    if (!window.confirm(msg)) return;
    const updates: Record<string, string> = {};
    selectedImageIds.forEach((id) => { updates[id] = bulkPrompt; });
    setPrompts(updates);
  }, [bulkPrompt, selectedImageIds, setPrompts]);

  const handleBatchDeleteMasks = useCallback(() => {
    const keysToDelete = Object.keys(masks).filter((k) =>
      selectedImageIds.some((id) => k === maskKey(id, -1) || k.startsWith(id + ':'))
    );
    const count = keysToDelete.length;
    if (count === 0) { window.alert('所选图片没有蒙版。'); return; }
    if (!window.confirm(`确认删除所选 ${selectedImageIds.length} 张图片下的全部蒙版（共 ${count} 个）？`)) return;
    keysToDelete.forEach((k) => deleteMask(k));
  }, [masks, selectedImageIds, deleteMask]);

  const showExecuteButton = isMultiSelectMode && hasIdleSelected;

  const handleDeleteZoneDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const drag = dragging;
    setDragging(null);

    // Clean up dragging cursor state - handleDragEnd may not fire when dropping on delete zone
    document.body.classList.remove('is-dragging-card');

    // Fallback: read imageId from dataTransfer in case dragging state is stale
    const fallbackCardId = e.dataTransfer.getData('application/x-workflow-image');

    if (drag?.type === 'card' || (!drag && fallbackCardId)) {
      const imageId = drag?.imageId ?? fallbackCardId;
      const toDelete = selectedImageIds.includes(imageId)
        ? selectedImageIds
        : [imageId];
      for (const imgId of toDelete) {
        Object.keys(masks).forEach((k) => {
          if (k.startsWith(`${imgId}:`)) deleteMask(k);
        });
      }
      removeImages(toDelete);
      clearSelection();
    } else if (drag?.type === 'output') {
      removeOutput(drag.imageId, drag.outputIndex);
      // Clean up Mode B mask for this specific output index
      deleteMask(maskKey(drag.imageId, drag.outputIndex));
    }
  }, [dragging, selectedImageIds, masks, removeImages, removeOutput, deleteMask, clearSelection, setDragging]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar — only visible in multi-select mode */}
      {isMultiSelectMode && <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-sm)',
        padding: 'var(--spacing-sm) var(--spacing-lg)',
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        flexShrink: 0,
      }}>
        {/* 全选按钮 */}
        {isMultiSelectMode && (
          <button
            onClick={handleSelectAll}
            title={allSelected ? '取消全选' : '全选'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-xs)',
              padding: 'var(--spacing-xs) var(--spacing-sm)',
              backgroundColor: 'transparent',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              fontSize: '12px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {/* Three-state checkbox visual */}
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 13,
              height: 13,
              border: '1.5px solid currentColor',
              borderRadius: 2,
              backgroundColor: allSelected ? 'currentColor' : 'transparent',
              flexShrink: 0,
            }}>
              {allSelected && <Check size={9} color="var(--color-surface)" strokeWidth={3} />}
              {someSelected && <Minus size={9} strokeWidth={3} />}
            </span>
            全选
          </button>
        )}

        {/* 分割线 1 */}
        <div style={{ width: 1, height: 20, backgroundColor: 'var(--color-border)', marginLeft: 4, marginRight: 4 }} />

        {/* Left: multi-select bulk prompt — hidden for tab 7 (text2img has no per-card prompt editing) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
          {isMultiSelectMode && activeTab !== 7 && (
            <>
              <input
                type="text"
                placeholder="批量替换提示词..."
                value={bulkPrompt}
                onChange={(e) => setBulkPrompt(e.target.value)}
                style={{
                  height: 26,
                  padding: 'var(--spacing-xs) var(--spacing-sm)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: '12px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  width: '200px',
                }}
              />
              <button
                onClick={handleBulkReplacePrompts}
                title="替换所有选中图片的提示词（可为空以清空）"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--spacing-xs)',
                  padding: 'var(--spacing-xs) var(--spacing-sm)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  fontSize: '12px',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <Type size={12} />
                批量替换
              </button>
            </>
          )}
        </div>

        {/* 分隔符 - 伸缩，将左侧按钮推向左边 */}
        <div style={{ flex: 1 }} />

        {/* Right: 清空蒙版和执行按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
          {isMultiSelectMode && activeTab !== 7 && (
            <button
              onClick={handleBatchDeleteMasks}
              title="删除所选图片下的所有蒙版"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs)',
                padding: 'var(--spacing-xs) var(--spacing-sm)',
                backgroundColor: '#f44336',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                fontSize: '12px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Eraser size={12} />
              清空蒙版
            </button>
          )}

          {/* 分割线 2 */}
          {showExecuteButton && (
            <div style={{ width: 1, height: 20, backgroundColor: 'var(--color-border)', marginLeft: 4, marginRight: 4 }} />
          )}

          {showExecuteButton && (
            <button
              onClick={handleBatchExecute}
              disabled={!clientId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs)',
                padding: 'var(--spacing-xs) var(--spacing-sm)',
                backgroundColor: 'var(--color-primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                opacity: clientId ? 1 : 0.5,
                flexShrink: 0,
              }}
            >
              <Play size={12} />
              {`执行 ${selectedCount} 个`}
            </button>
          )}
        </div>
      </div>}

      {/* Scrollable photo wall */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div
          className="photowall-bg"
          data-photo-wall-scroll
          style={{
            position: 'absolute',
            inset: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            scrollbarGutter: 'stable',
            padding: 'var(--spacing-lg)',
            overflowAnchor: 'auto', // Enable CSS scroll anchoring
          }}
          onClick={(e) => { if (isMultiSelectMode && e.target === e.currentTarget) clearSelection(); }}
        >
        {/* Tab 7 empty state */}
        {images.length === 0 && activeTab === 7 && (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-secondary)',
            fontSize: '14px',
            opacity: 0.5,
            userSelect: 'none',
          }}>
            点击右侧生成按钮开始创作
          </div>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${VIEW_CONFIG[viewSize].columnWidth}, 1fr))`,
            gap: 'var(--spacing-md)',
            alignItems: 'start',
          }}
          onClick={(e) => { if (isMultiSelectMode && e.target === e.currentTarget) clearSelection(); }}
        >
          {images.map((img) => (
            <LazyCard key={img.id} estimatedHeight={VIEW_CONFIG[viewSize].estimatedCardHeight}>
              <div id={`card-${img.id}`}>
                <ImageCard
                  image={img}
                  isMultiSelectMode={isMultiSelectMode}
                  isSelected={selectedImageIds.includes(img.id)}
                  isFlashing={flashingImageId === img.id}
                  onLongPress={() => enterMultiSelect(img.id)}
                  onToggleSelect={() => toggleImageSelection(img.id)}
                />
              </div>
            </LazyCard>
          ))}
        </div>
      </div>
      </div>{/* end content wrapper */}

      {/* Drag-to-delete zone — shown at bottom center while any card or output is being dragged */}
      {dragging && (
        <>
          {/* Bottom gradient for readability behind the delete zone */}
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              height: 180,
              background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%)',
              pointerEvents: 'none',
              zIndex: 499,
              animation: 'fade-in 0.22s ease both',
            }}
          />
          <div
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={() => {
              deleteZoneDragCount.current++;
              setIsOverDeleteZone(true);
            }}
            onDragLeave={() => {
              deleteZoneDragCount.current--;
              if (deleteZoneDragCount.current <= 0) {
                deleteZoneDragCount.current = 0;
                setIsOverDeleteZone(false);
              }
            }}
            onDrop={handleDeleteZoneDrop}
            style={{
              position: 'fixed',
              bottom: 40,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '18px 56px',
              minWidth: 340,
              justifyContent: 'center',
              backgroundColor: isOverDeleteZone ? 'rgba(239,68,68,0.28)' : 'rgba(239,68,68,0.1)',
              border: `2px dashed ${isOverDeleteZone ? 'rgba(239,68,68,1)' : 'rgba(239,68,68,0.5)'}`,
              borderRadius: 12,
              color: isOverDeleteZone ? '#ff6b6b' : 'rgba(239,68,68,0.85)',
              fontSize: '14px',
              fontWeight: 600,
              pointerEvents: 'all',
              backdropFilter: 'blur(6px)',
              transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
              animation: 'delete-zone-in 0.22s cubic-bezier(0.22,1,0.36,1) both',
            }}
          >
            <Trash2 size={18} />
            {dragging.type === 'card'
              ? (selectedImageIds.length > 1 && selectedImageIds.includes(dragging.imageId)
                  ? `松开删除 ${selectedImageIds.length} 张图片`
                  : '松开删除此图片')
              : '松开删除此结果'}
          </div>
        </>
      )}
    </div>
  );
}
