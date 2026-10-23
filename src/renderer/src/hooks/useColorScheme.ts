import { useEffect, useState } from 'react';

type ColorScheme = 'light' | 'dark';

const getInitialScheme = (): ColorScheme =>
  typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

/**
 * Tracks the OS color-scheme preference so the app can pick the matching
 * Mission Portal light/dark palette. It seeds from `prefers-color-scheme`,
 * refines with the main-process value (exposed via the preload bridge), and
 * keeps updating when the OS theme or View → Appearance changes.
 */
export function useColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(getInitialScheme);

  useEffect(() => {
    let active = true;

    // Authoritative value from the main process (nativeTheme). Guarded because
    // `window.api` is absent outside Electron (e.g. in the Vitest jsdom env).
    window.api?.shouldUseDarkColors().then(isDark => {
      if (active) setScheme(isDark ? 'dark' : 'light');
    });

    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setScheme(e.matches ? 'dark' : 'light');
    mql?.addEventListener('change', onChange);
    // View → Appearance (and the OS under System), told by the main process.
    const stopFollowing = window.api?.onThemeUpdated?.(isDark => setScheme(isDark ? 'dark' : 'light'));

    return () => {
      active = false;
      mql?.removeEventListener('change', onChange);
      stopFollowing?.();
    };
  }, []);

  return scheme;
}
