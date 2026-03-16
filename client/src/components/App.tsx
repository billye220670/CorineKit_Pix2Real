import { useEffect, useCallback, useState } from 'react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useImageImporter } from '../hooks/useImageImporter.js';
import { useSession } from '../hooks/useSession.js';
import { Sidebar } from './Sidebar.js';
import { DropZone } from './DropZone.js';
import { PhotoWall, VIEW_CONFIG, type ViewSize } from './PhotoWall.js';
import { FaceSwapPhotoWall } from './FaceSwapPhotoWall.js';
import { Text2ImgSidebar } from './Text2ImgSidebar.js';
import { Workflow0SettingsPanel } from './Workflow0SettingsPanel.js';
import { ThemeToggle } from './ThemeToggle.js';
import { SessionBar } from './SessionBar.js';
import { StatusBar } from './StatusBar.js';
import { Settings, Upload } from 'lucide-react';
import { Toast } from './Toast.js';
import { MaskEditor } from './MaskEditor.js';
import { SettingsModal } from './SettingsModal.js';
import { PromptAssistantPanel } from './PromptAssistantPanel.js';
import { StartupDialog } from './StartupDialog.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';

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
  const activeTab = useWorkflowStore((s) => s.activeTab);
  const { importFiles, dialog, overwrite, keepBoth, cancel } = useImageImporter();
  const { sessionId, lastSavedAt, newSession, startupDialog } = useSession();
  const openSettings = useSettingsStore((s) => s.openSettings);
  const [isDragOver, setIsDragOver] = useState(false);
  const [viewSize, setViewSize] = useState<ViewSize>(() => {
    const saved = localStorage.getItem('viewSize');
    if (saved === 'small' || saved === 'medium' || saved === 'large') return saved;
    return 'medium';
  });
  const cycleViewSize = useCallback(() => {
    const next: Record<ViewSize, ViewSize> = { small: 'medium', medium: 'large', large: 'small' };
    setViewSize((cur) => {
      const nextSize = next[cur];
      localStorage.setItem('viewSize', nextSize);
      return nextSize;
    });
  }, []);
  useWebSocket();

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  // Main-area drag handlers — only activate for external file drops, not ImageCard drags
  const handleMainDragOver = useCallback((e: React.DragEvent) => {
    if (activeTab === 7) return; // tab 7 is text-to-image only
    if (activeTab === 8) return; // tab 8 has its own zone drops
    if (e.dataTransfer.types.includes('application/x-workflow-image')) return;
    if (e.dataTransfer.types.includes('application/x-thumb-output')) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setIsDragOver(true);
  }, [activeTab]);

  const handleMainDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      setIsDragOver(false);
    }
  }, []);

  const handleMainDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    // Tab 7 is text-to-image only; ignore external file drops
    if (activeTab === 7) return;
    // Tab 8 has its own zone drops in FaceSwapPhotoWall
    if (activeTab === 8) return;

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

    if (files.length > 0) importFiles(files);
  }, [activeTab, importFiles]);

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
        height: '48px',
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        flexShrink: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}>
          <img src="/logo.png" alt="logo" style={{ width: 28, height: 28, objectFit: 'contain' }} />
          <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)' }}>
            Pix2Real
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
          <SessionBar sessionId={sessionId} onNewSession={newSession} />
          <ThemeToggle />
          <button
            onClick={openSettings}
            title="设置"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--spacing-sm)',
              color: 'var(--color-text)',
              border: 'none',
              borderRadius: 0,
              backgroundColor: 'transparent',
              opacity: 0.55,
              cursor: 'pointer',
            }}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* Body: Sidebar + Main content */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
      }}>
        <Sidebar />

        {/* Main content — entire area accepts file drops */}
        <main
          onDragOver={handleMainDragOver}
          onDragLeave={handleMainDragLeave}
          onDrop={handleMainDrop}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          {images.length === 0 && activeTab !== 7 && activeTab !== 8 ? (
            <DropZone fullscreen importFiles={importFiles} onDropHandled={() => setIsDragOver(false)} />
          ) : (
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {activeTab === 8 ? (
                <FaceSwapPhotoWall viewSize={viewSize} />
              ) : (
                <>
                  <PhotoWall viewSize={viewSize} />
                  {activeTab === 7 && <Text2ImgSidebar />}
                  {activeTab === 0 && <Workflow0SettingsPanel />}
                </>
              )}
            </div>
          )}

          {/* Fullscreen drop overlay */}
          {isDragOver && images.length > 0 && (
            <div style={{
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
            }}>
              <Upload size={48} strokeWidth={1.5} style={{ color: 'var(--color-primary)' }} />
              <p style={{ color: 'var(--color-primary)', fontSize: '15px', fontWeight: 600 }}>
                拖入图片或文件夹
              </p>
            </div>
          )}
        </main>
      </div>

      {/* Status bar */}
      <StatusBar lastSavedAt={lastSavedAt} sessionId={sessionId} viewLabel={VIEW_CONFIG[viewSize].label} onCycleViewSize={cycleViewSize} />

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
              <button onClick={cancel} style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', backgroundColor: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 0, fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                取消
              </button>
              <button onClick={keepBoth} style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', backgroundColor: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 0, fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                重复导入
              </button>
              <button onClick={overwrite} style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', backgroundColor: 'transparent', color: 'var(--color-primary)', border: '1px solid var(--color-primary)', borderRadius: 0, fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                覆盖导入
              </button>
            </div>
          </div>
        </div>
      )}

      {startupDialog && (
        <StartupDialog
          onRestore={startupDialog.onRestore}
          onStartNew={startupDialog.onStartNew}
        />
      )}
      <Toast />
      <MaskEditor />
      <SettingsModal />
      <PromptAssistantPanel />
    </div>
  );
}
