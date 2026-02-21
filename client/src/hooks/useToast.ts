import { useState, useEffect } from 'react';

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function showToast(message: string) {
  listeners.forEach((fn) => fn(message));
}

export function useToastMessage() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handler: Listener = (msg) => {
      setMessage(msg);
      setTimeout(() => setMessage(null), 1500);
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  return message;
}
