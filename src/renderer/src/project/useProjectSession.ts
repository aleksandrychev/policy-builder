import { useRef, useState } from 'react';
import { useStore } from 'react-redux';

import type { ProjectFormValues, SubmitResult } from '../components/dialogs/NewProjectDialog';
import { createNginxDemoProject } from '../demo/nginxDemoProject';
import { type RootState, createAppStore, useAppDispatch, useAppSelector } from '../store';
import { projectFilesInitialized } from '../store/filesSlice';
import { UNDOABLE_KEYS, historyCleared } from '../store/history';
import { projectCreated, projectLocated } from '../store/projectSlice';
import { selectCurrentProject } from '../store/projectSlice/selectors';
import { type ProjectData, toCfbsProject } from './cfbsProject';

const snapshotOf = (state: RootState): ProjectData => ({
  canvas: state.canvas,
  derivedNodes: state.derivedNodes,
  edges: state.edges,
  files: state.files,
  groups: state.groups
});

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = useRef(false);
  // Resolves the save a "Save Project As" dialog was opened for.
  const saveAsDone = useRef<((saved: boolean) => void) | null>(null);

  const markSaved = (data = snapshotOf(store.getState())) => setBaseline(data);

  const createProject = async (values: ProjectFormValues): Promise<SubmitResult> => {
    const { name, description } = values;
    const filesInitialized = projectFilesInitialized(name);
    const open = (located: { masterfiles: string | null; path: string | null }) => {
      dispatch(projectCreated({ name, description, ...located }));
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
    const result = await window.api.createProject({ ...values, parent: values.parent, ...toCfbsProject(snapshotOf(scratch.getState())) });
    if (!result.ok) return result;
    open(result);
    return { ok: true };
  };

  const saveProjectAs = async (values: ProjectFormValues): Promise<SubmitResult> => {
    if (!window.api || !values.parent) return { ok: false, message: 'Saving needs the desktop app', details: '' };
    const data = snapshotOf(store.getState());
    const result = await window.api.createProject({ ...values, parent: values.parent, ...toCfbsProject(data) });
    if (!result.ok) return result;
    dispatch(projectLocated({ name: values.name, description: values.description, masterfiles: result.masterfiles, path: result.path }));
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
      const result = await window.api.saveProject(current.path, toCfbsProject(data));
      if (!result.ok) throw new Error(result.message);
      markSaved(data);
      return true;
    } catch (cause) {
      setSaveError(`Couldn’t save the project: ${errorMessage(cause)}`);
      return false;
    } finally {
      saving.current = false;
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
    closeProjectDialog,
    dirty,
    dismissSaveError: () => setSaveError(null),
    newProject: () => guarded(() => setProjectDialog('new')),
    project,
    projectDialog,
    requestClose: () => guarded(() => window.api?.confirmWindowClose()),
    save,
    saveError,
    startDemo: () =>
      guarded(() => {
        createNginxDemoProject(dispatch);
        markSaved();
      }),
    submitProjectDialog,
    unsavedPrompt
  };
}
