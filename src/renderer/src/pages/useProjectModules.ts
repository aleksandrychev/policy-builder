import { useState } from 'react';

import { modulesToAdd, modulesToRemove } from '../modules/catalog';
import { useModuleCatalog } from '../modules/useModuleCatalog';
import { useModuleDetails } from '../modules/useModuleDetails';
import { useAppDispatch, useAppSelector } from '../store';
import { modulesAdded, modulesRemoved } from '../store/modulesSlice';

/**
 * The project's CFEngine Build modules, and the one whose page is open over the center area.
 * `backLabel`: what closing the page goes back to (the tab's name).
 */
export function useProjectModules(viewOpen: boolean, backLabel: string) {
  const dispatch = useAppDispatch();
  const projectModules = useAppSelector(state => state.modules);
  const [openName, setOpenName] = useState<string | null>(null);
  const catalog = useModuleCatalog(viewOpen || openName !== null);
  const open = openName ? catalog.byName.get(openName) : undefined;
  const web = useModuleDetails(open);

  // Input isn't stored yet: a module that asks for some needs it.
  const isNeedingInput = (name: string) => (catalog.byName.get(name)?.input.length ?? 0) > 0;
  const add = (name: string) => dispatch(modulesAdded(modulesToAdd(catalog.byName, name, projectModules)));
  const remove = (name: string) => dispatch(modulesRemoved(modulesToRemove(catalog.byName, name, projectModules)));
  const close = () => setOpenName(null);

  const index = openName ? projectModules.findIndex(module => module.name === openName) : -1;
  const page = open && {
    module: open,
    web,
    backLabel,
    added: index >= 0 ? { index, module: projectModules[index], total: projectModules.length } : undefined,
    needsInput: isNeedingInput(open.name),
    wouldAdd:
      index >= 0
        ? []
        : modulesToAdd(catalog.byName, open.name, projectModules)
            .slice(1)
            .map(module => module.name),
    onAdd: () => add(open.name),
    onRemove: () => remove(open.name),
    onBack: close,
    onOpenModule: setOpenName
  };

  return {
    add,
    catalog,
    close,
    isNeedingInput,
    needingInput: projectModules.filter(module => isNeedingInput(module.name)).length,
    open: setOpenName,
    openName,
    page,
    projectModules,
    remove
  };
}
