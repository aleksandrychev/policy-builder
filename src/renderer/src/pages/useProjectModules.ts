import { useState } from 'react';

import { blockDescriptorsById } from '../blocks/loadBlocks';
import { modulesToAdd, modulesToRemove } from '../modules/catalog';
import { needsInput } from '../modules/moduleInput';
import { useModuleCatalog } from '../modules/useModuleCatalog';
import { useModuleDetails } from '../modules/useModuleDetails';
import { useAppDispatch, useAppSelector } from '../store';
import { type ModuleInputResponse, moduleInputChanged, modulesAdded, modulesRemoved } from '../store/modulesSlice';

/**
 * The project's CFEngine Build modules, and the one whose page is open over the center area.
 * `backLabel`: what closing the page goes back to (the tab's name).
 */
export function useProjectModules(viewOpen: boolean, backLabel: string) {
  const dispatch = useAppDispatch();
  const projectModules = useAppSelector(state => state.modules);
  const canvas = useAppSelector(state => state.canvas);
  // The blocks whose promise type a module provides, by label.
  const usedBy = (name: string) => canvas.filter(block => blockDescriptorsById.get(block.blockId)?.requires_module === name).map(block => block.label);
  const [openName, setOpenName] = useState<string | null>(null);
  const [openInput, setOpenInput] = useState(false);
  const catalog = useModuleCatalog(viewOpen || openName !== null);
  const open = openName ? catalog.byName.get(openName) : undefined;
  const web = useModuleDetails(open);

  // An added module with a question unanswered.
  const isNeedingInput = (name: string) => {
    const questions = catalog.byName.get(name)?.input ?? [];
    return questions.length > 0 && needsInput(questions, projectModules.find(module => module.name === name)?.input);
  };
  const add = (name: string) => dispatch(modulesAdded(modulesToAdd(catalog.byName, name, projectModules)));
  const remove = (name: string) => dispatch(modulesRemoved(modulesToRemove(catalog.byName, name, projectModules)));
  const close = () => setOpenName(null);
  const openPage = (name: string | null, input = false) => {
    setOpenName(name);
    setOpenInput(input);
  };

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
    usedBy: usedBy(open.name),
    onBack: close,
    onInputChange: (variable: string, response: ModuleInputResponse) => dispatch(moduleInputChanged({ name: open.name, variable, response })),
    onOpenModule: (name: string) => openPage(name),
    openInput
  };

  return {
    add,
    catalog,
    close,
    isNeedingInput,
    needingInput: projectModules.filter(module => isNeedingInput(module.name)).length,
    open: (name: string) => openPage(name),
    openInput: (name: string) => openPage(name, true),
    openName,
    page,
    projectModules,
    remove,
    usedBy
  };
}
