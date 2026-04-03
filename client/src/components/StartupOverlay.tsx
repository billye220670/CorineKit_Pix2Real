import { useState, useEffect, useRef } from 'react';

type OverlayState = 'CHECKING' | 'WAITING' | 'READY' | 'HIDDEN';

export function StartupOverlay() {
  const [state, setState] = useState<OverlayState>('CHECKING');
  const [seconds, setSeconds] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  
  const pollIntervalRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const fadeTimeoutRef = useRef<number | null>(null);

  // Check ComfyUI status
  const checkStatus = async (): Promise<boolean> => {
    try {
      const res = await fetch('http://localhost:3000/api/comfyui/status');
      const { running } = await res.json();
      return running;
    } catch {
      return false;
    }
  };

  // Cleanup all timers
  const cleanup = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (fadeTimeoutRef.current) {
      clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = null;
    }
  };

  // Handle ready state
  const handleReady = () => {
    cleanup();
    setState('READY');
    
    // Wait 1.5s then start fade out
    fadeTimeoutRef.current = window.setTimeout(() => {
      setFadeOut(true);
      // After fade animation completes, hide completely
      fadeTimeoutRef.current = window.setTimeout(() => {
        setState('HIDDEN');
      }, 500);
    }, 1500);
  };

  // Initial check and setup polling
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const running = await checkStatus();
      if (!mounted) return;

      if (running) {
        setState('HIDDEN');
        return;
      }

      // Not running, start waiting
      setState('WAITING');

      // Start countdown timer (1s interval)
      timerIntervalRef.current = window.setInterval(() => {
        if (mounted) setSeconds(s => s + 1);
      }, 1000);

      // Start polling (2s interval)
      pollIntervalRef.current = window.setInterval(async () => {
        const isRunning = await checkStatus();
        if (isRunning && mounted) {
          handleReady();
        }
      }, 2000);
    };

    init();

    return () => {
      mounted = false;
      cleanup();
    };
  }, []);

  // Don't render if hidden
  if (state === 'HIDDEN') return null;

  const isReady = state === 'READY';
  const isChecking = state === 'CHECKING';

  // Styles
  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 99999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    opacity: fadeOut ? 0 : 1,
    transition: 'opacity 0.5s ease-out',
  };

  const panelStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-surface)',
    borderRadius: '12px',
    padding: '32px 48px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    minWidth: '280px',
  };

  const spinnerStyle: React.CSSProperties = {
    width: '48px',
    height: '48px',
    border: '3px solid var(--color-border)',
    borderTopColor: 'var(--color-primary)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  };

  const checkmarkStyle: React.CSSProperties = {
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '32px',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--color-text)',
    margin: 0,
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: '14px',
    color: 'var(--color-text-secondary)',
    margin: 0,
  };

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        {isReady ? (
          <div style={checkmarkStyle}>✅</div>
        ) : (
          <div style={spinnerStyle} />
        )}
        
        <p style={titleStyle}>
          {isChecking ? '检测 ComfyUI 状态...' : isReady ? '一切就绪！' : '正在启动 ComfyUI...'}
        </p>
        
        {!isReady && !isChecking && (
          <p style={subtitleStyle}>已等待 {seconds} 秒</p>
        )}
      </div>
    </div>
  );
}
