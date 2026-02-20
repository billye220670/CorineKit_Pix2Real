import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  useEffect(() => {
    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
  }, [dark]);

  return (
    <button
      onClick={() => setDark(!dark)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--spacing-sm)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border)',
        borderRadius: 0,
        backgroundColor: 'transparent',
      }}
      title={dark ? '切换到亮色主题' : '切换到暗色主题'}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
