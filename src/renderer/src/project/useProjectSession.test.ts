import { type ComponentProps, type ReactNode, createElement } from 'react';
import { Provider } from 'react-redux';

import { act, renderHook } from '@testing-library/react';

import { DEMO_ENVIRONMENT_ID } from '../demo/nginxDemoProject';
import { createAppStore } from '../store';
import { blockMoved } from '../store/canvasSlice';
import { fileRenamed, fileSelected } from '../store/filesSlice';
import { projectCreated } from '../store/projectSlice';
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
