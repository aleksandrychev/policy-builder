import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type CatalogModule, parseIndex } from './catalog';

export interface ModuleCatalog {
  byName: Map<string, CatalogModule>;
  error?: string;
  // When the list was downloaded; offline, the cached copy's date.
  fetchedAt: string | null;
  loading: boolean;
  modules: CatalogModule[];
  offline: boolean;
  refresh: () => void;
}

/** The module index, loaded once `enabled` (the Modules view first opens), kept for the session. */
export function useModuleCatalog(enabled: boolean): ModuleCatalog {
  const [state, setState] = useState<Omit<ModuleCatalog, 'byName' | 'refresh'>>({ fetchedAt: null, loading: false, modules: [], offline: false });
  const requested = useRef(false);

  const load = useCallback((refresh: boolean) => {
    setState(current => ({ ...current, loading: true }));
    const api = window.api;
    if (!api) {
      setState(current => ({ ...current, loading: false, offline: true, error: 'No connection to the app' }));
      return;
    }
    api
      .getModuleIndex(refresh)
      .then(result =>
        setState({
          error: result.error,
          fetchedAt: result.fetchedAt,
          loading: false,
          modules: result.index ? parseIndex(result.index) : [],
          offline: result.offline
        })
      )
      .catch((error: unknown) =>
        setState(current => ({ ...current, loading: false, offline: true, error: error instanceof Error ? error.message : String(error) }))
      );
  }, []);

  useEffect(() => {
    if (!enabled || requested.current) return;
    requested.current = true;
    load(false);
  }, [enabled, load]);

  const byName = useMemo(() => new Map(state.modules.map(module => [module.name, module])), [state.modules]);
  const refresh = useCallback(() => load(true), [load]);
  return { ...state, byName, refresh };
}
