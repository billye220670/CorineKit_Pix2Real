import { useCallback, useState, useRef } from 'react';
import { X, Play, RotateCcw, Check, AlertCircle, Layers, ChevronDown, Flower } from 'lucide-react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { ProgressOverlay } from './ProgressOverlay.js';
import { ThumbnailStrip } from './ThumbnailStrip.js';
import { useMaskStore } from '../hooks/useMaskStore.js';
import { maskKey, TAB_MASK_MODE } from '../config/maskConfig.js';
import { showToast } from '../hooks/useToast.js';
import { useDragStore } from '../hooks/useDragStore.js';
import type { ImageItem } from '../types/index.js';

interface ImageCardProps {
  image: ImageItem;
  isMultiSelectMode: boolean;
  isSelected: boolean;
  isFlashing?: boolean;
  onLongPress: () => void;
  onToggleSelect: () => void;
}
export function ImageCard({ image, isMultiSelectMode, isSelected, isFlashing, onLongPress, onToggleSelect }: ImageCardProps) {
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const workflows = useWorkflowStore((s) => s.workflows);
  const clientId = useWorkflowStore((s) => s.clientId);
  const prompts = useWorkflowStore((s) => s.tabData[s.activeTab]?.prompts ?? {});
  const tasks = useWorkflowStore((s) => s.tabData[s.activeTab]?.tasks ?? {});
  const removeImage = useWorkflowStore((s) => s.removeImage);
  const setPrompt = useWorkflowStore((s) => s.setPrompt);
  const startTask = useWorkflowStore((s) => s.startTask);
  const resetTask = useWorkflowStore((s) => s.resetTask);
  const setFlashingImage = useWorkflowStore((s) => s.setFlashingImage);
  const selectedOutputIdx = useWorkflowStore(
    (s) => s.tabData[s.activeTab]?.selectedOutputIndex?.[image.id] ?? Math.max(0, (s.tabData[s.activeTab]?.tasks?.[image.id]?.outputs?.length ?? 1) - 1)
  );
  const setSelectedOutputIndex = useWorkflowStore((s) => s.setSelectedOutputIndex);
  const { sendMessage } = useWebSocket();

  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const task = tasks[image.id];
  const status = task?.status || 'idle';
  const progress = task?.progress || 0;
  const needsPrompt = workflows[activeTab]?.needsPrompt ?? false;
  const isVideoWorkflow = activeTab === 3 || activeTab === 4;
  const isProcessing = status === 'processing' || status === 'queued';
  const canExecute = !!clientId && !isProcessing;
  const tabMaskMode = TAB_MASK_MODE[activeTab] ?? 'none';
  const showMaskUI = tabMaskMode !== 'none';
  const currentMaskOutputIndex = tabMaskMode === 'B' ? selectedOutputIdx : -1;
  const currentMaskKey = maskKey(image.id, currentMaskOutputIndex);
  const hasMask = useMaskStore((s) => !!s.masks[currentMaskKey]);
  const deleteMask = useMaskStore((s) => s.deleteMask);
  const openEditor = useMaskStore((s) => s.openEditor);
  const maskEntryForMode = useMaskStore((s) => s.masks[maskKey(image.id, -1)]);
  const backPose         = useWorkflowStore((s) => s.tabData[s.activeTab]?.backPoseToggles?.[image.id] ?? false);
  const toggleBackPose   = useWorkflowStore((s) => s.toggleBackPose);
  const setDragging      = useDragStore((s) => s.setDragging);

  const [maskMenuOpen, setMaskMenuOpen] = useState(false);

  const outputs = task?.outputs ?? [];
  const displayOutput = selectedOutputIdx === -1 ? null : (outputs[selectedOutputIdx] ?? null);

  // Strip items: original always first, then generated outputs
  const originalIsVideo = image.file.type.startsWith('video/');
  const stripItems = outputs.length > 0
    ? [
        { filename: 'original', url: image.previewUrl, isVideo: originalIsVideo },
        ...outputs.map((o) => ({ ...o, isVideo: isVideoWorkflow })),
      ]
    : [];
  // Map store index (-1 = original) to strip index (0 = original)
  const stripSelectedIndex = selectedOutputIdx === -1 ? 0 : selectedOutputIdx + 1;
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || isProcessing) return;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      longPressTimer.current = null;
      onLongPress();
    }, 600);
  }, [isProcessing, onLongPress]);

  const handleMouseUp = useCallback(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  const handleMouseLeaveOuter = useCallback(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  const handleImageAreaClick = useCallback(() => {
    if (!isMultiSelectMode) return;
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    onToggleSelect();
  }, [isMultiSelectMode, onToggleSelect]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    cancelLongPress();
    e.dataTransfer.setData('application/x-workflow-image', image.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragging({ type: 'card', imageId: image.id });
    setIsDragging(true);
  }, [image.id, cancelLongPress, setDragging]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragging(null);
  }, [setDragging]);
  const handleCancelQueue = useCallback(async () => {
    const promptId = task?.promptId;
    if (!promptId) return;
    try {
    await fetch(`/api/workflow/cancel-queue/${promptId}`, { method: 'POST' });
    } catch {
      // best-effort; reset UI regardless
    }
    resetTask(image.id);
  }, [task, image.id, resetTask]);

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

  const handleExecute = useCallback(async () => {
    if (!clientId) return;

    // ── Workflow 5: 解除装备 ──────────────────────────────────────────
    if (activeTab === 5) {
      if (!maskEntryForMode) {
        showToast('请先在蒙版编辑器中绘制蒙版');
        return;
      }
      const maskBlob = await maskEntryToBlob(maskEntryForMode);
      const formData = new FormData();
      formData.append('image',    image.file);
      formData.append('mask',     maskBlob, 'mask.png');
      formData.append('clientId', clientId);
      formData.append('prompt',   prompts[image.id] || '');
      formData.append('backPose', String(backPose));

      try {
        const res = await fetch(`/api/workflow/5/execute?clientId=${clientId}`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) { console.error('Execute failed:', await res.text()); return; }
        const data = await res.json();
        startTask(image.id, data.promptId);
        sendMessage({ type: 'register', promptId: data.promptId, workflowId: 5 });
      } catch (err) {
        console.error('Execute error:', err);
      }
      return;
    }

    // ── Generic workflows ─────────────────────────────────────────────
    const formData = new FormData();
    formData.append('image',    image.file);
    formData.append('clientId', clientId);
    formData.append('prompt',   prompts[image.id] || '');

    try {
      const res = await fetch(`/api/workflow/${activeTab}/execute?clientId=${clientId}`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) { console.error('Execute failed:', await res.text()); return; }
      const data = await res.json();
      startTask(image.id, data.promptId);
      sendMessage({ type: 'register', promptId: data.promptId, workflowId: activeTab });
    } catch (err) {
      console.error('Execute error:', err);
    }
  }, [clientId, image, activeTab, prompts, startTask, sendMessage, maskEntryForMode, backPose, maskEntryToBlob]);
  const openMaskEditor = useCallback(() => {
    if (tabMaskMode === 'none') return;

    if (tabMaskMode === 'B') {
      if (selectedOutputIdx < 0) {
        showToast("原图无法编辑蒙版，请先在缩略图中选择一张结果图");
        return;
      }
      if (!outputs[selectedOutputIdx]) {
        showToast("请先执行工作流以获得结果图，再打开蒙版编辑器");
        return;
      }
      openEditor({
        imageId: image.id,
        outputIndex: selectedOutputIdx,
        mode: 'B',
        originalUrl: image.previewUrl,
        resultUrl: outputs[selectedOutputIdx].url,
        resultFilename: outputs[selectedOutputIdx].filename,
      });
      return;
    }

    // Mode A
    openEditor({
      imageId: image.id,
      outputIndex: -1,
      mode: 'A',
      originalUrl: image.previewUrl,
    });
  }, [tabMaskMode, selectedOutputIdx, outputs, image, openEditor]);
  return (
    <div
      draggable={!isProcessing}
      onDragStart={isProcessing ? undefined : handleDragStart}
      onDragEnd={handleDragEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeaveOuter}
      className={isFlashing ? 'card-flash-anim' : undefined}
      onAnimationEnd={() => { if (isFlashing) setFlashingImage(null); }}
      style={{
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        overflow: 'hidden',
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : isProcessing ? 'default' : 'grab',
        transition: 'opacity 0.15s, box-shadow 0.15s',
        boxShadow: isSelected ? '0 0 0 2px var(--color-primary)' : 'none',
        userSelect: 'none',
      }}
    >
      {/* Image container */}
      <div
        style={{ position: 'relative', cursor: isMultiSelectMode ? 'pointer' : 'inherit' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleImageAreaClick}
      >
        {/* Original image */}
        <img
          src={image.previewUrl}
          alt={image.originalName}
          style={{ width: '100%', display: 'block' }}
          onDoubleClick={(e) => {
            if (isVideoWorkflow) return;
            e.stopPropagation();
            openMaskEditor();
          }}
        />

        {/* Output overlay */}
        {displayOutput && (
          isVideoWorkflow ? (
            <video
              ref={videoRef}
              src={displayOutput.url}
              loop
              muted
              playsInline
              preload="auto"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                opacity: isHovered ? 1 : 0,
                transition: 'opacity 0.2s ease',
                pointerEvents: 'none',
              }}
            />
          ) : (
            <img
              src={displayOutput.url}
              alt="Output"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                display: 'block',
                opacity: 1,
                pointerEvents: 'none',
              }}
              onDoubleClick={(e) => {
                if (isVideoWorkflow) return;
                e.stopPropagation();
                openMaskEditor();
              }}
            />
          )
        )}
        {/* Progress overlay */}
        {(status === 'queued' || status === 'processing') && (
          <ProgressOverlay
            status={status}
            progress={progress}
            onCancel={status === 'queued' ? handleCancelQueue : undefined}
          />
        )}

        {/* Error badge */}
        {status === 'error' && (
          <div style={{
            position: 'absolute',
            top: 'var(--spacing-sm)',
            left: 'var(--spacing-sm)',
            backgroundColor: 'var(--color-error)',
            color: '#fff',
            padding: 'var(--spacing-xs)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-xs)',
            fontSize: '12px',
          }}>
            <AlertCircle size={14} />
            <span>Error</span>
          </div>
        )}

        {/* Mask icon overlay + dropdown */}
        {showMaskUI && (
          <div
            style={{
              position: 'absolute',
              top: 6,
              left: 6,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'rgba(0,0,0,0.45)',
                borderRadius: 6,
                padding: '2px 4px',
                gap: 2,
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={(e) => {
                e.stopPropagation();
                setMaskMenuOpen((v) => !v);
              }}
            >
              <Layers size={14} color={hasMask ? '#4ade80' : '#9ca3af'} />
              <ChevronDown size={11} color="#d1d5db" />
            </div>

            {maskMenuOpen && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 9 }}
                  onClick={() => setMaskMenuOpen(false)}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 24,
                    left: 0,
                    zIndex: 20,
                    background: 'var(--card-bg, #1e1e1e)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    minWidth: 140,
                    overflow: 'hidden',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                  }}
                >
                  <button
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '7px 12px',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      color: '#e5e7eb',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMaskMenuOpen(false);
                      openMaskEditor();
                    }}
                  >
                    {hasMask ? "编辑蒙版" : "新建蒙版"}
                  </button>
                  <button
                    disabled={!hasMask}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '7px 12px',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      color: hasMask ? '#f87171' : '#6b7280',
                      fontSize: 13,
                      cursor: hasMask ? 'pointer' : 'not-allowed',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!hasMask) return;
                      deleteMask(currentMaskKey);
                      setMaskMenuOpen(false);
                    }}
                  >
                    删除蒙版
                  </button>
                </div>
              </>
            )}

            {/* 后位 LoRA toggle — workflow 5 only */}
            {activeTab === 5 && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleBackPose(image.id); }}
                title={backPose ? '后位模式：开启' : '后位模式：关闭'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '2px 4px',
                  background: backPose ? 'rgba(59,130,246,0.85)' : 'rgba(0,0,0,0.45)',
                  border: backPose ? '1px solid rgba(147,197,253,0.6)' : '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                <Flower size={14} color={backPose ? '#dbeafe' : '#9ca3af'} />
              </button>
            )}
          </div>
        )}

        {/* Multi-select checkmark overlay */}
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

        {/* Thumbnail strip: original + generated outputs */}
        {stripItems.length > 0 && (
          <ThumbnailStrip
            items={stripItems}
            selectedIndex={stripSelectedIndex}
            onSelect={(i) => {
              if (i === 0) {
                setSelectedOutputIndex(image.id, -1);
              } else {
                setSelectedOutputIndex(image.id, i - 1);
              }
            }}
            onOutputDragStart={(outputIndex) => {
              setDragging({ type: 'output', imageId: image.id, outputIndex });
            }}
            onOutputDragEnd={() => setDragging(null)}
          />
        )}
      </div>

      {/* Card footer */}
      <div style={{ padding: 'var(--spacing-sm)' }}>
        <div style={{
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: 'var(--spacing-sm)',
        }}>
          {image.originalName}
        </div>

        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-start' }}>
          {needsPrompt && (
            <textarea
              placeholder={activeTab === 5 ? "留空使用默认提示词" : activeTab === 3 ? "输入提示词（留空使用默认）" : "额外提示词（可选）"}
              value={prompts[image.id] || ''}
              onChange={(e) => setPrompt(image.id, e.target.value)}
              disabled={isProcessing}
              rows={1}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                height: 28,
                padding: 'var(--spacing-xs) var(--spacing-sm)',
                border: '1px solid var(--color-border)',
                borderRadius: 0,
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: '12px',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleExecute(); }}
            disabled={!canExecute}
            title={status === 'done' ? "重新生成" : "执行"}
            style={{
              flexShrink: 0,
              height: 28,
              padding: '0 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: status === 'done' ? 'var(--color-success)' : 'var(--color-primary)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 0,
              cursor: canExecute ? 'pointer' : 'not-allowed',
              opacity: canExecute ? 1 : 0.5,
            }}
          >
            {status === 'done' ? <RotateCcw size={13} /> : <Play size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
