import { useState, useEffect, useRef } from 'react';

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function showToast(message: string) {
  listeners.forEach((fn) => fn(message));
}

export function useToastMessage() {
  const [state, setState] = useState<{ message: string | null; key: number }>({ message: null, key: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler: Listener = (msg) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      setState((prev) => ({ message: msg, key: prev.key + 1 }));
      timerRef.current = setTimeout(() => setState((prev) => ({ ...prev, message: null })), 2000);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return state;
}
