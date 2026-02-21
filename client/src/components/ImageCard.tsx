import { useCallback, useState, useRef } from 'react';
import { X, Play, Check, AlertCircle } from 'lucide-react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { ProgressOverlay } from './ProgressOverlay.js';
import type { ImageItem } from '../types/index.js';

interface ImageCardProps {
  image: ImageItem;
}

export function ImageCard({ image }: ImageCardProps) {
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const workflows = useWorkflowStore((s) => s.workflows);
  const clientId = useWorkflowStore((s) => s.clientId);
  const prompts = useWorkflowStore((s) => s.tabData[s.activeTab]?.prompts ?? {});
  const tasks = useWorkflowStore((s) => s.tabData[s.activeTab]?.tasks ?? {});
  const removeImage = useWorkflowStore((s) => s.removeImage);
  const setPrompt = useWorkflowStore((s) => s.setPrompt);
  const startTask = useWorkflowStore((s) => s.startTask);
  const { sendMessage } = useWebSocket();

  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const task = tasks[image.id];
  const status = task?.status || 'idle';
  const progress = task?.progress || 0;
  const needsPrompt = workflows[activeTab]?.needsPrompt ?? false;
  const isVideoWorkflow = activeTab === 3 || activeTab === 4;
  const isProcessing = status === 'processing';
  const canExecute = !!clientId && !isProcessing;

  // Pick the right output to display
  const outputs = task?.outputs || [];
  let displayOutput = outputs.length > 0 ? outputs[outputs.length - 1] : null;
  if (isVideoWorkflow && outputs.length > 1) {
    const interpolated = outputs.find((o) => o.filename.includes('插帧'));
    if (interpolated) displayOutput = interpolated;
  }

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

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-workflow-image', image.id);
    e.dataTransfer.effectAllowed = 'copy';
    setIsDragging(true);
  }, [image.id]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleExecute = useCallback(async () => {
    if (!clientId) return;

    const formData = new FormData();
    formData.append('image', image.file);
    formData.append('clientId', clientId);
    formData.append('prompt', prompts[image.id] || '');

    try {
      const res = await fetch(`/api/workflow/${activeTab}/execute?clientId=${clientId}`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        console.error('Execute failed:', await res.text());
        return;
      }

      const data = await res.json();
      startTask(image.id, data.promptId);

      sendMessage({
        type: 'register',
        promptId: data.promptId,
        workflowId: activeTab,
      });
    } catch (err) {
      console.error('Execute error:', err);
    }
  }, [clientId, image, activeTab, prompts, startTask, sendMessage]);

  return (
    <div
      draggable={!isProcessing}
      onDragStart={isProcessing ? undefined : handleDragStart}
      onDragEnd={handleDragEnd}
      style={{
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        overflow: 'hidden',
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        transition: 'opacity 0.15s',
      }}
    >
      {/* Image container */}
      <div
        style={{ position: 'relative' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Original image - always rendered, determines container size */}
        <img
          src={image.previewUrl}
          alt={image.originalName}
          style={{ width: '100%', display: 'block' }}
        />

        {/* Output overlay */}
        {displayOutput && (
          isVideoWorkflow ? (
            /* Video: hidden by default, plays on hover */
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
            /* Image: shown by default, fades out on hover to reveal original */
            <img
              src={displayOutput.url}
              alt="Output"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                display: 'block',
                opacity: isHovered ? 0 : 1,
                transition: 'opacity 0.2s ease',
                pointerEvents: 'none',
              }}
            />
          )
        )}

        {/* Progress overlay */}
        {isProcessing && (
          <ProgressOverlay progress={progress} />
        )}

        {/* Done badge (top-left) */}
        {status === 'done' && (
          <div style={{
            position: 'absolute',
            top: 'var(--spacing-sm)',
            left: 'var(--spacing-sm)',
            backgroundColor: 'var(--color-success)',
            color: '#fff',
            padding: 'var(--spacing-xs)',
            display: 'flex',
            alignItems: 'center',
          }}>
            <Check size={16} />
          </div>
        )}

        {/* Error badge (top-left) */}
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

        {/* Remove button (top-right) - visible when not processing */}
        {!isProcessing && (
          <button
            onClick={() => removeImage(image.id)}
            style={{
              position: 'absolute',
              top: 'var(--spacing-sm)',
              right: 'var(--spacing-sm)',
              padding: 'var(--spacing-xs)',
              backgroundColor: 'rgba(0,0,0,0.5)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Card footer */}
      <div style={{ padding: 'var(--spacing-sm)' }}>
        {/* Filename */}
        <div style={{
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: needsPrompt ? 'var(--spacing-sm)' : 0,
        }}>
          {image.originalName}
        </div>

        {/* Prompt input (conditional) */}
        {needsPrompt && (
          <textarea
            placeholder={activeTab === 3 ? '输入提示词（留空使用默认）' : '额外提示词（可选）'}
            value={prompts[image.id] || ''}
            onChange={(e) => setPrompt(image.id, e.target.value)}
            disabled={isProcessing}
            rows={2}
            style={{
              width: '100%',
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

        {/* Execute button - always visible, disabled during processing */}
        <button
          onClick={handleExecute}
          disabled={!canExecute}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--spacing-xs)',
            width: '100%',
            marginTop: 'var(--spacing-sm)',
            padding: 'var(--spacing-xs) var(--spacing-sm)',
            backgroundColor: 'var(--color-primary)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 0,
            fontSize: '12px',
            fontWeight: 600,
            cursor: canExecute ? 'pointer' : 'not-allowed',
            opacity: canExecute ? 1 : 0.5,
          }}
        >
          <Play size={12} />
          {status === 'done' ? '重新生成' : '执行'}
        </button>
      </div>
    </div>
  );
}
