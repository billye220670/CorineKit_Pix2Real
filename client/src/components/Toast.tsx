import { useToastMessage } from '../hooks/useToast.js';

export function Toast() {
  const { message, key, isExiting, action, dismiss } = useToastMessage();
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
        pointerEvents: action ? 'auto' : 'none',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        animation: isExiting
          ? 'toast-fly-out 0.28s ease forwards'
          : 'toast-fly-in 0.22s cubic-bezier(0.22,1,0.36,1) both',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <span>{message}</span>
      {action && (
        <button
          onClick={() => {
            action.onClick();
            dismiss();
          }}
          style={{
            marginLeft: 12,
            padding: '2px 10px',
            background: 'var(--accent-color, #7c5cbf)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
