import { useState, useCallback, useRef } from 'react';
import { X, Check, Trash2, Ban } from 'lucide-react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { ImageCard } from './ImageCard.js';
import { showToast } from '../hooks/useToast.js';
import type { ViewSize } from './PhotoWall.js';
import type { ImageItem } from '../types/index.js';

interface FaceSwapPhotoWallProps {
  viewSize: ViewSize;
}

// View size configuration for FaceSwap layout
const FACE_SWAP_VIEW_CONFIG: Record<ViewSize, { cardSize: string; faceGap: number; facePadding: string; faceZoneWidth: string }> = {
  small: { cardSize: '160px', faceGap: 6, facePadding: '8px 6px', faceZoneWidth: '10%' },
  medium: { cardSize: '240px', faceGap: 8, facePadding: '10px 8px', faceZoneWidth: '15%' },
  large: { cardSize: '400px', faceGap: 12, facePadding: '14px 12px', faceZoneWidth: '20%' },
};

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

// Minimal card for face zone images
interface FaceZoneCardProps {
  image: ImageItem;
  isMultiSelectMode: boolean;
  isSelected: boolean;
  onLongPress: () => void;
  onToggleSelect: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
}

function FaceZoneCard({ image, isMultiSelectMode, isSelected, onLongPress, onToggleSelect, onDelete, onDragStart }: FaceZoneCardProps) {
  const [isCardHovered, setIsCardHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      longPressTimer.current = null;
      onLongPress();
    }, 600);
  }, [onLongPress]);

  const handleMouseUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    if (!isMultiSelectMode) return;
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    onToggleSelect();
  }, [isMultiSelectMode, onToggleSelect]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    onDragStart(e);
    setIsDragging(true);
  }, [onDragStart]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div
      draggable={true}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => {
        setIsCardHovered(false);
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }}
      style={{
        position: 'relative',
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        borderRadius: 10,
        overflow: 'hidden',
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        transform: isCardHovered && !isDragging ? 'translateY(-3px)' : 'none',
        transition: 'opacity 0.15s, box-shadow 0.2s ease, transform 0.2s ease',
        boxShadow: isSelected
          ? '0 0 0 2px var(--color-primary)'
          : isCardHovered && !isDragging
            ? '0 8px 24px rgba(0,0,0,0.2)'
            : 'none',
        userSelect: 'none',
      }}
    >
      {/* Image */}
      <div
        style={{ position: 'relative', cursor: isMultiSelectMode ? 'pointer' : 'grab' }}
        onClick={handleClick}
      >
        <img
          src={image.previewUrl}
          alt={image.originalName}
          draggable={false}
          style={{ width: '100%', display: 'block' }}
        />

        {/* Dim overlay for unselected in multi-select */}
        {isMultiSelectMode && !isSelected && (
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }} />
        )}

        {/* Multi-select checkmark */}
        {isMultiSelectMode && (
          <div style={{
            position: 'absolute',
            top: 'var(--spacing-sm)',
            right: 'var(--spacing-sm)',
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: '2px solid',
            borderColor: isSelected ? 'var(--color-primary)' : 'rgba(255,255,255,0.8)',
            backgroundColor: isSelected ? 'var(--color-primary)' : 'rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            {isSelected && <Check size={11} color="#fff" strokeWidth={3} />}
          </div>
        )}

        {/* Drag hint badge */}
        {!isMultiSelectMode && isCardHovered && (
          <div style={{
            position: 'absolute',
            bottom: 6,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0,0,0,0.7)',
            color: '#e5e7eb',
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 4,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}>
            拖到目标图上换脸
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: 'var(--spacing-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span style={{
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {image.originalName}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="删除"
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 4,
            background: 'transparent',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            opacity: 0.7,
          }}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

export function FaceSwapPhotoWall({ viewSize }: FaceSwapPhotoWallProps) {
  const config = FACE_SWAP_VIEW_CONFIG[viewSize];
  const images = useWorkflowStore((s) => s.tabData[8]?.images ?? []);
  const faceSwapZones = useWorkflowStore((s) => s.tabData[8]?.faceSwapZones ?? {});
  const tasks = useWorkflowStore((s) => s.tabData[8]?.tasks ?? {});
  const clientId = useWorkflowStore((s) => s.clientId);
  const sessionId = useWorkflowStore((s) => s.sessionId);
  const selectedImageIds = useWorkflowStore((s) => s.selectedImageIds);
  const addImagesGetIds = useWorkflowStore((s) => s.addImagesGetIds);
  const addImages = useWorkflowStore((s) => s.addImages);
  const removeImages = useWorkflowStore((s) => s.removeImages);
  const setFaceSwapZone = useWorkflowStore((s) => s.setFaceSwapZone);
  const startTask = useWorkflowStore((s) => s.startTask);
  const enterMultiSelect = useWorkflowStore((s) => s.enterMultiSelect);
  const toggleImageSelection = useWorkflowStore((s) => s.toggleImageSelection);
  const clearSelection = useWorkflowStore((s) => s.clearSelection);
  const { sendMessage } = useWebSocket();

  // Track which zone multi-select originated from
  const [multiSelectZone, setMultiSelectZone] = useState<'face' | 'target' | null>(null);

  // Drag-over highlight for target cards
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null);
  const dragEnterCounters = useRef<Record<string, number>>({});

  // Hover tracking for target card drag hint
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);

  // Zone file drop states
  const [isDragOverFaceZone, setIsDragOverFaceZone] = useState(false);
  const [isDragOverTargetZone, setIsDragOverTargetZone] = useState(false);
  const faceZoneDragCount = useRef(0);
  const targetZoneDragCount = useRef(0);

  // Drag-over highlight for face cards (when a target card is dragged onto them)
  const [dragOverFaceCardId, setDragOverFaceCardId] = useState<string | null>(null);
  const faceCardDragCounters = useRef<Record<string, number>>({});

  const faceImages = images.filter((img) => faceSwapZones[img.id] === 'face');
  const targetImages = images.filter((img) => faceSwapZones[img.id] !== 'face');

  const isMultiSelectMode = selectedImageIds.length > 0;

  // Execute a face-swap task: faceImage dropped on targetImage
  const executeFaceSwap = useCallback(async (faceImg: ImageItem, targetImg: ImageItem) => {
    if (!clientId) return;

    const formData = new FormData();
    formData.append('targetImage', targetImg.file, targetImg.originalName);
    formData.append('faceImage', faceImg.file, faceImg.originalName);
    formData.append('clientId', clientId);

    try {
      const res = await fetch(`/api/workflow/8/execute?clientId=${clientId}`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        console.error('FaceSwap execute failed:', await res.text());
        showToast('换脸执行失败');
        return;
      }
      const data = await res.json() as { promptId: string };
      startTask(targetImg.id, data.promptId);
      sendMessage({ type: 'register', promptId: data.promptId, workflowId: 8, sessionId, tabId: 8 });
    } catch (err) {
      console.error('FaceSwap execute error:', err);
      showToast('换脸执行失败');
    }
  }, [clientId, sessionId, startTask, sendMessage]);

  // Handle drop of face card onto a target card
  const handleTargetCardDrop = useCallback(async (e: React.DragEvent, targetImg: ImageItem) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTargetId(null);
    dragEnterCounters.current[targetImg.id] = 0;

    const faceImageId = e.dataTransfer.getData('application/x-face-swap-face');
    if (!faceImageId) return;

    const faceImg = images.find((i) => i.id === faceImageId);
    if (!faceImg) return;

    const task = tasks[targetImg.id];
    if (task?.status === 'processing' || task?.status === 'queued') {
      showToast('目标图正在处理中，请等待完成');
      return;
    }

    // Multi-select: block face-swap when multiple faces are selected
    if (isMultiSelectMode && multiSelectZone === 'face') return;

    await executeFaceSwap(faceImg, targetImg);
  }, [images, tasks, isMultiSelectMode, multiSelectZone, selectedImageIds, faceSwapZones, clearSelection, executeFaceSwap]);

  // Handle drop of external files into face zone, or target card cross-import
  const handleFaceZoneDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverFaceZone(false);
    faceZoneDragCount.current = 0;

    // Cross-import: target card dragged into face zone — copy image into face zone
    const targetImageId = e.dataTransfer.getData('application/x-face-swap-target');
    if (targetImageId) {
      const srcImg = images.find((i) => i.id === targetImageId);
      if (srcImg) {
        const [newId] = addImagesGetIds([srcImg.file]);
        setFaceSwapZone(newId, 'face');
      }
      return;
    }

    // External file drop
    if (!e.dataTransfer.types.includes('Files')) return;
    const files = Array.from(e.dataTransfer.files).filter(isImageFile);
    if (files.length === 0) return;
    const ids = addImagesGetIds(files);
    ids.forEach((id) => setFaceSwapZone(id, 'face'));
  }, [images, addImagesGetIds, setFaceSwapZone]);

  // Handle drop of external files into target zone, or face card cross-import to target
  const handleTargetZoneDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverTargetZone(false);
    targetZoneDragCount.current = 0;

    // Cross-import: face card dragged to target zone background — copy image into target zone
    const faceImageId = e.dataTransfer.getData('application/x-face-swap-face');
    if (faceImageId) {
      const srcImg = images.find((i) => i.id === faceImageId);
      if (srcImg) addImages([srcImg.file]); // new entry defaults to target zone
      return;
    }

    // External file drop
    if (!e.dataTransfer.types.includes('Files')) return;
    const files = Array.from(e.dataTransfer.files).filter(isImageFile);
    if (files.length === 0) return;
    addImages(files);
  }, [images, addImages, setFaceSwapZone]);

  const handleFaceZoneDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-face-swap-target')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleTargetZoneDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-face-swap-face')) {
      e.preventDefault();
      // face card uses effectAllowed='copy', must match
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  // Long-press in face zone
  const handleFaceLongPress = useCallback((imageId: string) => {
    if (multiSelectZone !== null && multiSelectZone !== 'face') return;
    setMultiSelectZone('face');
    enterMultiSelect(imageId);
  }, [multiSelectZone, enterMultiSelect]);

  // Long-press in target zone
  const handleTargetLongPress = useCallback((imageId: string) => {
    if (multiSelectZone !== null && multiSelectZone !== 'target') return;
    setMultiSelectZone('target');
    enterMultiSelect(imageId);
  }, [multiSelectZone, enterMultiSelect]);

  const handleClearSelection = useCallback(() => {
    clearSelection();
    setMultiSelectZone(null);
  }, [clearSelection]);

  // Delete selected images
  const handleDeleteSelected = useCallback(() => {
    removeImages(selectedImageIds);
    handleClearSelection();
  }, [selectedImageIds, removeImages, handleClearSelection]);

  // Face drag start handler
  const handleFaceDragStart = useCallback((e: React.DragEvent, imageId: string) => {
    e.dataTransfer.setData('application/x-face-swap-face', imageId);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  // Handle drop of a target card onto a face card — triggers face-swap
  const handleFaceCardDrop = useCallback(async (e: React.DragEvent, faceImg: ImageItem) => {
    e.preventDefault();
    e.stopPropagation(); // prevent face zone's cross-import drop from also firing
    setDragOverFaceCardId(null);
    faceCardDragCounters.current[faceImg.id] = 0;
    // Also clear the face zone highlight that was set when drag entered the zone
    setIsDragOverFaceZone(false);
    faceZoneDragCount.current = 0;

    const targetImageId = e.dataTransfer.getData('application/x-face-swap-target');
    if (!targetImageId) return;

    if (isMultiSelectMode && multiSelectZone === 'target' && selectedImageIds.includes(targetImageId)) {
      // Multi-select: queue face-swap for every selected target card using this face
      const selectedTargetIds = selectedImageIds.filter((id) => faceSwapZones[id] !== 'face');
      clearSelection();
      setMultiSelectZone(null);
      let queued = 0;
      for (const targetId of selectedTargetIds) {
        const targetImg = images.find((i) => i.id === targetId);
        if (!targetImg) continue;
        const task = tasks[targetId];
        if (task?.status === 'processing' || task?.status === 'queued') continue;
        await executeFaceSwap(faceImg, targetImg);
        queued++;
      }
      if (queued > 0) showToast(`已队列 ${queued} 个换脸任务`);
    } else {
      const targetImg = images.find((i) => i.id === targetImageId);
      if (!targetImg) return;
      const task = tasks[targetImg.id];
      if (task?.status === 'processing' || task?.status === 'queued') {
        showToast('目标图正在处理中，请等待完成');
        return;
      }
      await executeFaceSwap(faceImg, targetImg);
    }
  }, [images, tasks, isMultiSelectMode, multiSelectZone, selectedImageIds, faceSwapZones, clearSelection, executeFaceSwap]);

  const selectedCount = selectedImageIds.length;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden',
    }}>
      {/* Multi-select toolbar */}
      {isMultiSelectMode && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 16px',
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            已选 {selectedCount} 张（{multiSelectZone === 'face' ? '脸部参考' : '目标图'}区）
          </span>
          <button
            onClick={handleDeleteSelected}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              backgroundColor: 'var(--color-error, #ef4444)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <Trash2 size={13} />
            删除
          </button>
          <button
            onClick={handleClearSelection}
            style={{
              padding: '4px 10px',
              backgroundColor: 'transparent',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            取消选择
          </button>
          {multiSelectZone === 'face' && (
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>
              拖动任意选中的脸部图到目标图上，可批量换脸
            </span>
          )}
        </div>
      )}

      {/* Main split layout */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left: Face zone */}
        <div
          style={{
            width: config.faceZoneWidth,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--color-border)',
            backgroundColor: isDragOverFaceZone ? 'rgba(33,150,243,0.07)' : 'transparent',
            transition: 'background-color 0.15s',
          }}
          onDragOver={handleFaceZoneDragOver}
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('application/x-face-swap-target')) return;
            faceZoneDragCount.current++;
            setIsDragOverFaceZone(true);
          }}
          onDragLeave={(e) => {
            if (!e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('application/x-face-swap-target')) return;
            faceZoneDragCount.current = Math.max(0, faceZoneDragCount.current - 1);
            if (faceZoneDragCount.current === 0) setIsDragOverFaceZone(false);
          }}
          onDrop={handleFaceZoneDrop}
        >
          {/* Zone header */}
          <div style={{
            padding: '10px 12px 6px',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            letterSpacing: '0.04em',
            flexShrink: 0,
            borderBottom: '1px solid var(--color-border)',
          }}>
            脸部参考 · {faceImages.length}
          </div>

          {/* Cards */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: config.facePadding,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridAutoRows: 'max-content',
            gap: config.faceGap,
            alignContent: 'start',
          }}>
            {faceImages.map((img) => {
              const isFaceSelected = selectedImageIds.includes(img.id) && multiSelectZone === 'face';
              const isFaceCardDragOver = dragOverFaceCardId === img.id;
              const selectedTargetCount = selectedImageIds.filter((id) => faceSwapZones[id] !== 'face').length;
              return (
                <div
                  key={img.id}
                  style={{ position: 'relative', minWidth: 0 }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('application/x-face-swap-target')) {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'move'; // match ImageCard's effectAllowed='move'
                    }
                  }}
                  onDragEnter={(e) => {
                    if (!e.dataTransfer.types.includes('application/x-face-swap-target')) return;
                    faceCardDragCounters.current[img.id] = (faceCardDragCounters.current[img.id] ?? 0) + 1;
                    setDragOverFaceCardId(img.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.dataTransfer.types.includes('application/x-face-swap-target')) return;
                    faceCardDragCounters.current[img.id] = Math.max(0, (faceCardDragCounters.current[img.id] ?? 0) - 1);
                    if (faceCardDragCounters.current[img.id] === 0) setDragOverFaceCardId(null);
                  }}
                  onDrop={(e) => handleFaceCardDrop(e, img)}
                >
                  <FaceZoneCard
                    image={img}
                    isMultiSelectMode={isMultiSelectMode && multiSelectZone === 'face'}
                    isSelected={isFaceSelected}
                    onLongPress={() => handleFaceLongPress(img.id)}
                    onToggleSelect={() => {
                      if (multiSelectZone !== 'face') return;
                      toggleImageSelection(img.id);
                    }}
                    onDelete={() => removeImages([img.id])}
                    onDragStart={(e) => handleFaceDragStart(e, img.id)}
                  />

                  {/* Drop overlay when a target card hovers over this face card */}
                  {isFaceCardDragOver && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 10,
                      backgroundColor: 'rgba(33,150,243,0.18)',
                      border: '2px solid var(--color-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: 'none',
                      zIndex: 20,
                    }}>
                      <span style={{
                        color: 'var(--color-primary)',
                        fontWeight: 700,
                        fontSize: 12,
                        background: 'rgba(255,255,255,0.88)',
                        padding: '3px 8px',
                        borderRadius: 6,
                        whiteSpace: 'nowrap',
                      }}>
                        {isMultiSelectMode && multiSelectZone === 'target' && selectedTargetCount > 1
                          ? `换脸 ×${selectedTargetCount}`
                          : '换脸'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}

            {faceImages.length === 0 && (
              <div style={{
                textAlign: 'center',
                color: 'var(--color-text-secondary)',
                fontSize: 12,
                padding: '24px 8px',
                opacity: 0.6,
              }}>
                拖入脸部参考图
              </div>
            )}
          </div>
        </div>

        {/* Right: Target zone (70%) */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: isDragOverTargetZone ? 'rgba(33,150,243,0.07)' : 'transparent',
            transition: 'background-color 0.15s',
          }}
          onDragOver={handleTargetZoneDragOver}
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            targetZoneDragCount.current++;
            setIsDragOverTargetZone(true);
          }}
          onDragLeave={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            targetZoneDragCount.current = Math.max(0, targetZoneDragCount.current - 1);
            if (targetZoneDragCount.current === 0) setIsDragOverTargetZone(false);
          }}
          onDrop={handleTargetZoneDrop}
        >
          {/* Zone header */}
          <div style={{
            padding: '10px 12px 6px',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            letterSpacing: '0.04em',
            flexShrink: 0,
            borderBottom: '1px solid var(--color-border)',
          }}>
            目标图 · {targetImages.length} &nbsp;
            <span style={{ fontWeight: 400, opacity: 0.7 }}>（将脸部参考图拖到目标图上换脸）</span>
          </div>

          {/* Cards grid */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 12px',
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${config.cardSize}, 1fr))`,
            gap: 12,
            alignContent: 'start',
          }}>
            {targetImages.map((img) => {
              const isTargetSelected = selectedImageIds.includes(img.id) && multiSelectZone === 'target';
              const task = tasks[img.id];
              const isProcessing = task?.status === 'processing' || task?.status === 'queued';
              const isDragOver = dragOverTargetId === img.id;

              return (
                <div
                  key={img.id}
                  onMouseEnter={() => setHoveredTargetId(img.id)}
                  onMouseLeave={() => setHoveredTargetId(null)}
                  onDragStart={(e) => {
                    // Add explicit cross-import data type alongside ImageCard's x-workflow-image
                    e.dataTransfer.setData('application/x-face-swap-target', img.id);
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('application/x-face-swap-face')) {
                      // Always stop propagation so the zone background doesn't also react
                      e.stopPropagation();
                      if (isMultiSelectMode && multiSelectZone === 'face') {
                        // Don't preventDefault → browser shows not-allowed cursor
                      } else {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                      }
                    }
                  }}
                  onDragEnter={(e) => {
                    if (!e.dataTransfer.types.includes('application/x-face-swap-face')) return;
                    dragEnterCounters.current[img.id] = (dragEnterCounters.current[img.id] ?? 0) + 1;
                    setDragOverTargetId(img.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.dataTransfer.types.includes('application/x-face-swap-face')) return;
                    dragEnterCounters.current[img.id] = Math.max(0, (dragEnterCounters.current[img.id] ?? 0) - 1);
                    if (dragEnterCounters.current[img.id] === 0) {
                      setDragOverTargetId(null);
                    }
                  }}
                  onDrop={(e) => handleTargetCardDrop(e, img)}
                  style={{
                    position: 'relative',
                    borderRadius: 10,
                    outline: isDragOver ? '2.5px solid var(--color-primary)' : 'none',
                    boxShadow: isDragOver ? '0 0 0 4px rgba(33,150,243,0.25)' : 'none',
                    transition: 'outline 0.1s, box-shadow 0.1s',
                  }}
                >
                  <ImageCard
                    image={img}
                    isMultiSelectMode={isMultiSelectMode && multiSelectZone === 'target'}
                    isSelected={isTargetSelected}
                    hidePlayButton={true}
                    onLongPress={() => handleTargetLongPress(img.id)}
                    onToggleSelect={() => {
                      if (multiSelectZone !== 'target') return;
                      toggleImageSelection(img.id);
                    }}
                  />

                  {/* Drag-to-face-zone hint badge */}
                  {hoveredTargetId === img.id && !isMultiSelectMode && !isDragOver && (
                    <div style={{
                      position: 'absolute',
                      bottom: 6,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      backgroundColor: 'rgba(0,0,0,0.7)',
                      color: '#e5e7eb',
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 4,
                      pointerEvents: 'none',
                      whiteSpace: 'nowrap',
                      zIndex: 10,
                    }}>
                      拖到左侧导入为脸部参考
                    </div>
                  )}

                  {/* Drop hint overlay — swap or forbidden depending on mode */}
                  {isDragOver && !isProcessing && (
                    isMultiSelectMode && multiSelectZone === 'face' ? (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: 10,
                        backgroundColor: 'rgba(239,68,68,0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                        zIndex: 20,
                      }}>
                        <Ban size={32} strokeWidth={1.8} color="#ef4444" />
                      </div>
                    ) : (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: 10,
                        backgroundColor: 'rgba(33,150,243,0.18)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                        zIndex: 20,
                      }}>
                        <span style={{
                          color: 'var(--color-primary)',
                          fontWeight: 700,
                          fontSize: 14,
                          background: 'rgba(255,255,255,0.85)',
                          padding: '4px 12px',
                          borderRadius: 6,
                        }}>换脸</span>
                      </div>
                    )
                  )}
                </div>
              );
            })}

            {targetImages.length === 0 && (
              <div style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                color: 'var(--color-text-secondary)',
                fontSize: 13,
                padding: '48px 16px',
                opacity: 0.6,
              }}>
                拖入目标图片，然后将脸部参考图拖到目标图上以换脸
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
