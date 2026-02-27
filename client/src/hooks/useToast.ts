import { useState, useEffect, useRef } from 'react';

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function showToast(message: string) {
  listeners.forEach((fn) => fn(message));
}

export function useToastMessage() {
  const [state, setState] = useState<{ message: string | null; key: number; isExiting: boolean }>({ message: null, key: 0, isExiting: false });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler: Listener = (msg) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
      setState((prev) => ({ message: msg, key: prev.key + 1, isExiting: false }));
      exitTimerRef.current = setTimeout(() => setState((prev) => ({ ...prev, isExiting: true })), 1700);
      timerRef.current = setTimeout(() => setState((prev) => ({ ...prev, message: null, isExiting: false })), 2000);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
    };
  }, []);

  return state;
}
