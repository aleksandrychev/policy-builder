import { describe, expect, it } from 'vitest';

import { createNginxDemoProject } from '../demo/nginxDemoProject';
import { derivedNodeMoved } from '../store/derivedNodesSlice';
import { fileAdded, fileConditionClassNameChanged, fileConditionEnabled, folderAdded } from '../store/filesSlice';
import { groupCreated } from '../store/groupsSlice';
import { addBlock, makeStore } from '../store/test/storeTestUtils';
import { SCHEMA_VERSION, fromBuilderProject, loadCfbsProject, toCfbsProject } from './cfbsProject';

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
const IDENTITY = { description: 'Nginx baseline', moduleName: 'web-demo', name: 'Web Demo' };
const asCfbsJson = ({ modules }: ReturnType<typeof toCfbsProject>, extra: object = {}) =>
  JSON.parse(JSON.stringify({ name: 'x', build: [masterfiles, ...modules], ...extra }));
// .policy-builder/project.json as it's read back from disk.
const asBuilderJson = ({ project }: ReturnType<typeof toCfbsProject>) => JSON.parse(JSON.stringify(project));

describe('cfbsProject', () => {
  it('round-trips the project through cfbs.json', () => {
    const { state } = buildProject();

    const restored = fromBuilderProject(asBuilderJson(toCfbsProject(state, IDENTITY)));

    expect(restored.files).toEqual(state.files);
    expect(restored.canvas).toEqual(expect.arrayContaining(state.canvas));
    expect(restored.canvas).toHaveLength(state.canvas.length);
    expect(restored.edges).toEqual(state.edges);
    expect(restored.groups).toEqual(state.groups);
    expect(restored.derivedNodes).toEqual(state.derivedNodes);
  });

  it('mirrors the file tree: a top-level file is a file module, a top-level folder a directory module', () => {
    const { fileId, folderId, state } = buildProject();
    const { project, modules } = toCfbsProject(state, IDENTITY);
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
    expect(project).toMatchObject({ schema_version: SCHEMA_VERSION, folders: [{ id: folderId, name: 'Services', path: './services/' }] });
    expect(project.files.find(item => item.id === fileId)).toMatchObject({
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

    const { project, modules } = toCfbsProject(store.getState(), IDENTITY);

    expect(modules.map(module => module.name)).toEqual(['./services/']);
    expect(modules[0].steps.at(-1)).toBe('bundles cron postgres');
    expect(project.files.map(file => file.path)).toEqual(['./services/cron.cf', './services/db/postgres.cf', './services/only_vars.cf']);
    expect(project.folders.find(folder => folder.id === empty)?.path).toBe('./empty/');
  });

  it('gives a file of only variables and classes no bundles step: it has no entry bundle', () => {
    const store = makeStore();
    createNginxDemoProject(store.dispatch);
    const [common, webserver] = toCfbsProject(store.getState(), IDENTITY).modules;

    expect(common.steps).toEqual(['copy ./common.cf services/cfbs/common.cf', 'policy_files services/cfbs/common.cf']);
    expect(webserver.steps.at(-1)).toBe('bundles webserver');
  });

  it('keeps editor-only data in layout, and resolves the execution order', () => {
    const { state } = buildProject();
    const { files } = toCfbsProject(state, IDENTITY).project;

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

    const names = toCfbsProject(store.getState(), IDENTITY).modules.map(module => module.name);

    expect(names).toEqual(['./web-servers/', './web-servers-2/', './folder-2024/', './out-2/']);
  });

  it('provides the whole project as one module, its files under services/cfbs/<module>/', () => {
    const { state } = buildProject();
    const { project, provided } = toCfbsProject(state, IDENTITY);

    expect(project).toMatchObject({ name: 'Web Demo', module_name: 'web-demo' });
    expect(provided).toEqual({
      description: 'Nginx baseline',
      tags: ['policy-builder'],
      steps: [
        'copy ./common.cf services/cfbs/web-demo/common.cf',
        'copy ./webserver.cf services/cfbs/web-demo/webserver.cf',
        'copy ./services/ services/cfbs/web-demo/services/',
        'policy_files services/cfbs/web-demo/',
        `bundles webserver ${state.files.files.find(file => file.name === 'Cron jobs')!.bundle}`
      ]
    });
  });

  it('refuses a newer schema version', () => {
    const { state } = buildProject();
    const content = toCfbsProject(state, IDENTITY);
    content.project.schema_version = SCHEMA_VERSION + 1;
    expect(() => fromBuilderProject(asBuilderJson(content))).toThrow(/schema version/);
  });
});

describe('loadCfbsProject', () => {
  it('loads a builder project with its name, description and masterfiles version', () => {
    const { state } = buildProject();
    const content = toCfbsProject(state, IDENTITY);
    const json = asCfbsJson(content, { name: 'Web', description: 'Hardening', type: 'policy-set' });

    const loaded = loadCfbsProject(json, asBuilderJson(content), 'web');

    expect(loaded).toMatchObject({ name: 'Web', description: 'Hardening', masterfiles: '3.27.1' });
    expect(loaded.data.files).toEqual(state.files);
    expect(loaded.data.edges).toEqual(state.edges);
  });

  it('opens a cfbs project without builder data with one empty file named after it', () => {
    const json = { name: 'Plain', type: 'policy-set', build: [{ name: 'masterfiles', url: 'https://github.com/cfengine/masterfiles', branch: 'master' }] };

    const { data, masterfiles: version, name } = loadCfbsProject(json, null, 'plain');

    expect(name).toBe('Plain');
    expect(version).toBe('master');
    expect(data.files.files).toHaveLength(1);
    expect(data.files.files[0]).toMatchObject({ name: 'Plain', parentId: null });
    expect(data.files.currentFileId).toBe(data.files.files[0].id);
    expect(data).toMatchObject({ canvas: [], edges: [], groups: [], derivedNodes: {} });
  });

  it('loads a module project: its type, module name and display name', () => {
    const { state } = buildProject();
    const content = toCfbsProject(state, IDENTITY);
    const json = { name: 'web-demo', type: 'module', description: 'Nginx baseline', provides: { 'web-demo': content.provided } };

    const loaded = loadCfbsProject(json, asBuilderJson(content), 'web-demo');

    expect(loaded).toMatchObject({ type: 'module', moduleName: 'web-demo', name: 'Web Demo', masterfiles: null });
    expect(loaded.data.files).toEqual(state.files);
  });

  it('falls back to the folder name, and no masterfiles', () => {
    const loaded = loadCfbsProject({ build: [] }, null, 'my-policy');
    expect(loaded).toMatchObject({ name: 'my-policy', description: '', masterfiles: null });
  });

  it('refuses a project made by a newer builder', () => {
    expect(() => loadCfbsProject({ name: 'x', build: [] }, { schema_version: SCHEMA_VERSION + 1 }, 'x')).toThrow(/newer version of CFEngine Policy Builder/);
  });

  it.each([
    ['a cfbs.json that is not an object', [1, 2], null],
    ['a null cfbs.json', null, null],
    ['non-object builder data', { name: 'x' }, 'yes'],
    ['builder data without a schema version', { name: 'x' }, {}]
  ])('refuses %s', (_what, json, builder) => {
    expect(() => loadCfbsProject(json, builder, 'x')).toThrow();
  });

  it('tolerates corrupt per-file lists', () => {
    const file = { id: 'f1', name: 'A', bundle: 'a', path: './a.cf', blocks: 'oops', layout: 'oops' };
    const { data } = loadCfbsProject({ build: [] }, { schema_version: SCHEMA_VERSION, files: [file] }, 'x');
    expect(data.canvas).toEqual([]);
    expect(data.files.files).toEqual([{ bundle: 'a', id: 'f1', name: 'A', parentId: null }]);
  });
});
