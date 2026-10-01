import { describe, expect, it } from 'vitest';

import { createNginxDemoProject } from '../demo/nginxDemoProject';
import { derivedNodeMoved } from '../store/derivedNodesSlice';
import { fileAdded, fileConditionClassNameChanged, fileConditionEnabled, folderAdded } from '../store/filesSlice';
import { groupCreated } from '../store/groupsSlice';
import { addBlock, makeStore } from '../store/test/storeTestUtils';
import { META_KEY, SCHEMA_VERSION, fromCfbsProject, loadCfbsProject, toCfbsProject } from './cfbsProject';

function buildProject() {
  const store = makeStore();
  createNginxDemoProject(store.dispatch);
  const folderId = store.dispatch(folderAdded('Services')).payload.id;
  const fileId = store.dispatch(fileAdded('Cron jobs', folderId)).payload.id;
  store.dispatch(fileConditionEnabled({ fileId }));
  store.dispatch(fileConditionClassNameChanged({ fileId, className: 'linux' }));
  const blockId = addBlock(store, fileId);
  store.dispatch(groupCreated({ color: 'info', fileId, instanceIds: [blockId], name: 'Reports' }));
  store.dispatch(derivedNodeMoved({ key: `${fileId}|data|${blockId}|x`, position: { x: 10, y: 20 } }));
  return { fileId, folderId, state: store.getState() };
}

const masterfiles = { name: 'masterfiles', version: '3.27.1', added_by: 'cfbs init' };
const asCfbsJson = ({ meta, modules }: ReturnType<typeof toCfbsProject>, extra: object = {}) =>
  JSON.parse(JSON.stringify({ name: 'x', meta, build: [masterfiles, ...modules], ...extra }));

describe('cfbsProject', () => {
  it('round-trips the project through cfbs.json', () => {
    const { state } = buildProject();

    const restored = fromCfbsProject(asCfbsJson(toCfbsProject(state)));

    expect(restored.files).toEqual(state.files);
    expect(restored.canvas).toEqual(expect.arrayContaining(state.canvas));
    expect(restored.canvas).toHaveLength(state.canvas.length);
    expect(restored.edges).toEqual(state.edges);
    expect(restored.groups).toEqual(state.groups);
    expect(restored.derivedNodes).toEqual(state.derivedNodes);
  });

  it('mirrors the file tree: a top-level file is a file module, a top-level folder a directory module', () => {
    const { fileId, folderId, state } = buildProject();
    const { meta, modules } = toCfbsProject(state);
    const file = state.files.files.find(item => item.id === fileId)!;

    // Exactly what `cfbs add` writes, but for the bundles step; no builder data on modules.
    expect(modules.map(module => module.name)).toEqual(['./common.cf', './webserver.cf', './services/']);
    expect(modules[1]).toEqual({
      name: './webserver.cf',
      description: 'Local policy file added using cfbs command line',
      tags: ['local'],
      added_by: 'cfbs add',
      steps: ['copy ./webserver.cf services/cfbs/webserver.cf', 'policy_files services/cfbs/webserver.cf', 'bundles webserver']
    });
    expect(modules[2]).toEqual({
      name: './services/',
      description: 'Local subdirectory added using cfbs command line',
      tags: ['local'],
      added_by: 'cfbs add',
      steps: ['directory ./ services/cfbs/services/', 'policy_files services/cfbs/services/', `bundles ${file.bundle}`]
    });
    expect(meta[META_KEY]).toMatchObject({ schema_version: SCHEMA_VERSION, folders: [{ id: folderId, name: 'Services', path: './services/' }] });
    expect(meta[META_KEY].files.find(item => item.id === fileId)).toMatchObject({
      name: 'Cron jobs',
      bundle: 'cron_jobs',
      path: './services/cron_jobs.cf',
      condition: { className: 'linux' }
    });
  });

  it('lists the files of a folder in one bundles step, nested ones included, in file order', () => {
    const store = makeStore();
    const top = store.dispatch(folderAdded('Services')).payload.id;
    const nested = store.dispatch(folderAdded('DB', top)).payload.id;
    const empty = store.dispatch(folderAdded('Empty')).payload.id;
    addBlock(store, store.dispatch(fileAdded('Cron', top)).payload.id);
    addBlock(store, store.dispatch(fileAdded('Postgres', nested)).payload.id);
    store.dispatch(fileAdded('Only vars', top));

    const { meta, modules } = toCfbsProject(store.getState());

    expect(modules.map(module => module.name)).toEqual(['./services/']);
    expect(modules[0].steps.at(-1)).toBe('bundles cron postgres');
    expect(meta[META_KEY].files.map(file => file.path)).toEqual(['./services/cron.cf', './services/db/postgres.cf', './services/only_vars.cf']);
    expect(meta[META_KEY].folders.find(folder => folder.id === empty)?.path).toBe('./empty/');
  });

  it('gives a file of only variables and classes no bundles step: it has no entry bundle', () => {
    const store = makeStore();
    createNginxDemoProject(store.dispatch);
    const [common, webserver] = toCfbsProject(store.getState()).modules;

    expect(common.steps).toEqual(['copy ./common.cf services/cfbs/common.cf', 'policy_files services/cfbs/common.cf']);
    expect(webserver.steps.at(-1)).toBe('bundles webserver');
  });

  it('keeps editor-only data in layout, and resolves the execution order', () => {
    const { state } = buildProject();
    const { files } = toCfbsProject(state).meta[META_KEY];

    for (const { blocks, layout, order } of files) {
      expect(blocks.every(block => !('fileId' in block) && !('position' in block))).toBe(true);
      expect(Object.keys(layout.positions).every(id => blocks.some(block => block.instanceId === id))).toBe(true);
      expect(order.every(id => blocks.some(block => block.instanceId === id))).toBe(true);
    }
    expect(files.some(file => file.order.length > 1)).toBe(true);
  });

  it('gives paths cfbs accepts: slugged, unique folders starting with a letter, never out/', () => {
    const store = makeStore();
    const first = store.dispatch(folderAdded('Web Servers!')).payload.id;
    const second = store.dispatch(folderAdded('web servers')).payload.id;
    const numbered = store.dispatch(folderAdded('2024')).payload.id;
    const out = store.dispatch(folderAdded('Out')).payload.id;
    for (const folder of [first, second, numbered, out]) store.dispatch(fileAdded('Plan', folder));

    const names = toCfbsProject(store.getState()).modules.map(module => module.name);

    expect(names).toEqual(['./web-servers/', './web-servers-2/', './folder-2024/', './out-2/']);
  });

  it('refuses a newer schema version', () => {
    const { state } = buildProject();
    const content = toCfbsProject(state);
    content.meta[META_KEY].schema_version = SCHEMA_VERSION + 1;
    expect(() => fromCfbsProject(asCfbsJson(content))).toThrow(/schema version/);
  });
});

describe('loadCfbsProject', () => {
  it('loads a builder project with its name, description and masterfiles version', () => {
    const { state } = buildProject();
    const json = asCfbsJson(toCfbsProject(state), { name: 'Web', description: 'Hardening', type: 'policy-set' });

    const loaded = loadCfbsProject(json, 'web');

    expect(loaded).toMatchObject({ name: 'Web', description: 'Hardening', masterfiles: '3.27.1' });
    expect(loaded.data.files).toEqual(state.files);
    expect(loaded.data.edges).toEqual(state.edges);
  });

  it('opens a cfbs project without builder data with one empty file named after it', () => {
    const json = { name: 'Plain', type: 'policy-set', build: [{ name: 'masterfiles', url: 'https://github.com/cfengine/masterfiles', branch: 'master' }] };

    const { data, masterfiles: version, name } = loadCfbsProject(json, 'plain');

    expect(name).toBe('Plain');
    expect(version).toBe('master');
    expect(data.files.files).toHaveLength(1);
    expect(data.files.files[0]).toMatchObject({ name: 'Plain', parentId: null });
    expect(data.files.currentFileId).toBe(data.files.files[0].id);
    expect(data).toMatchObject({ canvas: [], edges: [], groups: [], derivedNodes: {} });
  });

  it('falls back to the folder name, and no masterfiles', () => {
    const loaded = loadCfbsProject({ build: [] }, 'my-policy');
    expect(loaded).toMatchObject({ name: 'my-policy', description: '', masterfiles: null });
  });

  it('refuses a project made by a newer builder', () => {
    const json = { name: 'x', build: [], meta: { [META_KEY]: { schema_version: SCHEMA_VERSION + 1 } } };
    expect(() => loadCfbsProject(json, 'x')).toThrow(/newer version of CFEngine Policy Builder/);
  });

  it.each([
    ['not an object', [1, 2]],
    ['null', null],
    ['non-object builder meta', { name: 'x', meta: { [META_KEY]: 'yes' } }],
    ['builder meta without a schema version', { name: 'x', meta: { [META_KEY]: {} } }]
  ])('refuses %s', (_what, json) => {
    expect(() => loadCfbsProject(json, 'x')).toThrow();
  });

  it('tolerates corrupt per-file lists', () => {
    const file = { id: 'f1', name: 'A', bundle: 'a', path: './a.cf', blocks: 'oops', layout: 'oops' };
    const { data } = loadCfbsProject({ build: [], meta: { [META_KEY]: { schema_version: SCHEMA_VERSION, files: [file] } } }, 'x');
    expect(data.canvas).toEqual([]);
    expect(data.files.files).toEqual([{ bundle: 'a', id: 'f1', name: 'A', parentId: null }]);
  });
});
