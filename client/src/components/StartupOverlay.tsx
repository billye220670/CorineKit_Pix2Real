import { useState, useEffect, useRef } from 'react';
import { useWorkflowStore } from '../hooks/useWorkflowStore.js';

type OverlayState = 'CHECKING' | 'WAITING' | 'CONNECTING' | 'READY' | 'HIDDEN';

// Session-scoped flag: once the overlay has completed its ready handshake,
// skip it for any subsequent mount (e.g. window.location.reload() triggered
// when entering a session from the welcome page).
const READY_FLAG_KEY = 'pix2real_startup_overlay_shown';

export function StartupOverlay() {
  const alreadyShown = typeof window !== 'undefined' && sessionStorage.getItem(READY_FLAG_KEY) === '1';
  const [state, setState] = useState<OverlayState>(alreadyShown ? 'HIDDEN' : 'CHECKING');
  const [seconds, setSeconds] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const [comfyReady, setComfyReady] = useState(false);
  const clientId = useWorkflowStore((s) => s.clientId);

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

  // Cleanup polling / countdown timers (keep fadeTimeout separate)
  const cleanupPollTimers = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const cleanupAll = () => {
    cleanupPollTimers();
    if (fadeTimeoutRef.current) {
      clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = null;
    }
  };

  // ComfyUI HTTP status polling — first gate
  useEffect(() => {
    if (alreadyShown) return;
    let mounted = true;

    const init = async () => {
      const running = await checkStatus();
      if (!mounted) return;

      if (running) {
        cleanupPollTimers();
        setComfyReady(true);
        return;
      }

      // Not running, start waiting for ComfyUI
      setState('WAITING');

      // Start countdown timer (1s interval)
      timerIntervalRef.current = window.setInterval(() => {
        if (mounted) setSeconds(s => s + 1);
      }, 1000);

      // Start polling (2s interval)
      pollIntervalRef.current = window.setInterval(async () => {
        const isRunning = await checkStatus();
        if (isRunning && mounted) {
          cleanupPollTimers();
          setComfyReady(true);
        }
      }, 2000);
    };

    init();

    return () => {
      mounted = false;
      cleanupAll();
    };
  }, []);

  // Gate overlay dismissal on BOTH ComfyUI running AND WebSocket clientId ready.
  // This prevents the overlay from disappearing while the Generate button is still
  // disabled (clientId is only set after the WebSocket 'connected' message arrives).
  useEffect(() => {
    if (state === 'READY' || state === 'HIDDEN') return;

    if (comfyReady && clientId) {
      // Both gates passed — show success, then fade out
      setState('READY');
      try { sessionStorage.setItem(READY_FLAG_KEY, '1'); } catch { /* ignore */ }
      fadeTimeoutRef.current = window.setTimeout(() => {
        setFadeOut(true);
        fadeTimeoutRef.current = window.setTimeout(() => {
          setState('HIDDEN');
        }, 500);
      }, 1500);
    } else if (comfyReady && !clientId) {
      // ComfyUI is up but WebSocket handshake not yet complete
      setState('CONNECTING');
    }
  }, [comfyReady, clientId, state]);

  // Don't render if hidden
  if (state === 'HIDDEN') return null;

  const isReady = state === 'READY';
  const isChecking = state === 'CHECKING';
  const isConnecting = state === 'CONNECTING';

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
        {isReady ? null : (
          <div style={spinnerStyle} />
        )}
        
        <p style={titleStyle}>
          {isChecking
            ? '检测 ComfyUI 状态...'
            : isReady
              ? '一切就绪！'
              : isConnecting
                ? '正在建立服务连接...'
                : '正在启动 ComfyUI...'}
        </p>
        
        {!isReady && !isChecking && !isConnecting && (
          <p style={subtitleStyle}>已等待 {seconds} 秒</p>
        )}
      </div>
    </div>
  );
}
