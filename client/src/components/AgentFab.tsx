import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAgentStore } from '../hooks/useAgentStore.js';

export function AgentFab({ rightOffset = 0 }: { rightOffset?: number }) {
  const toggleDialog = useAgentStore((s) => s.toggleDialog);
  const isOpen = useAgentStore((s) => s.isDialogOpen);
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={toggleDialog}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16 + rightOffset,
        width: 48,
        height: 48,
        borderRadius: '50%',
        backgroundColor: 'var(--color-primary)',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        zIndex: 100,
        boxShadow: hovered
          ? '0 8px 24px rgba(33, 150, 243, 0.6)'
          : '0 4px 12px rgba(33, 150, 243, 0.4)',
        transition: 'all 0.3s ease',
        transform: hovered ? 'scale(1.05)' : 'scale(1)',
      }}
    >
      <Sparkles
        size={22}
        style={{
          transition: 'transform 0.3s ease',
          transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
        }}
      />
    </button>
  );
}
