import { type ComponentProps, type ReactNode, createElement } from 'react';
import { Provider } from 'react-redux';

import { act, renderHook } from '@testing-library/react';

import { DEMO_ENVIRONMENT_ID } from '../demo/nginxDemoProject';
import { createAppStore } from '../store';
import { blockMoved } from '../store/canvasSlice';
import { fileRenamed, fileSelected } from '../store/filesSlice';
import { projectCreated, projectLocated } from '../store/projectSlice';
import { addBlock, addFile } from '../store/test/storeTestUtils';
import { installApi, uninstallApi } from '../test/render';
import { isEdited, useProjectSession } from './useProjectSession';

describe('useProjectSession', () => {
  afterEach(uninstallApi);

  const render = (store: ReturnType<typeof createAppStore>) =>
    renderHook(() => useProjectSession(), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(Provider, { store } as ComponentProps<typeof Provider>, children)
    }).result;

  it('runs a save asked for while another is running after it, with what changed since', async () => {
    const replies: (() => void)[] = [];
    const saveProject = vi.fn(() => new Promise<{ masterfiles: null; ok: true }>(resolve => replies.push(() => resolve({ ok: true, masterfiles: null }))));
    installApi({ saveProject });
    const store = createAppStore();
    store.dispatch(projectCreated({ name: 'Demo', path: '/p' }));
    const result = render(store);

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.save();
      second = result.current.save();
    });
    await act(async () => {});
    expect(saveProject).toHaveBeenCalledTimes(1);
    await act(async () => replies[0]());
    expect(await first).toBe(true);
    expect(saveProject).toHaveBeenCalledTimes(2);
    await act(async () => replies[1]());
    expect(await second).toBe(true);
  });

  it('names the first file as asked, or after the project', async () => {
    const store = createAppStore();
    const result = render(store);
    const values = { description: '', folderName: 'backup', git: false, masterfiles: 'no', name: 'Backup', parent: null, type: 'module' as const };
    await act(async () => void (await result.current.tools.create({ ...values, firstFile: 'Common' })));
    expect(store.getState().files.files.map(file => [file.name, file.namespace])).toEqual([['Common', 'common']]);
    await act(async () => void (await result.current.tools.create(values)));
    expect(store.getState().files.files.map(file => file.name)).toEqual(['Backup']);
  });

  it('gives a project saved from the demo an environment id of its own', async () => {
    const createProject = vi.fn(async () => ({ ok: true as const, masterfiles: null, path: '/p/copy' }));
    installApi({ createProject });
    const store = createAppStore();
    const result = render(store);
    act(() => result.current.startDemo());
    expect(store.getState().testEnvironments[0].id).toBe(DEMO_ENVIRONMENT_ID);

    act(() => void result.current.save());
    const values = { description: '', folderName: 'copy', git: false, masterfiles: '3.27.0', name: 'Copy', parent: '/p', type: 'policy-set' as const };
    await act(async () => void (await result.current.submitProjectDialog(values)));
    const [id] = store.getState().testEnvironments.map(environment => environment.id);
    expect(id).not.toBe(DEMO_ENVIRONMENT_ID);
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ testEnvironments: [expect.objectContaining({ id })] }));
    expect(result.current.dirty).toBe(false);

    act(() => result.current.startDemo());
    expect(store.getState().testEnvironments[0].id).toBe(DEMO_ENVIRONMENT_ID);
  });

  describe('the unsaved-changes prompt', () => {
    // A project in /p with an edit since it was saved.
    const editedProject = async (api: Parameters<typeof installApi>[0] = {}) => {
      installApi(api);
      const store = createAppStore();
      const result = render(store);
      const values = { description: '', folderName: 'web', git: false, masterfiles: 'no', name: 'Web', parent: null, type: 'module' as const };
      await act(async () => void (await result.current.tools.create(values)));
      act(() => {
        store.dispatch(projectLocated({ description: '', masterfiles: null, moduleName: 'web', name: 'Web', path: '/p', type: 'module' }));
        addFile(store, 'Edited');
      });
      expect(result.current.dirty).toBe(true);
      return { store, result };
    };

    it('closes a clean project without asking, leaving nothing of it', async () => {
      const { store, result } = await editedProject({ saveProject: vi.fn(async () => ({ ok: true as const, masterfiles: null })) });
      await act(async () => void (await result.current.save()));
      expect(result.current.dirty).toBe(false);
      act(() => result.current.closeProject());
      expect(result.current.unsavedPrompt).toBeFalsy();
      // Every slice and the undo history back to a fresh store's: nothing to undo back into view.
      expect(store.getState()).toEqual(createAppStore().getState());
    });

    it('asks before closing an edited project; Cancel keeps it open', async () => {
      const { store, result } = await editedProject();
      act(() => result.current.closeProject());
      expect(result.current.unsavedPrompt).toBeTruthy();
      expect(store.getState().project).not.toBeNull();
      act(() => result.current.unsavedPrompt!.onCancel());
      expect(result.current.unsavedPrompt).toBeFalsy();
      expect(store.getState().project?.name).toBe('Web');
      expect(result.current.dirty).toBe(true);
    });

    it('Don’t Save closes it without saving', async () => {
      const saveProject = vi.fn();
      const { store, result } = await editedProject({ saveProject });
      act(() => result.current.closeProject());
      act(() => result.current.unsavedPrompt!.onDiscard());
      expect(store.getState().project).toBeNull();
      expect(result.current.dirty).toBe(false);
      expect(saveProject).not.toHaveBeenCalled();
    });

    it('Save closes it once saved', async () => {
      const saveProject = vi.fn(async () => ({ ok: true as const, masterfiles: null }));
      const { store, result } = await editedProject({ saveProject });
      act(() => result.current.closeProject());
      await act(async () => void (await result.current.unsavedPrompt!.onSave()));
      expect(saveProject).toHaveBeenCalledWith('/p', expect.anything(), expect.anything());
      expect(store.getState().project).toBeNull();
    });

    it('Save that fails keeps the project open, edited, and says why', async () => {
      const saveProject = vi.fn(async () => ({ ok: false as const, message: 'disk full', details: '' }));
      const { store, result } = await editedProject({ saveProject });
      act(() => result.current.closeProject());
      await act(async () => void (await result.current.unsavedPrompt!.onSave()));
      expect(store.getState().project?.name).toBe('Web');
      expect(result.current.dirty).toBe(true);
      expect(result.current.error).toMatch(/disk full/);
    });

    it('Reload from Disk drops the edits only after asking', async () => {
      const openProject = vi.fn(async () => null);
      const { result } = await editedProject({ openProject });
      act(() => result.current.revertProject());
      expect(openProject).not.toHaveBeenCalled();
      await act(async () => result.current.unsavedPrompt!.onDiscard());
      expect(openProject).toHaveBeenCalledWith({ path: '/p' });
    });

    it('closing the window asks too, and confirms only after the choice', async () => {
      const confirmWindowClose = vi.fn(async () => undefined);
      const { result } = await editedProject({ confirmWindowClose });
      act(() => result.current.requestClose());
      expect(confirmWindowClose).not.toHaveBeenCalled();
      act(() => result.current.unsavedPrompt!.onDiscard());
      expect(confirmWindowClose).toHaveBeenCalled();
    });
  });
});

describe('isEdited', () => {
  const setup = () => {
    const store = createAppStore();
    store.dispatch(projectCreated({ name: 'Demo' }));
    const first = addFile(store);
    const second = addFile(store, 'Other');
    const block = addBlock(store, first);
    return { store, first, second, block, saved: store.getState() };
  };

  it('ignores which file is open', () => {
    const { store, first, saved } = setup();
    expect(saved.files.currentFileId).not.toBe(first);
    store.dispatch(fileSelected({ fileId: first }));
    expect(isEdited(store.getState(), saved)).toBe(false);
  });

  it('counts edits to the files and the canvas', () => {
    const { store, second, block, saved } = setup();
    store.dispatch(fileRenamed({ fileId: second, name: 'Renamed' }));
    expect(isEdited(store.getState(), saved)).toBe(true);
    const renamed = store.getState();
    store.dispatch(blockMoved({ instanceId: block, position: { x: 1, y: 2 } }));
    expect(isEdited(store.getState(), renamed)).toBe(true);
  });
});
