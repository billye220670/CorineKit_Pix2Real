import { useState, useEffect, useRef } from 'react';

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function showToast(message: string) {
  listeners.forEach((fn) => fn(message));
}

export function useToastMessage() {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler: Listener = (msg) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      setMessage(msg);
      timerRef.current = setTimeout(() => setMessage(null), 1500);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return message;
}
