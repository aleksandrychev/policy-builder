import { describe, expect, it } from 'vitest';

import { createNginxDemoProject } from '../demo/nginxDemoProject';
import { derivedNodeMoved } from '../store/derivedNodesSlice';
import { fileAdded, fileConditionClassNameChanged, fileConditionEnabled, folderAdded } from '../store/filesSlice';
import { groupCreated } from '../store/groupsSlice';
import { addBlock, makeStore } from '../store/test/storeTestUtils';
import { ADDED_BY, SCHEMA_VERSION, fromCfbsProject, loadCfbsProject, toCfbsProject } from './cfbsProject';

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
  return { fileId, state: store.getState() };
}

describe('cfbsProject', () => {
  it('round-trips the project through cfbs.json', () => {
    const { state } = buildProject();
    const { builder, modules } = toCfbsProject(state);
    const cfbsJson = JSON.parse(JSON.stringify({ name: 'x', build: [{ name: 'masterfiles' }, ...modules], builder }));

    const restored = fromCfbsProject(cfbsJson);

    expect(restored.files).toEqual(state.files);
    expect(restored.canvas).toEqual(expect.arrayContaining(state.canvas));
    expect(restored.canvas).toHaveLength(state.canvas.length);
    expect(restored.edges).toEqual(state.edges);
    expect(restored.groups).toEqual(state.groups);
    expect(restored.derivedNodes).toEqual(state.derivedNodes);
  });

  it('writes one build module per policy file, with cfbs steps', () => {
    const { fileId, state } = buildProject();
    const { builder, modules } = toCfbsProject(state);
    const file = state.files.files.find(item => item.id === fileId)!;

    expect(builder.schema_version).toBe(SCHEMA_VERSION);
    expect(modules).toHaveLength(state.files.files.length);
    const module = modules.find(item => item.representation.id === fileId)!;
    // Paths use the namespace, not the display name: cfbs splits steps on whitespace.
    const path = `policy/${file.namespace}.cf`;
    expect(module).toMatchObject({
      name: `./${path}`,
      added_by: ADDED_BY,
      tags: ['local'],
      steps: [`copy ./${path} services/cfbs/${path}`, `policy_files services/cfbs/${path}`, `bundles ${file.namespace}:main`],
      representation: { name: 'Cron jobs', namespace: file.namespace }
    });
    expect(module.steps.every(step => step.split(' ').length === (step.startsWith('copy') ? 3 : 2))).toBe(true);
    expect(module.representation.blocks.every(block => !('fileId' in block))).toBe(true);
  });

  it('refuses a newer schema version', () => {
    expect(() => fromCfbsProject({ builder: { schema_version: SCHEMA_VERSION + 1 }, build: [] })).toThrow(/schema version/);
  });
});

describe('loadCfbsProject', () => {
  const masterfiles = { name: 'masterfiles', version: '3.27.1', added_by: 'cfbs init' };

  it('loads a builder project with its name, description and masterfiles version', () => {
    const { state } = buildProject();
    const { builder, modules } = toCfbsProject(state);
    const json = JSON.parse(JSON.stringify({ name: 'Web', description: 'Hardening', type: 'policy-set', build: [masterfiles, ...modules], builder }));

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
    expect(() => loadCfbsProject({ name: 'x', build: [], builder: { schema_version: SCHEMA_VERSION + 1 } }, 'x')).toThrow(
      /newer version of CFEngine Policy Builder/
    );
  });

  it.each([
    ['not an object', [1, 2]],
    ['null', null],
    ['a non-object builder', { name: 'x', builder: 'yes' }],
    ['a builder without a schema version', { name: 'x', builder: {} }]
  ])('refuses %s', (_what, json) => {
    expect(() => loadCfbsProject(json, 'x')).toThrow();
  });

  it('tolerates corrupt per-file lists', () => {
    const module = { added_by: ADDED_BY, name: './policy/a.cf', representation: { id: 'f1', name: 'A', namespace: 'a', parentId: null, blocks: 'oops' } };
    const { data } = loadCfbsProject({ build: [module], builder: { schema_version: SCHEMA_VERSION, files: ['f1'] } }, 'x');
    expect(data.canvas).toEqual([]);
    expect(data.files.files).toHaveLength(1);
  });
});
