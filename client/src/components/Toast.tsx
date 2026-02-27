import { useToastMessage } from '../hooks/useToast.js';

export function Toast() {
  const { message, key, isExiting } = useToastMessage();
  if (!message) return null;
  return (
    <div
      key={key}
      style={{
        position: 'fixed',
        top: 'var(--spacing-lg)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        backgroundColor: 'var(--color-primary)',
        color: '#fff',
        padding: '10px 20px',
        fontSize: '13px',
        fontWeight: 500,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        animation: isExiting
          ? 'toast-fly-out 0.28s ease forwards'
          : 'toast-fly-in 0.22s cubic-bezier(0.22,1,0.36,1) both',
      }}
    >
      {message}
    </div>
  );
}
