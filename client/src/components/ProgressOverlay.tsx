import { X } from 'lucide-react';

interface ProgressOverlayProps {
  status: 'queued' | 'processing';
  progress: number;
  stage?: string;
  stepIndex?: number;
  stepTotal?: number;
  onCancel?: () => void;
}

export function ProgressOverlay({ status, progress, stage, stepIndex, stepTotal, onCancel }: ProgressOverlayProps) {
  const isQueued = status === 'queued';
  // 还没有进入第一个节点时展示“准备中…”动画
  const noStageYet = status === 'processing' && !stage;

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

      {noStageYet && (
        <div style={{ color: '#ffffff', fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'flex-end', gap: '1px' }}>
          <span>准备中</span>
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

      {/* Stage label — small text above the percentage */}
      {!isQueued && stage && (
        <div style={{
          color: 'rgba(255,255,255,0.88)',
          fontSize: '12px',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          lineHeight: 1.1,
        }}>
          <span>{stage}</span>
          {stepIndex && stepTotal ? (
            <span style={{ fontSize: '10px', opacity: 0.65, fontVariantNumeric: 'tabular-nums' }}>
              {stepIndex}/{stepTotal}
            </span>
          ) : null}
        </div>
      )}

      {/* Percentage number */}
      {!isQueued && stage && (
        <div style={{
          color: '#ffffff',
          fontSize: '24px',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {progress}%
        </div>
      )}

      {/* Progress bar */}
      {!isQueued && stage && (
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
