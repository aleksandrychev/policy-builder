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

  it('writes one plain local file module per policy file, its folder as a path', () => {
    const { fileId, state } = buildProject();
    const { meta, modules } = toCfbsProject(state);
    const file = state.files.files.find(item => item.id === fileId)!;
    const path = `policy/services/${file.namespace}.cf`;

    expect(modules).toHaveLength(state.files.files.length);
    // Exactly what `cfbs add` writes, but for the namespaced bundle; no builder data on it.
    expect(modules.find(item => item.name === `./${path}`)).toEqual({
      name: `./${path}`,
      description: 'Local policy file added using cfbs command line',
      tags: ['local'],
      added_by: 'cfbs add',
      steps: [`copy ./${path} services/cfbs/${path}`, `policy_files services/cfbs/${path}`, `bundles ${file.namespace}:main`]
    });
    expect(meta[META_KEY]).toMatchObject({ schema_version: SCHEMA_VERSION, folders: [{ name: 'Services', path: './policy/services/' }] });
    expect(meta[META_KEY].files.map(item => item.path)).toEqual(modules.map(item => item.name));
    expect(meta[META_KEY].files.find(item => item.id === fileId)).toMatchObject({
      name: 'Cron jobs',
      namespace: file.namespace,
      path: `./${path}`,
      condition: { className: 'linux' }
    });
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

  it('gives paths cfbs accepts: slugged, unique folders; file names starting with a letter', () => {
    const store = makeStore();
    const first = store.dispatch(folderAdded('Web Servers!')).payload.id;
    const second = store.dispatch(folderAdded('web servers')).payload.id;
    store.dispatch(fileAdded('2024 plan', first));
    store.dispatch(fileAdded('Main', second));

    const names = toCfbsProject(store.getState()).modules.map(module => module.name);

    expect(names).toEqual(['./policy/web-servers/file_2024_plan.cf', './policy/web-servers-2/main.cf']);
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
    const file = { id: 'f1', name: 'A', namespace: 'a', path: './policy/a.cf', blocks: 'oops', layout: 'oops' };
    const { data } = loadCfbsProject({ build: [], meta: { [META_KEY]: { schema_version: SCHEMA_VERSION, files: [file] } } }, 'x');
    expect(data.canvas).toEqual([]);
    expect(data.files.files).toEqual([{ id: 'f1', name: 'A', namespace: 'a', parentId: null }]);
  });
});
