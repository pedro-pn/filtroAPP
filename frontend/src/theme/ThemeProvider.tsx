import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react';

import { ThemeContext } from './ThemeContext';
import {
  applyTheme,
  getStoredThemePreference,
  persistThemePreference,
  SYSTEM_THEME_QUERY,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference
} from './theme';

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setThemeState] = useState<ThemePreference>(
    getStoredThemePreference
  );
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    applyTheme(theme)
  );

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    persistThemePreference(nextTheme);
    setThemeState(nextTheme);
  }, []);

  useEffect(() => {
    setResolvedTheme(applyTheme(theme));

    if (theme !== 'system' || typeof window.matchMedia !== 'function')
      return undefined;

    const systemTheme = window.matchMedia(SYSTEM_THEME_QUERY);
    const handleSystemThemeChange = () =>
      setResolvedTheme(applyTheme('system'));
    systemTheme.addEventListener('change', handleSystemThemeChange);
    return () =>
      systemTheme.removeEventListener('change', handleSystemThemeChange);
  }, [theme]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY)
        setThemeState(getStoredThemePreference());
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [resolvedTheme, setTheme, theme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
