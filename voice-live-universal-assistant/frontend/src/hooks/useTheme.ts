import { useState, useEffect, useCallback } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'voice-live-theme';

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? getSystemTheme() : pref;
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored as ThemePreference) || 'light';
  });

  // Track system theme changes for FluentProvider re-render
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme());

  const resolved: ResolvedTheme = preference === 'system' ? systemTheme : preference;

  // Apply theme to <html> element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemTheme(getSystemTheme());
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setTheme = useCallback((pref: ThemePreference) => {
    setPreference(pref);
    localStorage.setItem(STORAGE_KEY, pref);
  }, []);

  return { theme: preference, resolvedTheme: resolved, setTheme };
}
