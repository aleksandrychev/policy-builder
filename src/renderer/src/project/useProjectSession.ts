import { useRef, useState } from 'react';
import { useStore } from 'react-redux';

import type { ProjectFormValues, SubmitResult } from '../components/dialogs/NewProjectDialog';
import { createNginxDemoProject } from '../demo/nginxDemoProject';
import { type RootState, createAppStore, useAppDispatch, useAppSelector } from '../store';
import { projectFilesInitialized } from '../store/filesSlice';
import { UNDOABLE_KEYS, historyCleared } from '../store/history';
import { projectCreated, projectLoaded, projectLocated, projectTypeChanged } from '../store/projectSlice';
import { selectCurrentProject } from '../store/projectSlice/selectors';
import type { ProjectType } from '../store/projectSlice/types';
import { type ProjectData, loadCfbsProject, toCfbsProject } from './cfbsProject';
import { moduleNameFor } from './moduleName';

const snapshotOf = (state: RootState): ProjectData => ({
  canvas: state.canvas,
  derivedNodes: state.derivedNodes,
  edges: state.edges,
  files: state.files,
  groups: state.groups
});

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const folderNameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * The open project's life cycle: creating it (on disk via cfbs, or in memory),
 * saving, and dirty tracking. Dirty = an undoable slice's reference differs
 * from the last save, so undoing back to it is clean again.
 */
export function useProjectSession() {
  const store = useStore<RootState>();
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const [baseline, setBaseline] = useState<ProjectData | null>(null);
  const dirty = useAppSelector(state => baseline !== null && UNDOABLE_KEYS.some(key => state[key] !== baseline[key]));
  const [projectDialog, setProjectDialog] = useState<'new' | 'saveAs' | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  // Resolves the save a "Save Project As" dialog was opened for.
  const saveAsDone = useRef<((saved: boolean) => void) | null>(null);

  const markSaved = (data = snapshotOf(store.getState())) => setBaseline(data);

  const createProject = async (values: ProjectFormValues): Promise<SubmitResult> => {
    const { name, description, type } = values;
    const moduleName = moduleNameFor(name);
    const filesInitialized = projectFilesInitialized(name);
    const open = (located: { masterfiles: string | null; path: string | null }) => {
      dispatch(projectCreated({ name, description, moduleName, type, ...located }));
      // Every project starts with one policy file, named after the project (its namespace derives from it).
      dispatch(filesInitialized);
      dispatch(historyCleared());
      markSaved();
    };
    if (!window.api || !values.parent) {
      open({ masterfiles: null, path: null });
      return { ok: true };
    }
    // Build the initial content in a scratch store, so disk matches what `open` then dispatches.
    const scratch = createAppStore();
    scratch.dispatch(projectCreated({ name }));
    scratch.dispatch(filesInitialized);
    const content = toCfbsProject(snapshotOf(scratch.getState()), { description, moduleName, name });
    const result = await window.api.createProject({ ...values, parent: values.parent, ...content });
    if (!result.ok) return result;
    open(result);
    return { ok: true };
  };

  const saveProjectAs = async (values: ProjectFormValues): Promise<SubmitResult> => {
    if (!window.api || !values.parent) return { ok: false, message: 'Saving needs the desktop app', details: '' };
    const data = snapshotOf(store.getState());
    const moduleName = moduleNameFor(values.name);
    const content = toCfbsProject(data, { description: values.description, moduleName, name: values.name });
    const result = await window.api.createProject({ ...values, parent: values.parent, ...content });
    if (!result.ok) return result;
    const { description, name, type } = values;
    dispatch(projectLocated({ description, masterfiles: result.masterfiles, moduleName, name, path: result.path, type }));
    markSaved(data);
    return { ok: true };
  };

  const closeProjectDialog = () => {
    setProjectDialog(null);
    saveAsDone.current?.(false);
    saveAsDone.current = null;
  };

  const submitProjectDialog = async (values: ProjectFormValues) => {
    const result = await (projectDialog === 'saveAs' ? saveProjectAs(values) : createProject(values));
    if (result.ok) {
      setProjectDialog(null);
      saveAsDone.current?.(true);
      saveAsDone.current = null;
    }
    return result;
  };

  // Resolves with whether the project ended up saved.
  const save = async (): Promise<boolean> => {
    const current = store.getState().project;
    if (!current || !window.api || saving.current) return false;
    if (!current.path) {
      saveAsDone.current?.(false);
      setProjectDialog('saveAs');
      return new Promise(resolve => (saveAsDone.current = resolve));
    }
    saving.current = true;
    const data = snapshotOf(store.getState());
    try {
      const content = toCfbsProject(data, current);
      // The stored type is what cfbs.json becomes: a type change in Project Settings converts it here.
      const result = await window.api.saveProject(current.path, content, { masterfiles: current.masterfiles, type: current.type });
      if (!result.ok) throw new Error(result.message);
      // A conversion to a policy set brings masterfiles: show the version it got.
      if (result.masterfiles !== current.masterfiles) dispatch(projectTypeChanged({ masterfiles: result.masterfiles, type: current.type }));
      markSaved(data);
      return true;
    } catch (cause) {
      setError(`Couldn’t save the project: ${errorMessage(cause)}`);
      return false;
    } finally {
      saving.current = false;
    }
  };

  // Project Settings: store the project as a policy set or a module. On disk, that's saved (and
  // cfbs.json converted) at once; if the save fails, the type goes back.
  const changeProjectType = async (type: ProjectType, masterfiles: string | null): Promise<boolean> => {
    const current = store.getState().project;
    if (!current) return false;
    const previous = { masterfiles: current.masterfiles, type: current.type };
    dispatch(projectTypeChanged({ type, ...(masterfiles ? { masterfiles } : {}) }));
    if (!current.path) return true;
    const saved = await save();
    if (!saved) dispatch(projectTypeChanged(previous));
    return saved;
  };

  // No path: the native picker asks. The current project stays as is unless the new one loads.
  const openProject = async (path?: string) => {
    if (!window.api) return;
    try {
      const result = await window.api.openProject(path ? { path } : {});
      if (!result) return;
      if (!result.ok) throw new Error(result.message);
      const { data, ...project } = loadCfbsProject(result.cfbs, result.builder, folderNameOf(result.path));
      dispatch(projectLoaded({ ...project, path: result.path }, data));
      dispatch(historyCleared());
      markSaved();
    } catch (cause) {
      setError(`Couldn’t open the project: ${errorMessage(cause)}`);
    }
  };

  // Runs `action` now, or after Save / Don't Save when there are unsaved changes.
  const guarded = (action: () => void) => {
    if (dirty) setPendingAction(() => action);
    else action();
  };

  const unsavedPrompt = pendingAction && {
    onCancel: () => setPendingAction(null),
    onDiscard: () => {
      setPendingAction(null);
      pendingAction();
    },
    onSave: async () => {
      setPendingAction(null);
      if (await save()) pendingAction();
    }
  };

  return {
    changeProjectType,
    closeProjectDialog,
    dirty,
    dismissError: () => setError(null),
    error,
    newProject: () => guarded(() => setProjectDialog('new')),
    openProject: (path?: string) => guarded(() => void openProject(path)),
    project,
    projectDialog,
    requestClose: () => guarded(() => window.api?.confirmWindowClose()),
    save,
    startDemo: () =>
      guarded(() => {
        createNginxDemoProject(dispatch);
        markSaved();
      }),
    submitProjectDialog,
    unsavedPrompt
  };
}
