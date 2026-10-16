import { undone } from '../store/history';
import { projectCreated, projectTypeChanged } from '../store/projectSlice';
import { type TestStore, addBlock, addFile, makeStore } from '../store/test/storeTestUtils';
import { installApi, uninstallApi } from '../test/render';
import { dependenciesOnSave } from './moduleTools';
import type { SessionTools, ToolEnv } from './shared';
import { answerTool } from './tools';

const INDEX = {
  'delete-files': {
    description: 'Deletes files',
    tags: ['supported', 'management'],
    version: '2.0.0',
    input: [
      {
        type: 'list',
        variable: 'files',
        label: 'Files',
        subtype: [
          { key: 'path', type: 'string' },
          { key: 'why', type: 'string', default: 'Unknown' }
        ]
      }
    ]
  },
  'promise-type-git': { description: 'Manage git repos', tags: ['supported', 'promise-type'], dependencies: ['library-for-promise-types-in-python'] },
  'library-for-promise-types-in-python': { description: 'Library', tags: ['library'] },
  git: { alias: 'promise-type-git' }
};

let store: TestStore;
const envOf = (): ToolEnv => ({ canvas: null, dispatch: store.dispatch, getState: store.getState, session: {} as SessionTools });
async function call(name: string, input: object = {}) {
  const answer = await answerTool(envOf(), name, input);
  if (!answer.ok) throw new Error(answer.content);
  return JSON.parse(answer.content);
}
const refusal = async (name: string, input: object = {}) => (await answerTool(envOf(), name, input)).content;

beforeEach(() => {
  store = makeStore();
  store.dispatch(projectCreated({ name: 'Demo' }));
  installApi({
    getModuleIndex: async () => ({ index: INDEX, fetchedAt: '2026-10-16T00:00:00Z', offline: false }),
    getModuleDetails: async () => ({
      details: {
        readme:
          '<h2>Use</h2><p>Lists <a href="https://x.test/y">files</a>.</p><table><tr><th>Name</th>\n\t<th>Type</th></tr><tr><td>string</td><td>text</td></tr></table>',
        author: { name: 'Nick' }
      },
      offline: false
    })
  });
});
afterEach(() => uninstallApi());

describe('module tools', () => {
  it('search the index, old names included, libraries only when asked', async () => {
    expect((await call('search_modules')).modules.map((m: { name: string }) => m.name)).toEqual([
      'delete-files',
      'library-for-promise-types-in-python',
      'promise-type-git'
    ]);
    expect((await call('search_modules', { query: 'git' })).modules).toMatchObject([{ name: 'promise-type-git', kind: 'promise-type' }]);
    expect((await call('search_modules', { tag: 'management' })).modules).toMatchObject([{ name: 'delete-files', kind: 'configured' }]);
  });

  it('read a module with its questions and README as text', async () => {
    const module = await call('get_module', { name: 'delete-files' });
    expect(module.input).toMatchObject([{ variable: 'files', type: 'list', fields: [{ key: 'path' }, { key: 'why', default: 'Unknown' }] }]);
    expect(module.readme).toContain('Use');
    expect(module.readme).toContain('files (https://x.test/y)');
    expect(module.readme).toContain('Name | Type\n');
    expect(module.readme).toContain('string | text');
    expect(await refusal('get_module', { name: 'nope' })).toMatch(/No module nope/);
  });

  it('add a module with its dependencies, answer its input, and undo', async () => {
    expect(await call('add_module', { name: 'promise-type-git' })).toMatchObject({ added: ['promise-type-git', 'library-for-promise-types-in-python'] });
    expect(await call('add_module', { name: 'delete-files' })).toMatchObject({ input: expect.stringContaining('set_module_input') });
    expect(await refusal('set_module_input', { name: 'delete-files', variable: 'files', response: [{ path: '/a', reason: 'x' }] })).toMatch(/no field reason/);
    expect(await call('set_module_input', { name: 'delete-files', variable: 'files', response: [{ path: '/a' }] })).toEqual({
      name: 'delete-files',
      variable: 'files',
      answer: [{ path: '/a', why: 'Unknown' }],
      complete: true
    });
    expect(store.getState().modules.find(m => m.name === 'delete-files')?.input).toEqual({ files: [{ path: '/a', why: 'Unknown' }] });
    expect((await call('get_module', { name: 'delete-files' })).project).toEqual({ usedBy: [] });
    store.dispatch(undone());
    expect((await call('get_module', { name: 'delete-files' })).project.needsInput).toBe(true);
  });

  it('remove a module unless a block uses it; a dependency goes with it', async () => {
    await call('add_module', { name: 'promise-type-git' });
    const fileId = addFile(store);
    addBlock(store, fileId, { blockId: 'git-checkout', label: 'Clone app' });
    expect(await refusal('remove_module', { name: 'promise-type-git' })).toMatch(/used by Clone app/);
    expect(await refusal('remove_module', { name: 'library-for-promise-types-in-python' })).toMatch(/came with promise-type-git/);
  });

  it('name the dependencies saving will add for a block’s module', async () => {
    addBlock(store, addFile(store), { blockId: 'git-checkout' });
    expect(await dependenciesOnSave(store.getState())).toEqual([{ name: 'library-for-promise-types-in-python', addedFor: 'promise-type-git' }]);
  });

  it('refuse a module project', async () => {
    store.dispatch(projectTypeChanged({ type: 'module' }));
    expect(await refusal('add_module', { name: 'delete-files' })).toMatch(/policy-set projects/);
  });
});
