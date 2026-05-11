import { useCallback, useState, useRef, useEffect, memo } from 'react';
import { X, Play, RotateCcw, Check, AlertCircle, Layers, ChevronDown, Flower, Sparkles, Copy, BookText, Hash, AlignLeft, Wand2, Loader2, Heart, FileText, ImagePlus, Pencil } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { SYSTEM_PROMPTS } from './prompt-assistant/systemPrompts.js';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { usePromptAssistantStore } from '../hooks/usePromptAssistantStore.js';
import { ProgressOverlay } from './ProgressOverlay.js';
import { ThumbnailStrip } from './ThumbnailStrip.js';
import { useMaskStore } from '../hooks/useMaskStore.js';
import { maskKey, TAB_MASK_MODE } from '../config/maskConfig.js';
import { showToast } from '../hooks/useToast.js';
import { useDragStore } from '../hooks/useDragStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { useAgentStore } from '../hooks/useAgentStore.js';
import { useAutoLoopStore } from '../hooks/useAutoLoopStore.js';
import type { ImageItem } from '../types/index.js';
import { setSessionCover, renameCard } from '../services/sessionService.js';
import { callPromptAssistant } from '../services/api.js';
import { useVideoFps } from '../hooks/useVideoFps.js';

interface ImageCardProps {
  image: ImageItem;
  isMultiSelectMode: boolean;
  isSelected: boolean;
  isFlashing?: boolean;
  hidePlayButton?: boolean;
  onLongPress: () => void;
  onToggleSelect: () => void;
}

// arePropsEqual: Only compare key props that affect rendering
function arePropsEqual(prev: ImageCardProps, next: ImageCardProps): boolean {
  return (
    prev.image.id === next.image.id &&
    prev.image.previewUrl === next.image.previewUrl &&
    prev.image.thumbnailUrl === next.image.thumbnailUrl &&
    prev.image.originalName === next.image.originalName &&
    prev.image.label === next.image.label &&
    prev.image.sessionUrl === next.image.sessionUrl &&
    prev.isMultiSelectMode === next.isMultiSelectMode &&
    prev.isSelected === next.isSelected &&
    prev.isFlashing === next.isFlashing &&
    prev.hidePlayButton === next.hidePlayButton &&
    prev.onLongPress === next.onLongPress &&
    prev.onToggleSelect === next.onToggleSelect
  );
}

export const ImageCard = memo(function ImageCard({ image, isMultiSelectMode, isSelected, isFlashing, hidePlayButton, onLongPress, onToggleSelect }: ImageCardProps) {
  // ─── Zustand subscriptions (consolidated) ───────────────────────────

  // 1. Actions (stable references, rarely change)
  const actions = useWorkflowStore(
    useShallow((s) => ({
      setPrompt: s.setPrompt,
      startTask: s.startTask,
      resetTask: s.resetTask,
      setFlashingImage: s.setFlashingImage,
      setSelectedOutputIndex: s.setSelectedOutputIndex,
      toggleBackPose: s.toggleBackPose,
      removeImage: s.removeImage,
      applyCardRename: s.applyCardRename,
    }))
  );

  // 2. Global state (changes affect all cards)
  const globalState = useWorkflowStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      workflows: s.workflows,
      clientId: s.clientId,
      sessionId: s.sessionId,
    }))
  );

  // 3. Card-specific data (only this card's data, filtered by image.id)
  const cardData = useWorkflowStore(
    useShallow((s) => {
      const tab = s.activeTab;
      const tabData = s.tabData[tab];
      const task = tabData?.tasks?.[image.id];
      const outputsLen = task?.outputs?.length ?? 0;
      return {
        promptValue: tabData?.prompts?.[image.id] || '',
        task: task ?? null,
        selectedOutputIdx: tabData?.selectedOutputIndex?.[image.id] ?? (outputsLen > 0 ? outputsLen - 1 : -1),
        text2imgConfig: tab === 7 ? s.tabData[7]?.text2imgConfigs?.[image.id] : undefined,
        zitConfig: tab === 9 ? s.tabData[9]?.zitConfigs?.[image.id] : undefined,
        backPose: tabData?.backPoseToggles?.[image.id] ?? false,
      };
    })
  );

  // Destructure for easier access
  const { setPrompt, startTask, resetTask, removeImage, setFlashingImage, setSelectedOutputIndex, toggleBackPose, applyCardRename } = actions;
  const { activeTab, workflows, clientId, sessionId } = globalState;
  const { promptValue, task, selectedOutputIdx, text2imgConfig, zitConfig, backPose } = cardData;
  const { sendMessage } = useWebSocket();

  const [isHovered, setIsHovered] = useState(false);
  const isHoveredRef = useRef(false);
  const [isCardHovered, setIsCardHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevVideoEl = useRef<HTMLVideoElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const mouseDownFromInput = useRef(false);

  // Derived state from cardData
  const status = task?.status || 'idle';
  const progress = task?.progress || 0;
  const needsPrompt = workflows[activeTab]?.needsPrompt ?? false;
  const isVideoWorkflow = activeTab === 3 || activeTab === 4;
  const isTab7 = activeTab === 7;
  const isTab9 = activeTab === 9;
  const isProcessing = status === 'processing' || status === 'queued';
  const canExecute = !!clientId && !isProcessing;

  // Direct DOM mutation to block card drag when mouse is in the thumbnail strip.
  // State-based approach is unreliable: browser fires onMouseLeave before dragstart,
  // resetting draggable=true before the card's dragstart handler can block it.
  const handleStripMouseEnter = useCallback(() => {
    if (cardRef.current) cardRef.current.draggable = false;
  }, []);
  const handleStripMouseLeave = useCallback(() => {
    if (cardRef.current && !isProcessing) cardRef.current.draggable = true;
  }, [isProcessing]);
  const tabMaskMode = TAB_MASK_MODE[activeTab] ?? 'none';
  const showMaskUI = tabMaskMode !== 'none';
  const currentMaskOutputIndex = tabMaskMode === 'B' ? selectedOutputIdx : -1;
  const currentMaskKey = maskKey(image.id, currentMaskOutputIndex);

  // Mask store subscriptions (consolidated)
  const maskState = useMaskStore(
    useShallow((s) => ({
      hasMask: !!s.masks[currentMaskKey],
      deleteMask: s.deleteMask,
      openEditor: s.openEditor,
      maskEntryForMode: s.masks[maskKey(image.id, -1)],
    }))
  );
  const { hasMask, deleteMask, openEditor, maskEntryForMode } = maskState;

  const setDragging = useDragStore((s) => s.setDragging);
  const reversePromptModel = useSettingsStore((s) => s.reversePromptModel);
  const favorited = useAgentStore((s) => image.id in s.favorites);
  const toggleFavorite = useAgentStore((s) => s.toggleFavorite);

  const [maskMenuOpen, setMaskMenuOpen] = useState(false);
  const [isReversingPrompt, setIsReversingPrompt] = useState(false);
  const [textareaFocused, setTextareaFocused] = useState(false);
  const [promptBtnHovered, setPromptBtnHovered] = useState(false);
  const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [titleHovered, setTitleHovered] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isEditingName) return;
    const el = nameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [isEditingName]);

  const currentLabel = image.label || image.originalName.replace(/\.[^.]+$/, '');

  const startEditName = useCallback(() => {
    if (isProcessing) {
      showToast('任务正在执行中，完成后再重命名');
      return;
    }
    setEditingNameValue(currentLabel);
    setIsEditingName(true);
  }, [currentLabel, isProcessing]);

  const handleRename = useCallback(async (newLabel: string): Promise<boolean> => {
    if (!sessionId) {
      showToast('会话尚未就绪');
      return false;
    }
    try {
      const result = await renameCard(sessionId, activeTab, image.id, newLabel);
      applyCardRename(activeTab, image.id, {
        label: result.label,
        inputFilename: result.inputFilename,
        inputUrl: result.inputUrl,
        outputs: result.outputs,
      });
      showToast(`已重命名为 ${result.label}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '重命名失败';
      showToast(msg);
      return false;
    }
  }, [sessionId, activeTab, image.id, applyCardRename]);

  const submitEditName = useCallback(async () => {
    const v = editingNameValue.trim();
    if (!v || v === currentLabel) {
      setIsEditingName(false);
      return;
    }
    const ok = await handleRename(v);
    if (ok) setIsEditingName(false);
  }, [editingNameValue, currentLabel, handleRename]);

  useEffect(() => {
    const t = textareaRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  }, [promptValue]);

  const outputs = task?.outputs ?? [];
  const displayOutput = selectedOutputIdx === -1 ? null : (outputs[selectedOutputIdx] ?? null);

  // Strip items: original always first, then generated outputs
  const originalIsVideo = image.file?.type?.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(image.originalName);
  const stripItems = outputs.length > 0
    ? [
        { filename: 'original', url: image.previewUrl, isVideo: originalIsVideo, thumbnailUrl: image.thumbnailUrl },
        ...outputs.map((o) => ({ ...o, isVideo: isVideoWorkflow })),
      ]
    : [];
  // Map store index (-1 = original) to strip index (0 = original)
  const stripSelectedIndex = selectedOutputIdx === -1 ? 0 : selectedOutputIdx + 1;

  // Tab 4: fps detection for frame interpolation badge
  const isTab4 = activeTab === 4;
  const tab4VideoUrl = isTab4 && originalIsVideo ? image.previewUrl : null;
  const originalFps = useVideoFps(tab4VideoUrl);
  const frameInterpMultiplier = isTab4 ? ((window as any).__frameInterpConfig?.multiplier ?? 2) : 1;
  const interpolatedFps = originalFps ? originalFps * frameInterpMultiplier : null;
  const showFrameInterpBadge = isTab4 && status === 'done' && outputs.length > 0;
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const fromInput = !!(e.target as HTMLElement).closest('textarea, input, select');
    mouseDownFromInput.current = fromInput;
    if (e.button !== 0 || isProcessing || fromInput) return;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      longPressTimer.current = null;
      onLongPress();
    }, 600);
  }, [isProcessing, onLongPress]);

  const handleMouseUp = useCallback(() => {
    cancelLongPress();
    mouseDownFromInput.current = false;
  }, [cancelLongPress]);

  const handleMouseLeaveOuter = useCallback(() => {
    cancelLongPress();
    setIsCardHovered(false);
  }, [cancelLongPress]);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    isHoveredRef.current = true;
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    isHoveredRef.current = false;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  // When switching between video outputs, pause old video and play new one if hovering
  useEffect(() => {
    if (!isVideoWorkflow) return;
    const prev = prevVideoEl.current;
    const curr = videoRef.current;
    if (prev && prev !== curr) {
      prev.pause();
      prev.currentTime = 0;
    }
    prevVideoEl.current = curr;
    if (isHoveredRef.current && curr) {
      curr.play().catch(() => {});
    }
  }, [selectedOutputIdx, isVideoWorkflow]);

  const handleImageAreaClick = useCallback(() => {
    if (!isMultiSelectMode) return;
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    onToggleSelect();
  }, [isMultiSelectMode, onToggleSelect]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (mouseDownFromInput.current) { e.preventDefault(); return; }
    cancelLongPress();

    // Set internal drag data for in-app operations
    e.dataTransfer.setData('application/x-workflow-image', image.id);
    e.dataTransfer.effectAllowed = 'copyMove';

    // Prepare file for external drag (e.g., to desktop)
    // Determine which image to export: output if selected, otherwise input
    const exportOutput = displayOutput && selectedOutputIdx >= 0;

    try {
      if (exportOutput) {
        // For output images, use DownloadURL method (Chrome/Edge extension)
        // Format: application/octet-stream:<filename>:<url>
        const downloadUrl = `application/octet-stream:${encodeURIComponent(displayOutput.filename)}:${window.location.origin}${displayOutput.url}`;
        e.dataTransfer.setData('DownloadURL', downloadUrl);
      } else if (image.file) {
        // For input images, directly add the File object (synchronous)
        e.dataTransfer.items.add(image.file);
      } else if (image.sessionUrl) {
        // If only sessionUrl exists (restored from session), use DownloadURL method
        const downloadUrl = `application/octet-stream:${encodeURIComponent(image.originalName)}:${window.location.origin}${image.sessionUrl}`;
        e.dataTransfer.setData('DownloadURL', downloadUrl);
      }
    } catch (err) {
      console.warn('[DragExport] Failed to prepare file for external drag:', err);
    }

    document.body.classList.add('is-dragging-card');
    setDragging({ type: 'card', imageId: image.id });
    setIsDragging(true);
  }, [image.id, image.file, image.sessionUrl, image.originalName, displayOutput, selectedOutputIdx, cancelLongPress, setDragging]);

  const handleDragEnd = useCallback(() => {
    document.body.classList.remove('is-dragging-card');
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
    removeImage(image.id);
  }, [task, image.id, removeImage]);

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

  const handleExecute = useCallback(async () => {
    if (!clientId) return;

    // 跨 Tab 拦截守卫：当前若有其它 Tab 的循环在跑，先询问用户
    const guarded = await useAutoLoopStore.getState().guardBeforeSubmit(activeTab);
    if (!guarded) return;

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
      formData.append('prompt',   promptValue);
      formData.append('backPose', String(backPose));

      try {
        const res = await fetch(`/api/workflow/5/execute?clientId=${clientId}`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) { console.error('Execute failed:', await res.text()); showToast('生成失败，请检查服务端日志'); return; }
        const data = await res.json();
        startTask(image.id, data.promptId);
        sendMessage({ type: 'register', promptId: data.promptId, workflowId: 5, sessionId, tabId: 5 });
      } catch (err) {
        console.error('Execute error:', err);
        showToast('生成请求失败');
      }
      return;
    }

    // ── Workflow 10: 区域编辑 ─────────────────────────────────────────
    if (activeTab === 10) {
      if (!maskEntryForMode) {
        showToast('请先在蒙版编辑器中绘制蒙版');
        return;
      }
      const maskBlob = await maskEntryToBlob(maskEntryForMode);
      const formData = new FormData();
      formData.append('image',    image.file);
      formData.append('mask',     maskBlob, 'mask.png');
      formData.append('clientId', clientId);
      formData.append('prompt',   promptValue);
      formData.append('backPose', String(backPose));

      try {
        const res = await fetch(`/api/workflow/10/execute?clientId=${clientId}`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) { console.error('Execute failed:', await res.text()); showToast('生成失败，请检查服务端日志'); return; }
        const data = await res.json();
        startTask(image.id, data.promptId);
        sendMessage({ type: 'register', promptId: data.promptId, workflowId: 10, sessionId, tabId: 10 });
      } catch (err) {
        console.error('Execute error:', err);
        showToast('生成请求失败');
      }
      return;
    }

    // ── Generic workflows ─────────────────────────────────────────────
    const formData = new FormData();
    formData.append('image',    image.file);
    formData.append('clientId', clientId);
    formData.append('prompt',   promptValue);

    // Tab 3: pass video generation options from sidebar
    if (activeTab === 3) {
      const vCfg = (window as any).__videoGenConfig;
      if (vCfg) {
        formData.append('options', JSON.stringify({
          megapixels: vCfg.megapixels,
          seconds: vCfg.seconds,
          fps: vCfg.fps,
        }));
      }
    }

    // Tab 4: pass frame interpolation multiplier from sidebar
    if (activeTab === 4) {
      const fCfg = (window as any).__frameInterpConfig;
      if (fCfg) {
        formData.append('options', JSON.stringify({
          multiplier: fCfg.multiplier,
        }));
      }
    }

    // Tab 0: pass selected draw model (qwen / klein) from persisted settings
    if (activeTab === 0) {
      try {
        const s = JSON.parse(localStorage.getItem('wf0_settings') ?? '{}');
        formData.append('model', s.drawModel ?? 'qwen');
      } catch {
        formData.append('model', 'qwen');
      }
    }

    // Tab 2: pass selected upscale model (seedvr2 / klein) from persisted settings
    if (activeTab === 2) {
      try {
        const s = JSON.parse(localStorage.getItem('wf2_settings') ?? '{}');
        formData.append('model', s.upscaleModel ?? 'seedvr2');
      } catch {
        formData.append('model', 'seedvr2');
      }
    }

    try {
      const res = await fetch(`/api/workflow/${activeTab}/execute?clientId=${clientId}`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) { console.error('Execute failed:', await res.text()); showToast('生成失败，请检查服务端日志'); return; }
      const data = await res.json();
      startTask(image.id, data.promptId);
      sendMessage({ type: 'register', promptId: data.promptId, workflowId: activeTab, sessionId, tabId: activeTab });
    } catch (err) {
      console.error('Execute error:', err);
      showToast('生成请求失败');
    }
  }, [clientId, image, activeTab, promptValue, startTask, sendMessage, maskEntryForMode, backPose, maskEntryToBlob, sessionId]);
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

  const handleReversePrompt = useCallback(async () => {
    let file: File | Blob;
    let filename: string;
    if (selectedOutputIdx === -1 || !displayOutput) {
      file = image.file;
      filename = image.originalName;
    } else {
      const resp = await fetch(displayOutput.url);
      file = await resp.blob();
      filename = displayOutput.filename;
    }

    setIsReversingPrompt(true);
    try {
      const fd = new FormData();
      fd.append('image', file, filename);
      const res = await fetch(`/api/workflow/reverse-prompt?model=${encodeURIComponent(reversePromptModel)}`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('请求失败');
      const { text } = await res.json();
      await navigator.clipboard.writeText(text);
      showToast('提示词已复制到剪贴板');
    } catch (err) {
      console.error('[ReversePrompt]', err);
      showToast('反推提示词失败');
    } finally {
      setIsReversingPrompt(false);
    }
  }, [selectedOutputIdx, displayOutput, image, reversePromptModel]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleQuickAction = useCallback(async (mode: 'naturalToTags' | 'tagsToNatural' | 'detailer') => {
    const text = promptValue;
    if (!text.trim()) return;
    setQuickActionLoading(mode);
    try {
      const sysPrompt =
        mode === 'naturalToTags' ? SYSTEM_PROMPTS.naturalToTags :
        mode === 'tagsToNatural' ? SYSTEM_PROMPTS.tagsToNatural :
        SYSTEM_PROMPTS.detailer;
      const { text: result } = await callPromptAssistant({ systemPrompt: sysPrompt, userPrompt: text });
      setPrompt(image.id, result);
    } catch {
      showToast('提示词助理操作失败');
    } finally {
      setQuickActionLoading(null);
    }
  }, [promptValue, image.id, setPrompt]);

  return (
    <div
      ref={cardRef}
      draggable={!isProcessing}
      onDragStart={isProcessing ? undefined : handleDragStart}
      onDragEnd={handleDragEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeaveOuter}
      onMouseEnter={() => setIsCardHovered(true)}
      onContextMenu={handleContextMenu}
      className={[isFlashing ? 'card-flash-anim' : '', isReversingPrompt ? 'card-ai-glow' : ''].filter(Boolean).join(' ') || undefined}
      onAnimationEnd={() => { if (isFlashing) setFlashingImage(null); }}
      style={{
        display: 'flex',
        flexDirection: 'column' as const,
        position: 'relative',
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        borderRadius: 10,
        overflow: 'hidden',
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'default',
        transform: isCardHovered && !isDragging ? 'translateY(-3px)' : 'none',
        transition: 'opacity 0.15s, transform 0.2s ease, outline-color 0.2s ease',
        outline: isSelected
          ? '2px solid var(--color-primary)'
          : isCardHovered && !isDragging
            ? '2px solid rgba(99, 102, 241, 0.5)'
            : '2px solid transparent',
        outlineOffset: -1,
        willChange: 'transform',
        userSelect: 'none',
      }}
    >
      {/* Image container */}
      <div
        style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', cursor: isMultiSelectMode ? 'pointer' : 'inherit' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleImageAreaClick}
        onMouseDown={(e) => {
          if (e.button !== 1) return;
          e.preventDefault(); // prevent browser auto-scroll cursor
          const url = displayOutput?.url ?? image.sessionUrl ?? image.previewUrl;
          if (url.startsWith('blob:')) {
            showToast('图片尚未保存，无法打开');
            return;
          }
          fetch('/api/output/open-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          }).catch(() => {});
        }}
      >
        {/* Image area: tab 7 has 3 states; video workflows show video directly; other tabs show placeholder + optional absolute output overlay */}
        {(isTab7 || isTab9) && isProcessing ? (
          <div
            className="shimmer-skeleton"
            style={{
              width: '100%',
              aspectRatio: `${(isTab7 ? text2imgConfig?.width : zitConfig?.width) ?? 832} / ${(isTab7 ? text2imgConfig?.height : zitConfig?.height) ?? 1216}`,
              display: 'block',
            }}
          />
        ) : (isTab7 || isTab9) && displayOutput ? (
          <img
            src={displayOutput.url}
            alt="Output"
            loading="lazy"
            draggable={false}
            style={{ width: '100%', display: 'block' }}
            onDoubleClick={(e) => { e.stopPropagation(); openMaskEditor(); }}
          />
        ) : isVideoWorkflow ? (
          /* Video workflow: pre-render all videos, toggle display to prevent flicker on switch */
          <>
            {/* Original input (image or video) — visible when no output selected */}
            {originalIsVideo ? (
              <>
                {/* Thumbnail cover: show <img> when thumbnailUrl exists and displaying original input */}
                {image.thumbnailUrl && selectedOutputIdx === -1 && (
                  <img
                    src={image.thumbnailUrl}
                    alt={image.originalName}
                    draggable={false}
                    style={{
                      width: '100%',
                      display: 'block',
                      objectFit: 'contain',
                    }}
                  />
                )}
                {/* Video element: visible only when no thumbnailUrl fallback, hidden otherwise */}
                <video
                  ref={selectedOutputIdx === -1 ? videoRef : undefined}
                  src={image.previewUrl}
                  loop
                  muted
                  playsInline
                  preload="metadata"
                  draggable={false}
                  disablePictureInPicture
                  controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
                  style={{ width: '100%', display: (selectedOutputIdx === -1 && !image.thumbnailUrl) ? 'block' : 'none' }}
                  onLoadedData={(e) => { (e.target as HTMLVideoElement).currentTime = 0.001; }}
                />
              </>
            ) : (
              <img
                src={image.previewUrl}
                alt={image.originalName}
                loading="lazy"
                draggable={false}
                style={{ width: '100%', display: selectedOutputIdx === -1 ? 'block' : 'none' }}
              />
            )}
            {/* All output videos — each stays mounted, only selected one visible */}
            {outputs.map((output, i) => (
              <video
                key={output.url}
                ref={i === selectedOutputIdx ? videoRef : undefined}
                src={output.url}
                loop
                muted
                playsInline
                preload={i === selectedOutputIdx ? 'auto' : 'none'}
                draggable={false}
                disablePictureInPicture
                controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
                style={{ width: '100%', display: i === selectedOutputIdx ? 'block' : 'none' }}
                onLoadedData={(e) => { (e.target as HTMLVideoElement).currentTime = 0.001; }}
              />
            ))}
          </>
        ) : (
          <img
            src={image.previewUrl}
            alt={image.originalName}
            loading="lazy"
            draggable={false}
            style={{ width: '100%', display: 'block' }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              openMaskEditor();
            }}
          />
        )}

        {/* Output overlay — non-tab-7/9, non-video-workflow only */}
        {displayOutput && !isTab7 && !isTab9 && !isVideoWorkflow && (
          <img
            src={displayOutput.url}
            alt="Output"
            loading="lazy"
            draggable={false}
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
              e.stopPropagation();
              openMaskEditor();
            }}
          />
        )}
        {/* Progress overlay */}
        {(status === 'queued' || status === 'processing') && (
          <ProgressOverlay
            status={status}
            progress={progress}
            stage={task?.stage}
            stepIndex={task?.stepIndex}
            stepTotal={task?.stepTotal}
            onCancel={status === 'queued' ? handleCancelQueue : undefined}
          />
        )}

        {/* Frame interpolation badge (Tab 4) */}
        {showFrameInterpBadge && (
          <div style={{
            position: 'absolute',
            top: 6,
            left: 6,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(99, 102, 241, 0.85)',
            color: 'white',
            fontSize: 11,
            fontWeight: 500,
            pointerEvents: 'none',
            zIndex: 5,
            lineHeight: 1.4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
          }}>
            <span>已补帧</span>
            {interpolatedFps && <span>{interpolatedFps}fps</span>}
          </div>
        )}

        {/* Original fps badge (Tab 4, before completion) */}
        {isTab4 && originalFps && !showFrameInterpBadge && (
          <div style={{
            position: 'absolute',
            top: 6,
            left: 6,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            fontSize: 11,
            fontWeight: 500,
            pointerEvents: 'none',
            zIndex: 5,
          }}>
            {originalFps}fps
          </div>
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
                background: 'rgba(0,0,0,0.68)',
                borderRadius: 6,
                padding: '5px 7px',
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
                  padding: '5px 7px',
                  background: backPose ? 'rgba(59,130,246,0.9)' : 'rgba(0,0,0,0.68)',
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

        {/* Dim overlay for unselected cards in multi-select mode */}
        {isMultiSelectMode && !isSelected && (
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
            transition: 'background-color 0.15s',
          }} />
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

        {/* Reverse-prompt "analyzing" overlay */}
        {isReversingPrompt && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 11,
            backgroundColor: 'rgba(0,0,0,0.55)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            pointerEvents: 'none',
          }}>
            <span style={{ color: '#e5e7eb', fontSize: 13, letterSpacing: 1 }}>分析中</span>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    display: 'inline-block',
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    backgroundColor: '#a5b4fc',
                    animation: 'dot-wave 1.4s ease-in-out infinite',
                    animationDelay: `${i * 0.2}s`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Thumbnail strip: original + generated outputs — hidden for tab 7/9/4 */}
        {stripItems.length > 0 && !isTab7 && !isTab9 && activeTab !== 4 && (
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
            onMouseEnter={handleStripMouseEnter}
            onMouseLeave={handleStripMouseLeave}
          />
        )}

        {/* Favorite heart button — bottom-right of image area */}
        {(isTab7 || isTab9) && !isMultiSelectMode && !isProcessing && (isCardHovered || favorited) && (
          <div
            onClick={(e) => { e.stopPropagation(); if (sessionId) toggleFavorite(sessionId, image.id, activeTab); }}
            title={favorited ? '取消收藏' : '收藏'}
            style={{
              position: 'absolute',
              bottom: stripItems.length > 0 && !isTab7 && !isTab9 ? 38 : 8,
              right: 8,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(0,0,0,0.68)',
              borderRadius: 6,
              padding: '5px 7px',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <Heart
              size={14}
              color={favorited ? '#ef4444' : '#9ca3af'}
              fill={favorited ? '#ef4444' : 'none'}
            />
          </div>
        )}

        {/* Reverse-prompt button — top-right of card, visible on card hover, hidden in multi-select or processing */}
        {!isVideoWorkflow && !isMultiSelectMode && !isProcessing && (isCardHovered || isReversingPrompt) && (
          <div
            onClick={(e) => { e.stopPropagation(); if (!isReversingPrompt) handleReversePrompt(); }}
            title="反推提示词"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(0,0,0,0.68)',
              borderRadius: 6,
              padding: '5px 7px',
              cursor: isReversingPrompt ? 'not-allowed' : 'pointer',
              opacity: isReversingPrompt ? 0.6 : 1,
              userSelect: 'none',
            }}
          >
            <Sparkles size={14} color={isReversingPrompt ? '#facc15' : '#9ca3af'} />
          </div>
        )}
      </div>

      {/* Card footer */}
      <div style={{ padding: 'var(--spacing-sm)', flexShrink: 0 }}>
        <div
          onMouseEnter={() => setTitleHovered(true)}
          onMouseLeave={() => setTitleHovered(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: '12px',
            color: 'var(--color-text-secondary)',
            minHeight: 20,
            marginBottom: 'var(--spacing-sm)',
            minWidth: 0,
          }}
        >
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={editingNameValue}
              onChange={(e) => setEditingNameValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); void submitEditName(); }
                else if (e.key === 'Escape') { e.preventDefault(); setIsEditingName(false); }
              }}
              onBlur={() => { void submitEditName(); }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                color: 'var(--color-text-primary, #e0e0e0)',
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--color-primary, #4a9eff)',
                borderRadius: 4,
                padding: '2px 6px',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          ) : (
            <>
              <span
                title={currentLabel}
                onClick={(e) => {
                  // Allow clicking title to directly enter edit mode (alongside the icon)
                  e.stopPropagation();
                  startEditName();
                }}
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: '0 1 auto',
                  minWidth: 0,
                  cursor: 'text',
                }}
              >
                {currentLabel}
              </span>
              {titleHovered && (
                <button
                  type="button"
                  title="重命名"
                  onClick={(e) => { e.stopPropagation(); startEditName(); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    flexShrink: 0,
                    width: 18,
                    height: 18,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    color: 'var(--color-text-secondary)',
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.08)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
                >
                  <Pencil size={12} />
                </button>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-start' }}>
          {/* Normal workflows: editable prompt textarea */}
          {!isTab7 && !isTab9 && needsPrompt && (
            <div
              style={{ position: 'relative', flex: 1 }}
              className={quickActionLoading ? 'textarea-ai-active' : undefined}
            >
              <textarea
                ref={textareaRef}
                placeholder={activeTab === 5 ? "留空使用默认提示词" : activeTab === 3 ? "输入提示词（留空使用默认）" : "额外提示词（可选）"}
                value={promptValue}
                onChange={(e) => setPrompt(image.id, e.target.value)}
                disabled={isProcessing}
                readOnly={quickActionLoading !== null}
                rows={1}
                onClick={(e) => e.stopPropagation()}
                onDragStart={(e) => e.stopPropagation()}
                onFocus={() => setTextareaFocused(true)}
                onBlur={() => setTextareaFocused(false)}
                style={{
                  width: '100%',
                  minHeight: 28,
                  padding: 'var(--spacing-xs) 36px var(--spacing-xs) var(--spacing-sm)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: '12px',
                  resize: 'none',
                  outline: 'none',
                  fontFamily: 'inherit',
                  overflow: 'hidden',
                  opacity: quickActionLoading !== null ? 0.45 : 1,
                  transition: 'opacity 0.2s',
                }}
              />
              {/* Prompt assistant button group — expands on hover */}
              <div
                onMouseEnter={() => setPromptBtnHovered(true)}
                onMouseLeave={() => setPromptBtnHovered(false)}
                style={{
                  position: 'absolute',
                  bottom: 8,
                  right: 3,
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  opacity: textareaFocused || promptBtnHovered ? 1 : 0,
                  pointerEvents: textareaFocused || promptBtnHovered ? 'auto' : 'none',
                  background: promptBtnHovered ? 'var(--color-surface)' : 'transparent',
                  border: `1px solid ${promptBtnHovered ? 'var(--color-border)' : 'transparent'}`,
                  borderRadius: 6,
                  padding: '2px 4px',
                  transition: 'opacity 0.15s, background 0.15s, border-color 0.15s',
                }}
              >
                {/* Quick action buttons — slide in on hover */}
                <div style={{
                  display: 'flex',
                  gap: 4,
                  overflow: 'hidden',
                  maxWidth: promptBtnHovered ? 72 : 0,
                  marginRight: promptBtnHovered ? 4 : 0,
                  opacity: promptBtnHovered ? 1 : 0,
                  transition: 'max-width 0.2s ease, margin-right 0.2s ease, opacity 0.15s',
                }}>
                  {/* 按需扩写 */}
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); handleQuickAction('detailer'); }}
                    disabled={quickActionLoading !== null}
                    title="按需扩写（直接替换）"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: quickActionLoading ? 'not-allowed' : 'pointer',
                      padding: 2,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      color: quickActionLoading === 'detailer' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                      opacity: quickActionLoading && quickActionLoading !== 'detailer' ? 0.35 : 1,
                    }}
                  >
                    {quickActionLoading === 'detailer'
                      ? <Loader2 size={13} style={{ animation: 'spin 0.6s linear infinite' }} />
                      : <Wand2 size={13} />}
                  </button>
                  {/* tag → 自然语言 */}
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); handleQuickAction('tagsToNatural'); }}
                    disabled={quickActionLoading !== null}
                    title="标签 → 自然语言（直接替换）"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: quickActionLoading ? 'not-allowed' : 'pointer',
                      padding: 2,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      color: quickActionLoading === 'tagsToNatural' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                      opacity: quickActionLoading && quickActionLoading !== 'tagsToNatural' ? 0.35 : 1,
                    }}
                  >
                    {quickActionLoading === 'tagsToNatural'
                      ? <Loader2 size={13} style={{ animation: 'spin 0.6s linear infinite' }} />
                      : <AlignLeft size={13} />}
                  </button>
                  {/* 自然语言 → tag */}
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); handleQuickAction('naturalToTags'); }}
                    disabled={quickActionLoading !== null}
                    title="自然语言 → 标签（直接替换）"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: quickActionLoading ? 'not-allowed' : 'pointer',
                      padding: 2,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      color: quickActionLoading === 'naturalToTags' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                      opacity: quickActionLoading && quickActionLoading !== 'naturalToTags' ? 0.35 : 1,
                    }}
                  >
                    {quickActionLoading === 'naturalToTags'
                      ? <Loader2 size={13} style={{ animation: 'spin 0.6s linear infinite' }} />
                      : <Hash size={13} />}
                  </button>
                </div>
                {/* Panel entry button */}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    usePromptAssistantStore.getState().openPanel({
                      initialText: promptValue,
                    });
                  }}
                  title="提示词助理"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 2,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <BookText size={13} />
                </button>
              </div>
            </div>
          )}
          {/* Tab 7/9: Copy prompt button instead of Play/RotateCcw */}
          {!hidePlayButton && ((isTab7 || isTab9) ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const promptText = isTab7 ? text2imgConfig?.prompt : zitConfig?.prompt;
                if (!promptText) return;
                navigator.clipboard.writeText(promptText).then(() => {
                  showToast('提示词已复制');
                }).catch(() => {
                  showToast('复制失败');
                });
              }}
              disabled={!(isTab7 ? text2imgConfig?.prompt : zitConfig?.prompt)}
              title="复制提示词"
              style={{
                flexShrink: 0,
                height: 28,
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'var(--color-surface-hover)',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                cursor: (isTab7 ? text2imgConfig?.prompt : zitConfig?.prompt) ? 'pointer' : 'not-allowed',
                opacity: (isTab7 ? text2imgConfig?.prompt : zitConfig?.prompt) ? 1 : 0.4,
              }}
            >
              <Copy size={13} />
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); handleExecute(); }}
              disabled={!canExecute}
              title={status === 'done' && outputs.length > 0 ? "重新生成" : "执行"}
              style={{
                flexShrink: 0,
                height: 28,
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: status === 'done' && outputs.length > 0 ? 'var(--color-success)' : 'var(--color-primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                cursor: canExecute ? 'pointer' : 'not-allowed',
                opacity: canExecute ? 1 : 0.5,
              }}
            >
              {status === 'done' && outputs.length > 0 ? <RotateCcw size={13} /> : <Play size={13} />}
            </button>
          ))}
        </div>
      </div>

      {/* Block all interaction while reverse-prompt is running */}
      {isReversingPrompt && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 100,
          cursor: 'not-allowed',
        }} onClick={(e) => e.stopPropagation()} />
      )}

      {/* Right-click context menu */}
      {ctxMenu && createPortal(
        <CardContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onViewConfig={() => { setCtxMenu(null); setShowConfigPanel(true); }}
          onRename={() => { setCtxMenu(null); startEditName(); }}
          onSetCover={async () => {
            setCtxMenu(null);
            // Determine which image URL to use as cover: prefer currently displayed output, fallback to input sessionUrl
            let sourceUrl = image.sessionUrl;
            if (displayOutput?.url) {
              sourceUrl = displayOutput.url;
            }
            if (!sourceUrl || !sessionId) {
              showToast('无法设为封面：图片尚未保存到会话');
              return;
            }
            try {
              await setSessionCover(sessionId, sourceUrl);
              showToast('已设为会话封面');
            } catch {
              showToast('设为封面失败');
            }
          }}
          onClose={() => setCtxMenu(null)}
        />,
        document.body,
      )}

      {/* Config detail panel */}
      {showConfigPanel && createPortal(
        <ConfigPanel
          activeTab={activeTab}
          text2imgConfig={text2imgConfig}
          zitConfig={zitConfig}
          onClose={() => setShowConfigPanel(false)}
        />,
        document.body,
      )}
    </div>
  );
}, arePropsEqual);

// ─── CardContextMenu ──────────────────────────────────────────────────

function CardContextMenu({ x, y, onViewConfig, onRename, onSetCover, onClose }: {
  x: number; y: number;
  onViewConfig: () => void;
  onRename: () => void;
  onSetCover: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [hoverIdx, setHoverIdx] = useState(-1);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) left = Math.max(0, window.innerWidth - rect.width);
    if (top + rect.height > window.innerHeight) top = Math.max(0, y - rect.height);
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const handleClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => { document.removeEventListener('keydown', handleKey); document.removeEventListener('mousedown', handleClick); };
  }, [onClose]);

  const items = [
    { icon: <FileText size={14} />, label: '查看配置', onClick: onViewConfig },
    { icon: <Pencil size={14} />, label: '重命名卡片', onClick: onRename },
    { icon: <ImagePlus size={14} />, label: '设为会话封面', onClick: onSetCover },
  ];

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        backgroundColor: 'var(--color-surface, #1e1e1e)',
        border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
        borderRadius: 8,
        padding: '4px 0',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        minWidth: 160,
        zIndex: 9999,
      }}
    >
      {items.map((item, idx) => (
        <div
          key={idx}
          style={{
            padding: '8px 12px',
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#e0e0e0',
            background: hoverIdx === idx ? 'rgba(128, 128, 128, 0.08)' : undefined,
          }}
          onMouseEnter={() => setHoverIdx(idx)}
          onMouseLeave={() => setHoverIdx(-1)}
          onClick={item.onClick}
        >
          {item.icon}
          {item.label}
        </div>
      ))}
    </div>
  );
}

// ─── ConfigPanel (modal) ──────────────────────────────────────────────

function ConfigFieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#e0e0e0', wordBreak: 'break-all' }}>{children}</div>
    </div>
  );
}

function ConfigPanel({ activeTab, text2imgConfig, zitConfig, onClose }: {
  activeTab: number;
  text2imgConfig?: import('../services/sessionService.js').Text2ImgConfig;
  zitConfig?: import('../services/sessionService.js').ZitConfig;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const config = activeTab === 7 ? text2imgConfig : activeTab === 9 ? zitConfig : undefined;

  const renderLoraList = (loras: import('../services/sessionService.js').LoraSlot[]) => {
    if (!loras || loras.length === 0) return <span style={{ color: '#666' }}>无</span>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {loras.map((lora, i) => {
          const name = lora.model.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || lora.model;
          return (
            <div key={i} style={{
              padding: '6px 10px',
              borderRadius: 6,
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              fontSize: 12,
            }}>
              <div style={{ color: '#e0e0e0', marginBottom: 2 }}>{name}</div>
              <div style={{ color: '#888', fontSize: 11 }}>
                强度: {lora.strength} · {lora.enabled ? '✓ 启用' : '✗ 禁用'}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999 }}
        onClick={onClose}
      />
      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: '#1a1a2e',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12,
        padding: 20,
        maxWidth: 480,
        width: '90vw',
        maxHeight: '70vh',
        overflow: 'auto',
        zIndex: 10000,
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#e0e0e0' }}>卡片配置详情</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {config && (
              <button
                onClick={() => {
                  const { applyConfigToSidebar } = useWorkflowStore.getState();
                  applyConfigToSidebar(config);
                  onClose();
                }}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#fff',
                  backgroundColor: '#4a9eff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#3a8eef'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#4a9eff'; }}
              >
                使用配置
              </button>
            )}
            <div
              onClick={onClose}
              style={{ cursor: 'pointer', color: '#888', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4 }}
            >
              <X size={16} />
            </div>
          </div>
        </div>

        {!config ? (
          <div style={{ color: '#666', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>无配置数据</div>
        ) : activeTab === 7 && text2imgConfig ? (
          <>
            <ConfigFieldRow label="模型">{text2imgConfig.model}</ConfigFieldRow>
            <ConfigFieldRow label="LoRA 列表">{renderLoraList(text2imgConfig.loras)}</ConfigFieldRow>
            <ConfigFieldRow label="提示词">
              <div style={{ whiteSpace: 'pre-wrap' }}>{text2imgConfig.prompt || '(空)'}</div>
            </ConfigFieldRow>
            <ConfigFieldRow label="负面提示词">
              <div style={{ whiteSpace: 'pre-wrap' }}>{text2imgConfig.negativePrompt || '(空)'}</div>
            </ConfigFieldRow>
            <ConfigFieldRow label="尺寸">{text2imgConfig.width} × {text2imgConfig.height}</ConfigFieldRow>
            <ConfigFieldRow label="步数">{text2imgConfig.steps}</ConfigFieldRow>
            <ConfigFieldRow label="CFG">{text2imgConfig.cfg}</ConfigFieldRow>
            <ConfigFieldRow label="采样器">{text2imgConfig.sampler}</ConfigFieldRow>
            <ConfigFieldRow label="调度器">{text2imgConfig.scheduler}</ConfigFieldRow>
            {text2imgConfig.referenceImage && (
              <div style={{ marginBottom: '6px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>参考图</div>
                <img
                  src={`/api/workflow/7/ref-image/${text2imgConfig.referenceImage}`}
                  alt="参考图"
                  style={{ width: '100%', maxHeight: '120px', objectFit: 'contain', borderRadius: '4px' }}
                />
                {text2imgConfig.poseStrength !== undefined && (
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
                    姿势: {text2imgConfig.poseStrength?.toFixed(2)} / 深度: {text2imgConfig.depthStrength?.toFixed(2)}
                  </div>
                )}
              </div>
            )}
          </>
        ) : activeTab === 9 && zitConfig ? (
          <>
            <ConfigFieldRow label="UNET 模型">{zitConfig.unetModel}</ConfigFieldRow>
            <ConfigFieldRow label="LoRA 列表">{renderLoraList(zitConfig.loras)}</ConfigFieldRow>
            <ConfigFieldRow label="提示词">
              <div style={{ whiteSpace: 'pre-wrap' }}>{zitConfig.prompt || '(空)'}</div>
            </ConfigFieldRow>
            <ConfigFieldRow label="Shift">{zitConfig.shiftEnabled ? `开启 (${zitConfig.shift})` : '关闭'}</ConfigFieldRow>
            <ConfigFieldRow label="尺寸">{zitConfig.width} × {zitConfig.height}</ConfigFieldRow>
            <ConfigFieldRow label="步数">{zitConfig.steps}</ConfigFieldRow>
            <ConfigFieldRow label="CFG">{zitConfig.cfg}</ConfigFieldRow>
            <ConfigFieldRow label="采样器">{zitConfig.sampler}</ConfigFieldRow>
            <ConfigFieldRow label="调度器">{zitConfig.scheduler}</ConfigFieldRow>
          </>
        ) : (
          <div style={{ color: '#666', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>无配置数据</div>
        )}
      </div>
    </>
  );
}
