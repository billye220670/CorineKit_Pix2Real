import { useEffect, useCallback, useState, useRef } from 'react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useImageImporter } from '../hooks/useImageImporter.js';
import { TabSwitcher } from './TabSwitcher.js';
import { DropZone } from './DropZone.js';
import { PhotoWall } from './PhotoWall.js';
import { ThemeToggle } from './ThemeToggle.js';
import { Upload, Trash2, ListOrdered } from 'lucide-react';
import { Toast } from './Toast.js';
import { QueuePanel } from './QueuePanel.js';

interface SysStats { vram: number | null; ram: number; }

function usageColor(pct: number): string {
  if (pct < 50) return '#4CAF50';
  if (pct < 75) return '#FF9800';
  if (pct < 90) return '#FF5722';
  return '#f44336';
}

function isImageOrVideo(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/');
}

async function readFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file((f) => {
        if (isImageOrVideo(f)) resolve([f]);
        else resolve([]);
      });
    });
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    return new Promise((resolve) => {
      reader.readEntries(async (entries) => {
        const allFiles: File[] = [];
        for (const e of entries) {
          const files = await readFilesFromEntry(e);
          allFiles.push(...files);
        }
        resolve(allFiles);
      });
    });
  }
  return [];
}

export function App() {
  const images = useWorkflowStore((s) => s.tabData[s.activeTab]?.images ?? []);
  const clientId = useWorkflowStore((s) => s.clientId);
  const hasAnyProcessing = useWorkflowStore((s) =>
    Object.values(s.tabData).some((tab) =>
      Object.values(tab.tasks).some((t) => t.status === 'processing' || t.status === 'queued')
    )
  );
  const { importFiles, dialog, overwrite, keepBoth, cancel } = useImageImporter();
  const [releasing, setReleasing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [displayStats, setDisplayStats] = useState<SysStats | null>(null);
  const targetStatsRef = useRef<SysStats | null>(null);
  const currentVramRef = useRef<number | null>(null);
  const currentRamRef = useRef<number>(0);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const queueWrapperRef = useRef<HTMLDivElement>(null);
  useWebSocket();

  // Polling — only updates the target; display is driven by the rAF loop below
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/workflow/system-stats');
        if (res.ok) {
          const data: SysStats = await res.json();
          if (targetStatsRef.current === null) {
            // First value: seed the running values so there's no initial jump
            currentVramRef.current = data.vram;
            currentRamRef.current = data.ram;
          }
          targetStatsRef.current = data;
        }
      } catch { /* ComfyUI not ready yet */ }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, []);

  // Continuous rAF loop — lerps display toward target every frame
  useEffect(() => {
    const LERP = 0.012;
    let rafId: number;
    const frame = () => {
      rafId = requestAnimationFrame(frame);
      const target = targetStatsRef.current;
      if (!target) return;
      currentVramRef.current = currentVramRef.current !== null && target.vram !== null
        ? currentVramRef.current + (target.vram - currentVramRef.current) * LERP
        : target.vram;
      currentRamRef.current = currentRamRef.current + (target.ram - currentRamRef.current) * LERP;
      const roundedVram = currentVramRef.current !== null ? Math.round(currentVramRef.current) : null;
      const roundedRam = Math.round(currentRamRef.current);
      setDisplayStats((prev) => {
        if (prev?.vram === roundedVram && prev?.ram === roundedRam) return prev;
        return { vram: roundedVram, ram: roundedRam };
      });
    };
    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
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

  const handleReleaseMemory = useCallback(async () => {
    if (!clientId || releasing) return;
    setReleasing(true);
    try {
      const res = await fetch(`/api/workflow/release-memory?clientId=${clientId}`, {
        method: 'POST',
      });
      if (!res.ok) {
        console.error('Release memory failed:', await res.text());
      }
    } catch (err) {
      console.error('Release memory error:', err);
    } finally {
      // Brief delay so user sees the disabled state
      setTimeout(() => setReleasing(false), 2000);
    }
  }, [clientId, releasing]);

  // Main-area drag handlers — only activate for external file drops, not ImageCard drags
  const handleMainDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-workflow-image')) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleMainDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      setIsDragOver(false);
    }
  }, []);

  const handleMainDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const items = e.dataTransfer.items;
    const files: File[] = [];

    if (items) {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      for (const entry of entries) {
        const entryFiles = await readFilesFromEntry(entry);
        files.push(...entryFiles);
      }
    }

    if (files.length === 0) {
      const dtFiles = Array.from(e.dataTransfer.files).filter(isImageOrVideo);
      files.push(...dtFiles);
    }

    if (files.length > 0) {
      importFiles(files);
    }
  }, [importFiles]);

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      backgroundColor: 'var(--color-bg)',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--spacing-lg)',
        height: '64px',
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <TabSwitcher />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
          {/* Release memory button + stats — stats sit outside the button so queue-disabled state doesn't dim them */}
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
            <button
              onClick={handleReleaseMemory}
              disabled={!clientId || releasing || hasAnyProcessing}
              title={hasAnyProcessing ? '队列执行中，无法释放' : '释放显存/内存'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs)',
                padding: 'var(--spacing-sm) var(--spacing-md)',
                backgroundColor: 'transparent',
                color: 'var(--color-text-secondary)',
                border: 'none',
                borderRadius: 0,
                fontSize: '12px',
                fontWeight: 600,
                cursor: (!clientId || releasing || hasAnyProcessing) ? 'not-allowed' : 'pointer',
                opacity: (!clientId || releasing || hasAnyProcessing) ? 0.45 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              <Trash2 size={14} />
              {releasing ? '释放中...' : '释放显存'}
            </button>
            {displayStats && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 6, paddingRight: 10, borderLeft: '1px solid var(--color-border)' }}>
                {displayStats.vram !== null && (
                  <span style={{ fontSize: '11px', fontWeight: 700, color: usageColor(displayStats.vram) }}>
                    显存{displayStats.vram}%
                  </span>
                )}
                {displayStats.vram !== null && (
                  <span style={{ fontSize: '11px', opacity: 0.35 }}>·</span>
                )}
                <span style={{ fontSize: '11px', fontWeight: 700, color: usageColor(displayStats.ram) }}>
                  内存{displayStats.ram}%
                </span>
              </span>
            )}
          </div>

          {/* Queue manager */}
          <div ref={queueWrapperRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setIsQueueOpen((v) => !v)}
              title="管理任务队列"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs)',
                padding: 'var(--spacing-sm) var(--spacing-md)',
                backgroundColor: isQueueOpen ? 'var(--color-surface-hover)' : 'transparent',
                color: isQueueOpen ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                border: '1px solid',
                borderColor: isQueueOpen ? 'var(--color-primary)' : 'var(--color-border)',
                borderRadius: 0,
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <ListOrdered size={14} />
              管理队列
            </button>
            {isQueueOpen && <QueuePanel onClose={() => setIsQueueOpen(false)} />}
          </div>

          <ThemeToggle />
        </div>
      </header>

      {/* Main content — entire area accepts file drops */}
      <main
        onDragOver={handleMainDragOver}
        onDragLeave={handleMainDragLeave}
        onDrop={handleMainDrop}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {images.length === 0 ? (
          <DropZone fullscreen importFiles={importFiles} onDropHandled={() => setIsDragOver(false)} />
        ) : (
          <PhotoWall />
        )}

        {/* Fullscreen drop overlay — shown when dragging files over the photo wall */}
        {isDragOver && images.length > 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              border: '2px dashed var(--color-primary)',
              backgroundColor: 'var(--color-surface-hover)',
              opacity: 0.92,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--spacing-md)',
              zIndex: 50,
              pointerEvents: 'none',
            }}
          >
            <Upload size={48} strokeWidth={1.5} style={{ color: 'var(--color-primary)' }} />
            <p style={{ color: 'var(--color-primary)', fontSize: '15px', fontWeight: 600 }}>
              拖入图片或文件夹
            </p>
          </div>
        )}
      </main>

      {/* Duplicate filename confirmation dialog */}
      {dialog && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9000,
        }}>
          <div style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            padding: 'var(--spacing-lg)',
            maxWidth: '400px',
            width: '90%',
          }}>
            <p style={{ fontWeight: 600, fontSize: '14px', marginBottom: 'var(--spacing-sm)', color: 'var(--color-text)' }}>
              发现重复文件名
            </p>
            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-xs)' }}>
              以下文件在当前标签页已存在：
            </p>
            <ul style={{ margin: `0 0 var(--spacing-md) var(--spacing-md)`, padding: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              {dialog.duplicateNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
              <button
                onClick={cancel}
                style={{
                  padding: 'var(--spacing-xs) var(--spacing-sm)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 0,
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={keepBoth}
                style={{
                  padding: 'var(--spacing-xs) var(--spacing-sm)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 0,
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                重复导入
              </button>
              <button
                onClick={overwrite}
                style={{
                  padding: 'var(--spacing-xs) var(--spacing-sm)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-primary)',
                  border: '1px solid var(--color-primary)',
                  borderRadius: 0,
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                覆盖导入
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast />
    </div>
  );
}
