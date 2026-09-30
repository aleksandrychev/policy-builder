import { edgeAdded, edgeOutcomesChanged, edgeRemoved } from '.';
import { addBlock, addFile, makeStore } from '../test/storeTestUtils';

function setup() {
  const store = makeStore();
  const fileId = addFile(store);
  const [source, target] = [addBlock(store, fileId), addBlock(store, fileId)];
  const edgeId = store.dispatch(edgeAdded({ fileId, source, target, outcomes: ['kept'] })).payload.id;
  return { store, fileId, source, target, edgeId };
}

describe('edgesSlice', () => {
  it('allows at most one arrow per source/target pair', () => {
    const { store, fileId, source, target } = setup();
    store.dispatch(edgeAdded({ fileId, source, target, outcomes: ['repaired'] }));
    expect(store.getState().edges.map(edge => edge.outcomes)).toEqual([['kept']]);
  });

  it('changes outcomes but never to none', () => {
    const { store, edgeId } = setup();
    store.dispatch(edgeOutcomesChanged({ edgeId, outcomes: ['kept', 'repaired'] }));
    store.dispatch(edgeOutcomesChanged({ edgeId, outcomes: [] }));
    expect(store.getState().edges[0].outcomes).toEqual(['kept', 'repaired']);
  });

  it('removes an arrow', () => {
    const { store, edgeId } = setup();
    store.dispatch(edgeRemoved({ edgeId }));
    expect(store.getState().edges).toEqual([]);
  });
});
