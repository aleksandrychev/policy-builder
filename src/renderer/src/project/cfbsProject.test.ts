import { describe, expect, it } from 'vitest';

import { createNginxDemoProject } from '../demo/nginxDemoProject';
import { derivedNodeMoved } from '../store/derivedNodesSlice';
import { fileAdded, fileConditionClassNameChanged, fileConditionEnabled, folderAdded } from '../store/filesSlice';
import { groupCreated } from '../store/groupsSlice';
import { addBlock, makeStore } from '../store/test/storeTestUtils';
import { ADDED_BY, SCHEMA_VERSION, fromCfbsProject, toCfbsProject } from './cfbsProject';

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
