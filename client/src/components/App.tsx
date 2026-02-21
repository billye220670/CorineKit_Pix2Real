import { useEffect, useCallback, useState } from 'react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { TabSwitcher } from './TabSwitcher.js';
import { DropZone } from './DropZone.js';
import { PhotoWall } from './PhotoWall.js';
import { ThemeToggle } from './ThemeToggle.js';
import { Trash2 } from 'lucide-react';
import { Toast } from './Toast.js';

export function App() {
  const images = useWorkflowStore((s) => s.tabData[s.activeTab]?.images ?? []);
  const clientId = useWorkflowStore((s) => s.clientId);
  const [releasing, setReleasing] = useState(false);
  useWebSocket();

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

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

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--color-bg)',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--spacing-md) var(--spacing-lg)',
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <TabSwitcher />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
          <button
            onClick={handleReleaseMemory}
            disabled={!clientId || releasing}
            title="释放显存/内存"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-xs)',
              padding: 'var(--spacing-xs) var(--spacing-sm)',
              backgroundColor: 'transparent',
              color: releasing ? 'var(--color-text-secondary)' : 'var(--color-error)',
              border: '1px solid',
              borderColor: releasing ? 'var(--color-border)' : 'var(--color-error)',
              borderRadius: 0,
              fontSize: '12px',
              fontWeight: 600,
              cursor: (!clientId || releasing) ? 'not-allowed' : 'pointer',
              opacity: (!clientId || releasing) ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            <Trash2 size={14} />
            {releasing ? '释放中...' : '释放显存'}
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* Main content */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}>
        {images.length === 0 ? (
          <DropZone fullscreen />
        ) : (
          <>
            <DropZone fullscreen={false} />
            <PhotoWall />
          </>
        )}
      </main>
      <Toast />
    </div>
  );
}
