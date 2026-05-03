import { useState, useEffect, useRef } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastData {
  message: string;
  action?: ToastAction;
  duration?: number;
}

type ToastInput = string | ToastData;
type Listener = (data: ToastData) => void;
const listeners = new Set<Listener>();

export function showToast(config: ToastInput) {
  const data: ToastData = typeof config === 'string' ? { message: config } : config;
  listeners.forEach((fn) => fn(data));
}

export function useToastMessage() {
  const [state, setState] = useState<{
    message: string | null;
    key: number;
    isExiting: boolean;
    action?: ToastAction;
  }>({ message: null, key: 0, isExiting: false });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
    setState((prev) => ({ ...prev, message: null, isExiting: false, action: undefined }));
  };

  useEffect(() => {
    const handler: Listener = (data) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);

      setState((prev) => ({
        message: data.message,
        key: prev.key + 1,
        isExiting: false,
        action: data.action,
      }));

      // 有 action 时默认 8 秒，否则默认 2 秒
      const duration = data.duration ?? (data.action ? 8000 : 2000);
      const exitStart = duration - 300; // 退出动画提前 300ms 开始

      if (duration > 0) {
        exitTimerRef.current = setTimeout(() => setState((prev) => ({ ...prev, isExiting: true })), exitStart);
        timerRef.current = setTimeout(() => setState((prev) => ({ ...prev, message: null, isExiting: false, action: undefined })), duration);
      }
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
    };
  }, []);

  return { ...state, dismiss };
}
