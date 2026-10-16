import { blockRemoved } from '../canvasSlice';
import { undone } from '../history';
import { addBlock, addFile, makeStore } from '../test/storeTestUtils';

describe('modules a block needs', () => {
  it('come with the block in one step, and stay when it goes', () => {
    const store = makeStore();
    const fileId = addFile(store);
    const instanceId = addBlock(store, fileId, { blockId: 'git-checkout', params: { destination: '/srv/app' } });
    expect(store.getState().modules).toEqual([{ name: 'promise-type-git' }]);

    addBlock(store, fileId, { blockId: 'git-checkout' });
    expect(store.getState().modules).toHaveLength(1);

    store.dispatch(blockRemoved({ instanceId }));
    expect(store.getState().modules).toEqual([{ name: 'promise-type-git' }]);

    store.dispatch(undone());
    store.dispatch(undone());
    store.dispatch(undone());
    expect(store.getState().canvas).toEqual([]);
    expect(store.getState().modules).toEqual([]);
  });
});

describe('a Custom Promise block', () => {
  it('brings the module of the promise type it picks', () => {
    const store = makeStore();
    const fileId = addFile(store);
    addBlock(store, fileId, { blockId: 'custom-promise', params: { promise_type: 'docker_compose', promiser: 'app' } });
    expect(store.getState().modules).toEqual([{ name: 'promise-type-docker-compose' }]);
  });
});
