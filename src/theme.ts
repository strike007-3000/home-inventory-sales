// Two-way light/dark theme. index.html sets the initial value before paint.

import { useEffect, useState } from 'preact/hooks';

export type Theme = 'light' | 'dark';

const listeners = new Set<(t: Theme) => void>();
const current = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

export function toggleTheme(): void {
  const next: Theme = current() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', next === 'dark' ? '#101215' : '#ffffff');
  try { localStorage.setItem('theme', next); } catch { /* private mode: choice just won't persist */ }
  listeners.forEach((l) => l(next));
}

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(current);
  useEffect(() => {
    listeners.add(setTheme);
    return () => { listeners.delete(setTheme); };
  }, []);
  return theme;
}
