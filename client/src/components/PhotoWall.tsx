import { useState, useCallback } from 'react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useMaskStore } from '../hooks/useMaskStore.js';
import { useDragStore } from '../hooks/useDragStore.js';
import { maskKey } from '../config/maskConfig.js';
import { ImageCard } from './ImageCard.js';
import { Play, Trash2, LayoutGrid, Type, Check, Minus, Eraser } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket.js';

type ViewSize = 'small' | 'medium' | 'large';

const VIEW_CONFIG: Record<ViewSize, { columnWidth: string; label: string }> = {
  small: { columnWidth: '180px', label: '小' },
  medium: { columnWidth: '280px', label: '中' },
  large: { columnWidth: '600px', label: '大' },
};

function getInitialViewSize(): ViewSize {
  const saved = localStorage.getItem('viewSize');
  if (saved === 'small' || saved === 'medium' || saved === 'large') return saved;
  return 'medium';
}

export function PhotoWall() {
  const images = useWorkflowStore((s) => s.tabData[s.activeTab]?.images ?? []);
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const clientId = useWorkflowStore((s) => s.clientId);
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

  const [viewSize, setViewSize] = useState<ViewSize>(getInitialViewSize);
  const [bulkPrompt, setBulkPrompt] = useState('');

  const isMultiSelectMode = selectedImageIds.length > 0;
  const selectedCount = selectedImageIds.length;
  const allSelected = images.length > 0 && selectedCount === images.length;
  const someSelected = selectedCount > 0 && selectedCount < images.length;

  const maskEntryToBlob = useCallback(async (entry: import('../hooks/useMaskStore.js').MaskEntry): Promise<Blob> => {
    const { data, workingWidth: w, workingHeight: h } = entry;
    const oc = new OffscreenCanvas(w, h);
    const ctx = oc.getContext('2d')!;
    const id = new ImageData(w, h);
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i + 3] > 0 ? 255 : 0;
      id.data[i]     = v;
      id.data[i + 1] = v;
      id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return oc.convertToBlob({ type: 'image/png' });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      clearSelection();
    } else {
      setSelectedImageIds(images.map((img) => img.id));
    }
  }, [allSelected, images, clearSelection, setSelectedImageIds]);

  const hasIdleSelected = images.some((img) => {
    if (!selectedImageIds.includes(img.id)) return false;
    const task = tasks[img.id];
    if (task && task.status !== 'idle') return false;
    if (activeTab === 5 && !masks[maskKey(img.id, -1)]) return false;
    return true;
  });

  const handleViewSizeChange = useCallback((size: ViewSize) => {
    setViewSize(size);
    localStorage.setItem('viewSize', size);
  }, []);

  const cycleViewSize = useCallback(() => {
    const next: Record<ViewSize, ViewSize> = { small: 'medium', medium: 'large', large: 'small' };
    handleViewSizeChange(next[viewSize]);
  }, [viewSize, handleViewSizeChange]);

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
          sendMessage({ type: 'register', promptId: data.promptId, workflowId: 5 });
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
        sendMessage({ type: 'register', promptId: data.promptId, workflowId: activeTab });
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
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--spacing-sm)',
        padding: 'var(--spacing-sm) var(--spacing-lg)',
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        flexShrink: 0,
      }}>
        {/* Left: multi-select bulk prompt (only in multi-select mode) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
          {isMultiSelectMode && (
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
                  borderRadius: 0,
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
                  color: 'var(--color-primary)',
                  border: '1px solid var(--color-primary)',
                  borderRadius: 0,
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

        {/* Right: action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
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
                color: 'var(--color-primary)',
                border: '1px solid var(--color-primary)',
                borderRadius: 0,
                fontSize: '12px',
                cursor: 'pointer',
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

          {isMultiSelectMode && (
            <button
              onClick={clearSelection}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs)',
                padding: 'var(--spacing-xs) var(--spacing-sm)',
                backgroundColor: 'transparent',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 0,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              取消多选
            </button>
          )}

          {isMultiSelectMode && (
            <button
              onClick={handleBatchDeleteMasks}
              title="删除所选图片下的所有蒙版"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs)',
                padding: 'var(--spacing-xs) var(--spacing-sm)',
                backgroundColor: 'transparent',
                color: 'var(--color-warning, #e8a020)',
                border: '1px solid var(--color-warning, #e8a020)',
                borderRadius: 0,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              <Eraser size={12} />
              删除蒙版
            </button>
          )}

          {isMultiSelectMode && (
            <button
              onClick={handleBatchDelete}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs)',
                padding: 'var(--spacing-xs) var(--spacing-sm)',
                backgroundColor: 'transparent',
                color: 'var(--color-error)',
                border: '1px solid var(--color-error)',
                borderRadius: 0,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              <Trash2 size={12} />
              {`删除 ${selectedCount} 个`}
            </button>
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
                borderRadius: 0,
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                opacity: clientId ? 1 : 0.5,
              }}
            >
              <Play size={12} />
              {`执行 ${selectedCount} 个`}
            </button>
          )}
        </div>
      </div>}

      {/* Content area: scrollable photo wall + view-size overlay */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* View size toggle — floating overlay top-right */}
        <div style={{ position: 'absolute', top: 8, right: 20, zIndex: 10 }}>
          <button
            onClick={cycleViewSize}
            title="切换视图大小"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 0,
              fontSize: '12px',
              cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
            }}
          >
            <LayoutGrid size={12} />
            {VIEW_CONFIG[viewSize].label}
          </button>
        </div>

        {/* Scrollable photo wall */}
        <div
          style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: 'var(--spacing-lg)' }}
          onClick={(e) => { if (isMultiSelectMode && e.target === e.currentTarget) clearSelection(); }}
        >
        <div
          style={{
            columns: `${VIEW_CONFIG[viewSize].columnWidth} auto`,
            columnGap: 'var(--spacing-md)',
          }}
          onClick={(e) => { if (isMultiSelectMode && e.target === e.currentTarget) clearSelection(); }}
        >
          {images.map((img) => (
            <div key={img.id} id={`card-${img.id}`} style={{ breakInside: 'avoid', marginBottom: 'var(--spacing-md)' }}>
              <ImageCard
                image={img}
                isMultiSelectMode={isMultiSelectMode}
                isSelected={selectedImageIds.includes(img.id)}
                isFlashing={flashingImageId === img.id}
                onLongPress={() => enterMultiSelect(img.id)}
                onToggleSelect={() => toggleImageSelection(img.id)}
              />
            </div>
          ))}
        </div>
      </div>
      </div>{/* end content wrapper */}

      {/* Drag-to-delete zone — shown at bottom center while any card or output is being dragged */}
      {dragging && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDeleteZoneDrop}
          style={{
            position: 'fixed',
            bottom: 56,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 28px',
            backgroundColor: 'rgba(239,68,68,0.12)',
            border: '2px dashed rgba(239,68,68,0.55)',
            color: 'rgba(239,68,68,0.9)',
            fontSize: '13px',
            fontWeight: 600,
            pointerEvents: 'all',
            backdropFilter: 'blur(4px)',
            animation: 'toast-fly-in 0.22s cubic-bezier(0.22,1,0.36,1) both',
          }}
        >
          <Trash2 size={15} />
          {dragging.type === 'card'
            ? (selectedImageIds.length > 1 && selectedImageIds.includes(dragging.imageId)
                ? `松开删除 ${selectedImageIds.length} 张图片`
                : '松开删除此图片')
            : '松开删除此结果'}
        </div>
      )}
    </div>
  );
}
