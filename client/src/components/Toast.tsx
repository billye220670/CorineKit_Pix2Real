import { useToastMessage } from '../hooks/useToast.js';

export function Toast() {
  const message = useToastMessage();
  if (!message) return null;
  return (
    <div style={{
      position: 'fixed',
      top: 'var(--spacing-lg)',
      right: 'var(--spacing-lg)',
      zIndex: 9999,
      backgroundColor: 'var(--color-primary)',
      color: '#fff',
      padding: 'var(--spacing-sm) var(--spacing-md)',
      fontSize: '13px',
      fontWeight: 500,
      pointerEvents: 'none',
    }}>
      {message}
    </div>
  );
}
