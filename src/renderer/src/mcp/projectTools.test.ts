import { edgeAdded } from '../store/edgesSlice';
import { historyCleared } from '../store/history';
import { projectCreated, projectLocated } from '../store/projectSlice';
import { addBlock, addFile, blockOf, fileOf, makeStore, undoAll } from '../store/test/storeTestUtils';
import { PROJECT_TOOLS } from './projectTools';
import type { SessionTools, ToolEnv } from './shared';
import { type ToolAnswer, answerTool } from './tools';

type Api = NonNullable<Window['api']>;

function setup(session: Partial<SessionTools> = {}) {
  const store = makeStore();
  store.dispatch(projectCreated({ name: 'Web' }));
  const fileId = addFile(store, 'Main');
  store.dispatch(historyCleared());
  const opened: string[] = [];
  const env: ToolEnv = {
    canvas: {
      openFile: fileId => opened.push(fileId),
      selectedInstanceId: null,
      fitView: () => undefined,
      nodeHeight: () => undefined,
      showTests: () => undefined,
      sizeOf: () => ({ width: 200, height: 80 })
    },
    dispatch: store.dispatch,
    getState: store.getState,
    session: { create: vi.fn(), dirty: false, open: vi.fn(), save: vi.fn(), saveAs: vi.fn(), ...session }
  };
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const answer: ToolAnswer = await answerTool(env, name, input);
    return { ...answer, result: answer.ok ? JSON.parse(answer.content) : undefined };
  };
  return { call, env, fileId, opened, store };
}

function installApi(api: Partial<Api>) {
  window.api = {
    checkProjectTarget: vi.fn(async () => ({ parentWritable: true, targetState: 'new' as const })),
    getMasterfilesVersions: vi.fn(async () => ({ latest: '3.27.9' })),
    ...api
  } as unknown as Api;
}

afterEach(() => {
  delete (window as { api?: Api }).api;
});

describe('MCP project tools', () => {
  it('declares every tool', () => {
    expect(Object.keys(PROJECT_TOOLS).sort()).toEqual(
      [
        'add_file',
        'add_folder',
        'create_project',
        'get_project_status',
        'group_blocks',
        'open_project',
        'remove_file',
        'rename_file',
        'save_project',
        'set_file_condition',
        'set_file_description',
        'set_group_condition',
        'ungroup'
      ].sort()
    );
  });

  it('reports the project status', async () => {
    const { call, store } = setup({ dirty: true });
    store.dispatch(projectCreated({ name: 'Web', type: 'module' }));
    expect((await call('get_project_status')).result).toEqual({
      open: true,
      name: 'Web',
      path: null,
      type: 'module',
      masterfiles: null,
      unsavedChanges: true,
      files: 1,
      folders: 0
    });
  });

  it('reports no project', async () => {
    const { call, env } = setup();
    const store = makeStore();
    env.getState = store.getState;
    expect((await call('get_project_status')).result).toEqual({ open: false });
  });

  describe('create_project', () => {
    it('creates the project the dialog would, at parent/<folder>', async () => {
      const create = vi.fn();
      const { call, store } = setup({ create });
      installApi({});
      create.mockImplementation(async () => {
        store.dispatch(projectCreated({ name: 'My Web', path: '/tmp/x/my-web', masterfiles: '3.27.9' }));
        return { ok: true };
      });
      const answer = await call('create_project', { name: ' My Web ', parent: '/tmp/x' });
      expect(answer.ok).toBe(true);
      expect(create).toHaveBeenCalledWith({
        name: 'My Web',
        description: 'Policy built with CFEngine Policy Builder',
        parent: '/tmp/x',
        folderName: 'my-web',
        masterfiles: '3.27.9',
        git: true,
        type: 'policy-set'
      });
      expect(answer.result).toMatchObject({ path: '/tmp/x/my-web', masterfiles: '3.27.9' });
      expect(window.api?.checkProjectTarget).toHaveBeenCalledWith('/tmp/x', 'my-web');
    });

    it('creates a module without masterfiles or git', async () => {
      const create = vi.fn(async () => ({ ok: true }));
      const { call } = setup({ create });
      installApi({});
      await call('create_project', { name: 'Mod', parent: '/p', type: 'module', git: false, masterfiles: 'master' });
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ masterfiles: 'no', git: false, type: 'module' }));
    });

    it('refuses with unsaved changes unless told to discard them', async () => {
      const create = vi.fn(async () => ({ ok: true }));
      const { call } = setup({ create, dirty: true });
      installApi({});
      const refused = await call('create_project', { name: 'X', parent: '/p' });
      expect(refused.ok).toBe(false);
      expect(refused.content).toMatch(/unsaved changes.*discardChanges/);
      expect(create).not.toHaveBeenCalled();
      expect((await call('create_project', { name: 'X', parent: '/p', discardChanges: true })).ok).toBe(true);
    });

    it('refuses targets the dialog refuses', async () => {
      const { call } = setup();
      installApi({ checkProjectTarget: vi.fn(async () => ({ parentWritable: true, targetState: 'nonEmpty' as const })) });
      expect((await call('create_project', { name: 'X', parent: '/p' })).content).toMatch(/isn’t empty/);
      expect((await call('create_project', { name: 'X', parent: 'relative' })).content).toMatch(/absolute/);
      expect((await call('create_project', { name: '!!!', parent: '/p' })).content).toMatch(/letter or digit/);
      installApi({ checkProjectTarget: vi.fn(async () => ({ parentWritable: false, targetState: 'new' as const })) });
      expect((await call('create_project', { name: 'X', parent: '/p' })).content).toMatch(/Can’t create a folder/);
    });

    it('passes cfbs’s failure on', async () => {
      const { call } = setup({ create: vi.fn(async () => ({ ok: false, message: 'cfbs init failed', details: 'no network' })) });
      installApi({});
      const answer = await call('create_project', { name: 'X', parent: '/p' });
      expect(answer).toMatchObject({ ok: false, content: 'cfbs init failed\nno network' });
    });
  });

  describe('open_project', () => {
    it('opens a project', async () => {
      const open = vi.fn();
      const { call, store } = setup({ open });
      installApi({});
      open.mockImplementation(async (path: string) => {
        store.dispatch(projectCreated({ name: 'Other', path }));
        return null;
      });
      expect((await call('open_project', { path: '/p/other' })).result).toMatchObject({ path: '/p/other', name: 'Other' });
      expect(open).toHaveBeenCalledWith('/p/other');
    });

    it('reports why a project didn’t open', async () => {
      const open = vi.fn(async () => 'Couldn’t open the project: no cfbs.json in /p/nothing');
      const { call } = setup({ open });
      installApi({});
      expect((await call('open_project', { path: '/p/nothing' })).content).toBe('Couldn’t open the project: no cfbs.json in /p/nothing');
    });

    it('refuses with unsaved changes', async () => {
      const open = vi.fn(async () => null);
      const { call } = setup({ open, dirty: true });
      installApi({});
      expect((await call('open_project', { path: '/p' })).ok).toBe(false);
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe('save_project', () => {
    it('saves a project that has a folder', async () => {
      const save = vi.fn(async (): Promise<string | null> => null);
      const { call, store } = setup({ save });
      store.dispatch(projectLocated({ description: '', masterfiles: null, moduleName: 'web', name: 'Web', path: '/p/web', type: 'policy-set' }));
      expect((await call('save_project')).result).toEqual({ path: '/p/web', saved: true });
      save.mockResolvedValue('Couldn’t save the project: disk full');
      expect((await call('save_project')).content).toBe('Couldn’t save the project: disk full');
    });

    it('needs a parent for a project never saved, then saves it there', async () => {
      const saveAs = vi.fn();
      const { call, store } = setup({ saveAs });
      installApi({});
      expect((await call('save_project')).content).toMatch(/give parent/);
      saveAs.mockImplementation(async () => {
        store.dispatch(projectLocated({ description: '', masterfiles: '3.27.9', moduleName: 'web', name: 'Web', path: '/p/web', type: 'policy-set' }));
        return { ok: true };
      });
      expect((await call('save_project', { parent: '/p', git: false })).result).toEqual({ path: '/p/web', saved: true });
      expect(saveAs).toHaveBeenCalledWith(expect.objectContaining({ name: 'Web', folderName: 'web', parent: '/p', git: false, masterfiles: '3.27.9' }));
    });
  });

  describe('files and folders', () => {
    it('adds, renames, describes and gates a file, one undo step each', async () => {
      const { call, opened, store } = setup();
      const { id: folderId } = (await call('add_folder', { name: 'Services' })).result;
      const added = (await call('add_file', { name: 'Web Server', folderId })).result;
      expect(added).toMatchObject({ name: 'Web Server', namespace: 'web_server' });
      expect(fileOf(store, added.id)?.parentId).toBe(folderId);
      expect((await call('rename_file', { fileId: added.id, name: 'Nginx' })).result).toMatchObject({ name: 'Nginx', namespace: 'web_server' });
      await call('set_file_description', { fileId: added.id, description: 'The web tier' });
      await call('set_file_condition', { fileId: added.id, condition: { className: 'debian', mode: 'unless' } });
      expect(fileOf(store, added.id)).toMatchObject({ description: 'The web tier', condition: { className: 'debian', mode: 'unless' } });
      await call('set_file_condition', { fileId: added.id, condition: null });
      expect(fileOf(store, added.id)?.condition).toBeUndefined();
      expect(opened).toContain(added.id);
      expect(undoAll(store)).toBe(6);
    });

    it('refuses bad input', async () => {
      const { call, fileId } = setup();
      expect((await call('add_file', { name: 'x', folderId: 'nope' })).content).toMatch(/No folder nope/);
      expect((await call('add_file', { name: '///' })).content).toMatch(/no usable characters/);
      expect((await call('rename_file', { fileId: 'nope', name: 'x' })).content).toMatch(/No file nope/);
      expect((await call('set_file_condition', { fileId, condition: { className: '', mode: 'if' } })).ok).toBe(false);
      expect((await call('remove_file', { fileId })).content).toMatch(/at least one policy file/);
    });

    it('removes a file with its blocks, arrows and groups in one step', async () => {
      const { call, fileId, store } = setup();
      const other = addFile(store, 'Other');
      const [a, b] = [addBlock(store, fileId), addBlock(store, fileId)];
      store.dispatch(edgeAdded({ fileId, source: a, target: b, outcomes: ['kept'] }));
      await call('group_blocks', { blockIds: [a] });
      const before = store.getState();
      expect((await call('remove_file', { fileId })).result).toMatchObject({ removed: fileId, blocksRemoved: 2 });
      const state = store.getState();
      expect(state.files.files.map(file => file.id)).toEqual([other]);
      expect([state.canvas, state.edges, state.groups]).toEqual([[], [], []]);
      store.dispatch({ type: 'history/undone' });
      expect(store.getState().canvas).toBe(before.canvas);
    });
  });

  describe('groups', () => {
    it('groups blocks, gates the group and ungroups it', async () => {
      const { call, fileId, opened, store } = setup();
      const [a, b] = [addBlock(store, fileId), addBlock(store, fileId)];
      const group = (await call('group_blocks', { blockIds: [a, b] })).result;
      expect(group).toMatchObject({ name: 'Group 1', fileId, blocks: 2 });
      expect(blockOf(store, a)?.groupId).toBe(group.id);
      expect(opened).toContain(fileId);
      expect((await call('group_blocks', { blockIds: [addBlock(store, fileId)], name: 'Web' })).result.name).toBe('Web');

      await call('set_group_condition', { groupId: group.id, condition: { className: 'linux', mode: 'if' } });
      expect(store.getState().groups.find(item => item.id === group.id)?.condition).toEqual({ kind: 'class', className: 'linux', mode: 'if' });
      await call('ungroup', { groupId: group.id });
      expect(blockOf(store, a)?.groupId).toBeUndefined();
      expect(store.getState().groups.some(item => item.id === group.id)).toBe(false);
    });

    it('refuses blocks of different files, unknown ids and loops', async () => {
      const { call, fileId, store } = setup();
      const other = addFile(store, 'Other');
      const [a, b, c] = [addBlock(store, fileId), addBlock(store, fileId), addBlock(store, fileId)];
      expect((await call('group_blocks', { blockIds: [a, addBlock(store, other)] })).content).toMatch(/one file/);
      expect((await call('group_blocks', { blockIds: ['nope'] })).content).toMatch(/No block nope/);
      expect((await call('group_blocks', { blockIds: [] })).ok).toBe(false);
      expect((await call('ungroup', { groupId: 'nope' })).content).toMatch(/No group nope/);
      // a → b → c: grouping a and c would route a → group → b → group.
      store.dispatch(edgeAdded({ fileId, source: a, target: b, outcomes: ['kept'] }));
      store.dispatch(edgeAdded({ fileId, source: b, target: c, outcomes: ['kept'] }));
      expect((await call('group_blocks', { blockIds: [a, c] })).content).toMatch(/loop/);
      expect(store.getState().groups).toEqual([]);
    });
  });

  it('refuses file edits without an open project', async () => {
    const { call, env } = setup();
    env.canvas = null;
    expect((await call('add_file', { name: 'x' })).content).toMatch(/No project is open/);
  });
});
