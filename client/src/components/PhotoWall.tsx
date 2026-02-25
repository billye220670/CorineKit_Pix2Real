import { useState, useCallback } from 'react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useMaskStore } from '../hooks/useMaskStore.js';
import { maskKey } from '../config/maskConfig.js';
import { ImageCard } from './ImageCard.js';
import { Play, Trash2, FolderOpen, LayoutGrid, Type, Check, Minus, Eraser } from 'lucide-react';
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
  const clearCurrentImages = useWorkflowStore((s) => s.clearCurrentImages);
  const removeImages = useWorkflowStore((s) => s.removeImages);
  const setPrompts = useWorkflowStore((s) => s.setPrompts);
  const selectedImageIds = useWorkflowStore((s) => s.selectedImageIds);
  const setSelectedImageIds = useWorkflowStore((s) => s.setSelectedImageIds);
  const enterMultiSelect = useWorkflowStore((s) => s.enterMultiSelect);
  const toggleImageSelection = useWorkflowStore((s) => s.toggleImageSelection);
  const clearSelection = useWorkflowStore((s) => s.clearSelection);
  const flashingImageId = useWorkflowStore((s) => s.flashingImageId);
  const deleteMask = useMaskStore((s) => s.deleteMask);
  const masks = useMaskStore((s) => s.masks);
  const { sendMessage } = useWebSocket();

  const [viewSize, setViewSize] = useState<ViewSize>(getInitialViewSize);
  const [bulkPrompt, setBulkPrompt] = useState('');

  const isMultiSelectMode = selectedImageIds.length > 0;
  const selectedCount = selectedImageIds.length;
  const allSelected = images.length > 0 && selectedCount === images.length;
  const someSelected = selectedCount > 0 && selectedCount < images.length;

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      clearSelection();
    } else {
      setSelectedImageIds(images.map((img) => img.id));
    }
  }, [allSelected, images, clearSelection, setSelectedImageIds]);

  const hasIdle = images.some((img) => {
    const task = tasks[img.id];
    return !task || task.status === 'idle';
  });

  const hasIdleSelected = images.some((img) => {
    if (!selectedImageIds.includes(img.id)) return false;
    const task = tasks[img.id];
    return !task || task.status === 'idle';
  });

  const handleViewSizeChange = useCallback((size: ViewSize) => {
    setViewSize(size);
    localStorage.setItem('viewSize', size);
  }, []);

  const cycleViewSize = useCallback(() => {
    const next: Record<ViewSize, ViewSize> = { small: 'medium', medium: 'large', large: 'small' };
    handleViewSizeChange(next[viewSize]);
  }, [viewSize, handleViewSizeChange]);

  const handleOpenFolder = useCallback(async () => {
    try {
      await fetch(`/api/workflow/${activeTab}/open-folder`, { method: 'POST' });
    } catch (err) {
      console.error('Open folder error:', err);
    }
  }, [activeTab]);

  const handleBatchExecute = async () => {
    if (!clientId) return;
    const targetImages = isMultiSelectMode
      ? images.filter((img) => selectedImageIds.includes(img.id))
      : images;

    for (const img of targetImages) {
      const task = tasks[img.id];
      if (task && task.status !== 'idle') continue;

      const formData = new FormData();
      formData.append('image', img.file);
      formData.append('clientId', clientId);
      formData.append('prompt', prompts[img.id] || '');

      try {
        const res = await fetch(`/api/workflow/${activeTab}/execute?clientId=${clientId}`, {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          console.error('Execute failed:', await res.text());
          continue;
        }

        const data = await res.json();
        startTask(img.id, data.promptId);

        sendMessage({
          type: 'register',
          promptId: data.promptId,
          workflowId: activeTab,
        });
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

  const showExecuteButton = isMultiSelectMode ? hasIdleSelected : hasIdle;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--spacing-sm)',
        padding: 'var(--spacing-sm) var(--spacing-lg)',
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        flexShrink: 0,
      }}>
        {/* Left: view size toggle + multi-select bulk prompt */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
          <button
            onClick={cycleViewSize}
            title="切换视图大小"
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
              flexShrink: 0,
            }}
          >
            <LayoutGrid size={12} />
            {VIEW_CONFIG[viewSize].label}
          </button>

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

          {!isMultiSelectMode && (
            <button
              onClick={handleOpenFolder}
              title="打开输出文件夹"
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
              <FolderOpen size={12} />
              打开文件夹
            </button>
          )}

          <button
            onClick={isMultiSelectMode ? handleBatchDelete : () => { if (window.confirm('清空当前所有图片？')) clearCurrentImages(); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-xs)',
              padding: 'var(--spacing-xs) var(--spacing-sm)',
              backgroundColor: 'transparent',
              color: isMultiSelectMode ? 'var(--color-error)' : 'var(--color-text-secondary)',
              border: '1px solid',
              borderColor: isMultiSelectMode ? 'var(--color-error)' : 'var(--color-border)',
              borderRadius: 0,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            <Trash2 size={12} />
            {isMultiSelectMode ? `删除 ${selectedCount} 个` : '清空'}
          </button>

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
              {isMultiSelectMode ? `执行 ${selectedCount} 个` : '全部执行'}
            </button>
          )}
        </div>
      </div>

      {/* Scrollable photo wall */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-lg)' }}>
        <div style={{
          columns: `auto ${VIEW_CONFIG[viewSize].columnWidth}`,
          columnGap: 'var(--spacing-md)',
        }}>
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
    </div>
  );
}
