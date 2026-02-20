interface ProgressOverlayProps {
  progress: number;
}

export function ProgressOverlay({ progress }: ProgressOverlayProps) {
  const isQueued = progress === 0;

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
      {/* Status text */}
      <div style={{
        color: '#ffffff',
        fontSize: isQueued ? '18px' : '24px',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {isQueued ? '队列中' : `${progress}%`}
      </div>

      {/* Progress bar (only when actually processing) */}
      {!isQueued && (
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
