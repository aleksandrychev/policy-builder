import { clipboardCleared, clipboardCopied, clipboardCut, clipboardDowngradedToCopy } from '.';
import { blockLabelChanged } from '../canvasSlice';
import { addBlock, addFile, blockOf, makeStore } from '../test/storeTestUtils';
import { selectClipboard, selectCutPendingId } from './selectors';

function setup() {
  const store = makeStore();
  const instanceId = addBlock(store, addFile(store));
  return { store, instanceId, instance: blockOf(store, instanceId)! };
}

describe('clipboardSlice', () => {
  it('reports the cut block as pending only in cut mode', () => {
    const { store, instanceId, instance } = setup();
    expect(selectCutPendingId(store.getState())).toBeNull();

    store.dispatch(clipboardCut({ instance }));
    expect(selectCutPendingId(store.getState())).toBe(instanceId);

    store.dispatch(clipboardDowngradedToCopy());
    expect(selectCutPendingId(store.getState())).toBeNull();
    expect(selectClipboard(store.getState()).snapshot?.instanceId).toBe(instanceId);
  });

  it('never reports a copied block as pending', () => {
    const { store, instance } = setup();
    store.dispatch(clipboardCopied({ instance }));
    expect(selectCutPendingId(store.getState())).toBeNull();
    store.dispatch(clipboardDowngradedToCopy());
    expect(selectClipboard(store.getState()).mode).toBe('copy');
  });

  it('keeps a snapshot independent of later edits to the source', () => {
    const { store, instanceId, instance } = setup();
    store.dispatch(clipboardCopied({ instance }));
    store.dispatch(blockLabelChanged({ instanceId, label: 'Edited' }));
    expect(selectClipboard(store.getState()).snapshot?.label).toBe('Report');
  });

  it('clears', () => {
    const { store, instance } = setup();
    store.dispatch(clipboardCut({ instance }));
    store.dispatch(clipboardCleared());
    expect(selectClipboard(store.getState())).toEqual({ mode: null, snapshot: null });
    expect(selectCutPendingId(store.getState())).toBeNull();
  });
});
