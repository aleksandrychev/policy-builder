import { groupColorChanged, groupCreated, groupFrameResized, groupFramesFitted, groupRemoved, groupRenamed } from '.';
import { addBlock, addFile, makeStore } from '../test/storeTestUtils';
import { selectGroupsForFile } from './selectors';

function setup() {
  const store = makeStore();
  const fileId = addFile(store);
  const instanceId = addBlock(store, fileId);
  const create = (name: string) => store.dispatch(groupCreated({ color: 'primary', fileId, instanceIds: [instanceId], name })).payload.id;
  return { store, fileId, create };
}

const groupOf = (store: ReturnType<typeof makeStore>, groupId: string) => store.getState().groups.find(group => group.id === groupId);
const rect = { x: 0, y: 0, width: 300, height: 200 };

describe('groupsSlice', () => {
  it('records a created group without its member list', () => {
    const { store, fileId, create } = setup();
    const groupId = create('Web');
    expect(groupOf(store, groupId)).toEqual({ id: groupId, color: 'primary', fileId, name: 'Web' });
  });

  it('renames and recolours one group', () => {
    const { store, create } = setup();
    const target = create('A');
    const other = create('B');
    store.dispatch(groupRenamed({ groupId: target, name: 'Renamed' }));
    store.dispatch(groupColorChanged({ groupId: target, color: 'warning' }));
    expect(groupOf(store, target)).toMatchObject({ name: 'Renamed', color: 'warning' });
    expect(groupOf(store, other)).toMatchObject({ name: 'B', color: 'primary' });
  });

  it('resizes a frame and fits selected frames back to their members', () => {
    const { store, create } = setup();
    const fitted = create('A');
    const untouched = create('B');
    store.dispatch(groupFrameResized({ groupId: fitted, rect }));
    store.dispatch(groupFrameResized({ groupId: untouched, rect }));
    expect(groupOf(store, fitted)?.rect).toEqual(rect);

    store.dispatch(groupFramesFitted({ groupIds: [fitted] }));
    expect(groupOf(store, fitted)).not.toHaveProperty('rect');
    expect(groupOf(store, untouched)?.rect).toEqual(rect);
  });

  it('removes a group', () => {
    const { store, create } = setup();
    const removed = create('A');
    const kept = create('B');
    store.dispatch(groupRemoved({ groupId: removed }));
    expect(store.getState().groups.map(group => group.id)).toEqual([kept]);
  });

  it('selects a file’s groups', () => {
    const { store, fileId, create } = setup();
    const groupId = create('A');
    expect(selectGroupsForFile(store.getState(), fileId).map(group => group.id)).toEqual([groupId]);
    expect(selectGroupsForFile(store.getState(), 'other')).toEqual([]);
    expect(selectGroupsForFile(store.getState(), null)).toEqual([]);
  });
});
