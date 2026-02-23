import { X } from 'lucide-react';

interface ProgressOverlayProps {
  status: 'queued' | 'processing';
  progress: number;
  onCancel?: () => void;
}

export function ProgressOverlay({ status, progress, onCancel }: ProgressOverlayProps) {
  const isQueued = status === 'queued';
  const isLoading = status === 'processing' && progress === 0;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      backgroundColor: 'var(--color-overlay)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--spacing-sm)',
    }}>

      {/* Cancel button — only visible when queued */}
      {isQueued && onCancel && (
        <button
          onClick={onCancel}
          title="从队列移除"
          style={{
            position: 'absolute',
            top: 'var(--spacing-sm)',
            right: 'var(--spacing-sm)',
            padding: '3px',
            backgroundColor: 'rgba(0,0,0,0.55)',
            color: '#ffffff',
            border: '1px solid rgba(255,255,255,0.25)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            lineHeight: 0,
          }}
        >
          <X size={13} />
        </button>
      )}

      {/* Status text */}
      {isQueued && (
        <div style={{ color: '#ffffff', fontSize: '18px', fontWeight: 700 }}>
          队列中
        </div>
      )}

      {isLoading && (
        <div style={{ color: '#ffffff', fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'flex-end', gap: '1px' }}>
          <span>加载中</span>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                display: 'inline-block',
                animation: 'dot-wave 1.4s ease-in-out infinite',
                animationDelay: `${i * 0.2}s`,
                marginBottom: '1px',
              }}
            >.</span>
          ))}
        </div>
      )}

      {!isQueued && !isLoading && (
        <div style={{
          color: '#ffffff',
          fontSize: '24px',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {progress}%
        </div>
      )}

      {/* Progress bar — only during active sampling */}
      {!isQueued && !isLoading && (
        <div style={{
          width: '60%',
          height: '4px',
          backgroundColor: 'rgba(255, 255, 255, 0.2)',
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            backgroundColor: 'var(--color-primary)',
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}
    </div>
  );
}
