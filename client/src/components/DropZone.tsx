import { useCallback, useState } from 'react';
import { Upload } from 'lucide-react';

interface DropZoneProps {
  fullscreen: boolean;
  importFiles: (files: File[]) => void;
  onDropHandled?: () => void;
  activeTab?: number;
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

export function DropZone({ fullscreen, importFiles, onDropHandled, activeTab }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Determine file type filter based on active tab
  const filterByTab = useCallback((files: File[]): File[] => {
    if (activeTab === 4) return files.filter((f) => f.type.startsWith('video/'));
    if (activeTab === 3) return files.filter((f) => f.type.startsWith('image/'));
    return files;
  }, [activeTab]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // prevent App.tsx main-level drop from also processing these files
    setIsDragOver(false);
    onDropHandled?.();

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
      // Fallback to plain files
      const dtFiles = Array.from(e.dataTransfer.files).filter(isImageOrVideo);
      files.push(...dtFiles);
    }

    if (files.length > 0) {
      const filtered = filterByTab(files);
      if (filtered.length > 0) importFiles(filtered);
    }
  }, [importFiles, onDropHandled, filterByTab]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(isImageOrVideo);
    const filtered = filterByTab(files);
    if (filtered.length > 0) {
      importFiles(filtered);
    }
    e.target.value = '';
  }, [importFiles, filterByTab]);

  if (fullscreen) {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--spacing-md)',
          border: `2px dashed ${isDragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
          borderRadius: '12px',
          margin: 'var(--spacing-lg)',
          backgroundColor: isDragOver ? 'var(--color-surface-hover)' : 'var(--color-surface)',
          transition: 'all 0.15s',
          cursor: 'pointer',
          position: 'relative',
        }}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <Upload
          size={48}
          strokeWidth={1.5}
          style={{ color: isDragOver ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
        />
        <p style={{
          color: 'var(--color-text-secondary)',
          fontSize: '15px',
        }}>
          {activeTab === 4 ? '拖入视频文件，或点击选择' : activeTab === 3 ? '拖入图片或文件夹，或点击选择文件' : '拖入图片或文件夹，或点击选择文件'}
        </p>
        <input
          id="file-input"
          type="file"
          multiple
          accept={activeTab === 4 ? 'video/*' : activeTab === 3 ? 'image/*' : 'image/*,video/*'}
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{
        padding: 'var(--spacing-sm) var(--spacing-lg)',
        borderBottom: `1px solid ${isDragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
        backgroundColor: isDragOver ? 'var(--color-surface-hover)' : 'var(--color-surface)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-sm)',
        fontSize: '13px',
        color: 'var(--color-text-secondary)',
        transition: 'all 0.15s',
        cursor: 'pointer',
      }}
      onClick={() => document.getElementById('file-input-bar')?.click()}
    >
      <Upload size={16} strokeWidth={1.5} />
      <span>拖入或点击追加图片</span>
      <input
        id="file-input-bar"
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={handleFileInput}
        style={{ display: 'none' }}
      />
    </div>
  );
}
