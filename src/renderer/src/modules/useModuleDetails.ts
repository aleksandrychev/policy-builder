import { useEffect, useState } from 'react';

import { type CatalogModule, sourceUrl } from './catalog';
import { type ModuleWebDetails, parseDetails } from './moduleDetails';

export interface ModuleDetailsState {
  details: ModuleWebDetails | null;
  error?: string;
  loading: boolean;
  offline: boolean;
}

// Where a README's relative links point: the module's folder in its repository, at its commit.
function readmeBase(module: CatalogModule, commit?: string) {
  if (!module.repo?.startsWith('https://')) return undefined;
  if (!commit) return `${sourceUrl(module)}/`;
  return `${module.repo.replace(/\/$/, '')}/blob/${commit}/${module.subdirectory ? `${module.subdirectory}/` : ''}`;
}

/** The website's details of a module (README, author, downloads, versions), loaded when its page opens. */
export function useModuleDetails(module: CatalogModule | undefined): ModuleDetailsState {
  const name = module?.name;
  const [state, setState] = useState<ModuleDetailsState & { name?: string }>({ details: null, loading: false, offline: false });

  useEffect(() => {
    if (!name || !module) return;
    let current = true;
    const api = window.api;
    if (!api) return;
    api
      .getModuleDetails(name)
      .then(result => {
        if (!current) return;
        const commit = typeof result.details?.commit === 'string' ? result.details.commit : undefined;
        setState({
          name,
          details: result.details ? parseDetails(result.details, readmeBase(module, commit)) : null,
          error: result.error,
          loading: false,
          offline: result.offline
        });
      })
      .catch(
        (error: unknown) =>
          current && setState({ name, details: null, error: error instanceof Error ? error.message : String(error), loading: false, offline: true })
      );
    return () => {
      current = false;
    };
  }, [name, module]);

  // Until this module's answer arrives, it's loading (not the previous module's details).
  return state.name === name ? state : { details: null, loading: Boolean(name), offline: false };
}
