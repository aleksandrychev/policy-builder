import { BINDING_TARGET_PREFIX, blockRemoved, blocksRemovedForFile, dataChainRemoved, entryAdded, entryRemoved, paramBound } from './canvasSlice';
import { clipboardCopied } from './clipboardSlice';
import { derivedNodeMoved } from './derivedNodesSlice';
import { edgeAdded } from './edgesSlice';
import { fileRemoved } from './filesSlice';
import { groupCreated } from './groupsSlice';
import { historyCleared, inOneStep, undone } from './history';
import { projectCreated } from './projectSlice';
import { type TestStore, addBlock, addFile, blockOf, makeStore, undoAll } from './test/storeTestUtils';

// Data-chain node keys, as canvas/dataChains.ts builds them.
const chainKey = (fileId: string, instanceId: string, entryId = '') => `${fileId}|data|${instanceId}|${entryId}`;
const place = (store: TestStore, key: string) => store.dispatch(derivedNodeMoved({ key, position: { x: 1, y: 2 } }));
const derivedKeys = (store: TestStore) => Object.keys(store.getState().derivedNodes).sort();

function setup() {
  const store = makeStore();
  const fileId = addFile(store, 'Main');
  const a = addBlock(store, fileId);
  const b = addBlock(store, fileId);
  const c = addBlock(store, fileId);
  store.dispatch(edgeAdded({ fileId, source: a, target: b, outcomes: ['kept'] }));
  store.dispatch(edgeAdded({ fileId, source: b, target: c, outcomes: ['repaired'] }));
  return { store, fileId, a, b, c };
}

describe('cross-slice cascades', () => {
  it('removes a block’s arrows and its data-chain positions with it', () => {
    const { store, fileId, a, b, c } = setup();
    place(store, chainKey(fileId, b));
    place(store, chainKey(fileId, b, 'e1'));
    place(store, chainKey(fileId, c));
    const gateKey = `${fileId}|if|linux`;
    place(store, gateKey);

    store.dispatch(blockRemoved({ instanceId: b }));

    expect(store.getState().edges).toEqual([]);
    expect(derivedKeys(store)).toEqual([chainKey(fileId, c), gateKey].sort());
    expect(blockOf(store, a)).toBeDefined();
  });

  it('keeps arrows between the remaining blocks', () => {
    const { store, a, b, c } = setup();
    store.dispatch(blockRemoved({ instanceId: c }));
    expect(store.getState().edges.map(edge => [edge.source, edge.target])).toEqual([[a, b]]);
  });

  it('forgets a removed entry’s chain position only', () => {
    const { store, fileId } = setup();
    const instanceId = addBlock(store, fileId, { blockId: 'define-variable', params: {}, entries: [{ id: 'e1', params: {} }] });
    store.dispatch(entryAdded({ instanceId, entry: { id: 'e2', params: {} } }));
    place(store, chainKey(fileId, instanceId, 'e1'));
    place(store, chainKey(fileId, instanceId, 'e2'));
    store.dispatch(entryRemoved({ instanceId, entryId: 'e1' }));
    expect(derivedKeys(store)).toEqual([chainKey(fileId, instanceId, 'e2')]);
  });

  it('forgets a removed data chain’s position', () => {
    const { store, fileId, a } = setup();
    const target = `${BINDING_TARGET_PREFIX}message`;
    store.dispatch(paramBound({ instanceId: a, param: 'message', binding: { valueSourceId: 'file-content', params: {} } }));
    place(store, chainKey(fileId, a, target));
    store.dispatch(dataChainRemoved({ instanceId: a, entryId: target }));
    expect(derivedKeys(store)).toEqual([]);
  });

  // Removing param "path"'s chain must not forget where "path_mode"'s was dragged.
  it('keeps the position of a chain whose target merely starts with the removed one', () => {
    const { store, fileId, a } = setup();
    const binding = { valueSourceId: 'file-content', params: {} };
    store.dispatch(paramBound({ instanceId: a, param: 'path', binding }));
    store.dispatch(paramBound({ instanceId: a, param: 'path_mode', binding }));
    place(store, chainKey(fileId, a, `${BINDING_TARGET_PREFIX}path`));
    place(store, chainKey(fileId, a, `${BINDING_TARGET_PREFIX}path_mode`));
    store.dispatch(dataChainRemoved({ instanceId: a, entryId: `${BINDING_TARGET_PREFIX}path` }));
    expect(derivedKeys(store)).toEqual([chainKey(fileId, a, `${BINDING_TARGET_PREFIX}path_mode`)]);
  });

  it('clears a file’s arrows, groups and derived positions along with its blocks', () => {
    const { store, fileId, a } = setup();
    const otherFile = addFile(store, 'Other');
    const x = addBlock(store, otherFile);
    const y = addBlock(store, otherFile);
    store.dispatch(edgeAdded({ fileId: otherFile, source: x, target: y, outcomes: ['kept'] }));
    store.dispatch(groupCreated({ color: 'info', fileId, instanceIds: [a], name: 'Main group' }));
    store.dispatch(groupCreated({ color: 'info', fileId: otherFile, instanceIds: [x], name: 'Other group' }));
    place(store, `${fileId}|if|linux`);
    place(store, `${otherFile}|if|linux`);

    store.dispatch(blocksRemovedForFile({ fileId }));

    const state = store.getState();
    expect(state.canvas.map(block => block.fileId)).toEqual([otherFile, otherFile]);
    expect(state.edges.map(edge => edge.fileId)).toEqual([otherFile]);
    expect(state.groups.map(group => group.name)).toEqual(['Other group']);
    expect(derivedKeys(store)).toEqual([`${otherFile}|if|linux`]);
  });

  it('resets canvas, arrows, groups, derived positions and clipboard on projectCreated', () => {
    const { store, fileId, a } = setup();
    store.dispatch(groupCreated({ color: 'info', fileId, instanceIds: [a], name: 'G' }));
    place(store, `${fileId}|if|linux`);
    store.dispatch(clipboardCopied({ instance: blockOf(store, a)! }));

    store.dispatch(projectCreated({ name: 'Fresh' }));

    const state = store.getState();
    expect(state.project?.name).toBe('Fresh');
    expect(state).toMatchObject({ canvas: [], edges: [], groups: [], derivedNodes: {}, clipboard: { mode: null, snapshot: null } });
  });

  it('undoes deleting a file and its blocks as one step', () => {
    const { store, fileId, a } = setup();
    store.dispatch(groupCreated({ color: 'info', fileId, instanceIds: [a], name: 'G' }));
    place(store, `${fileId}|if|linux`);
    store.dispatch(historyCleared());
    const before = store.getState();

    inOneStep(store.dispatch, () => {
      store.dispatch(fileRemoved({ fileId }));
      store.dispatch(blocksRemovedForFile({ fileId }));
    });
    expect(store.getState()).toMatchObject({ canvas: [], edges: [], groups: [], derivedNodes: {} });
    expect(store.getState().files.files).toEqual([]);

    store.dispatch(undone());
    const restored = store.getState();
    for (const key of ['canvas', 'edges', 'groups', 'derivedNodes', 'files'] as const) expect(restored[key]).toBe(before[key]);
    expect(undoAll(store)).toBe(0);
  });
});
