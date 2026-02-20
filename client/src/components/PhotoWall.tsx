import { useState, useCallback } from 'react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { ImageCard } from './ImageCard.js';
import { Play, Trash2, FolderOpen, LayoutGrid } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket.js';

type ViewSize = 'small' | 'medium' | 'large';

const VIEW_CONFIG: Record<ViewSize, { columnWidth: string; label: string }> = {
  small: { columnWidth: '180px', label: '小' },
  medium: { columnWidth: '280px', label: '中' },
  large: { columnWidth: '420px', label: '大' },
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
  const { sendMessage } = useWebSocket();

  const [viewSize, setViewSize] = useState<ViewSize>(getInitialViewSize);

  const hasIdle = images.some((img) => {
    const task = tasks[img.id];
    return !task || task.status === 'idle';
  });

  const handleViewSizeChange = useCallback((size: ViewSize) => {
    setViewSize(size);
    localStorage.setItem('viewSize', size);
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      await fetch(`/api/workflow/${activeTab}/open-folder`, { method: 'POST' });
    } catch (err) {
      console.error('Open folder error:', err);
    }
  }, [activeTab]);

  const handleBatchExecute = async () => {
    if (!clientId) return;

    for (const img of images) {
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

        // Register prompt -> workflow mapping on the WS
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

  const sizes: ViewSize[] = ['small', 'medium', 'large'];

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-lg)' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--spacing-sm)',
        marginBottom: 'var(--spacing-md)',
      }}>
        {/* Left: view size toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)' }}>
          <LayoutGrid size={14} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
          {sizes.map((size) => (
            <button
              key={size}
              onClick={() => handleViewSizeChange(size)}
              style={{
                padding: '2px var(--spacing-sm)',
                backgroundColor: viewSize === size ? 'var(--color-primary)' : 'transparent',
                color: viewSize === size ? '#ffffff' : 'var(--color-text-secondary)',
                border: '1px solid',
                borderColor: viewSize === size ? 'var(--color-primary)' : 'var(--color-border)',
                borderRadius: 0,
                fontSize: '12px',
                fontWeight: viewSize === size ? 600 : 400,
                cursor: 'pointer',
                lineHeight: '20px',
              }}
            >
              {VIEW_CONFIG[size].label}
            </button>
          ))}
        </div>

        {/* Right: open folder + clear + batch execute */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
          <button
            onClick={handleOpenFolder}
            title="打开输出文件夹"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-xs)',
              padding: 'var(--spacing-sm) var(--spacing-md)',
              backgroundColor: 'transparent',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 0,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <FolderOpen size={14} />
            打开文件夹
          </button>
          <button
            onClick={clearCurrentImages}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-xs)',
              padding: 'var(--spacing-sm) var(--spacing-md)',
              backgroundColor: 'transparent',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 0,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <Trash2 size={14} />
            清空
          </button>
          {hasIdle && (
            <button
              onClick={handleBatchExecute}
              disabled={!clientId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-sm)',
                padding: 'var(--spacing-sm) var(--spacing-md)',
                backgroundColor: 'var(--color-primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 0,
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                opacity: clientId ? 1 : 0.5,
              }}
            >
              <Play size={16} />
              全部执行
            </button>
          )}
        </div>
      </div>

      {/* Photo wall grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${VIEW_CONFIG[viewSize].columnWidth}, 1fr))`,
        gap: 'var(--spacing-md)',
      }}>
        {images.map((img) => (
          <ImageCard key={img.id} image={img} />
        ))}
      </div>
    </div>
  );
}
