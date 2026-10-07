import { type ComponentProps, type ReactNode, createElement } from 'react';
import { Provider } from 'react-redux';

import { act, renderHook } from '@testing-library/react';

import { useAppSelector } from '../store';
import { blockRemoved } from '../store/canvasSlice';
import { selectCanvasBlocks } from '../store/canvasSlice/selectors';
import { edgeAdded } from '../store/edgesSlice';
import { undone } from '../store/history';
import { type TestStore, addBlock, addFile, makeStore } from '../store/test/storeTestUtils';
import { useGroupActions } from './useGroupActions';

// The hook as ProjectView uses it: `instances` are the open file's blocks.
function setUp(blockCount = 3) {
  const store = makeStore();
  const fileId = addFile(store);
  const ids = Array.from({ length: blockCount }, () => addBlock(store, fileId));
  const announce = vi.fn();
  const onGroupCreated = vi.fn();
  const { result } = renderHook(
    () => {
      const instances = useAppSelector(selectCanvasBlocks).filter(instance => instance.fileId === fileId);
      return useGroupActions({ announce, currentFileId: fileId, instances, onGroupCreated, undoKey: '⌘Z' });
    },
    { wrapper: ({ children }: { children: ReactNode }) => createElement(Provider, { store } as ComponentProps<typeof Provider>, children) }
  );
  const run = <T,>(action: (actions: typeof result.current) => T): T => {
    let value!: T;
    act(() => void (value = action(result.current)));
    return value;
  };
  return { store, fileId, ids, announce, onGroupCreated, result, run };
}

const dispatch = (store: TestStore, action: Parameters<TestStore['dispatch']>[0]) => act(() => void store.dispatch(action));

describe('useGroupActions', () => {
  it('names and colours each new group after the first free number, and selects it', () => {
    const { ids, announce, onGroupCreated, result, run } = setUp();
    run(actions => actions.createGroup([ids[0], ids[1]]));
    run(actions => actions.createGroup([ids[2]]));

    expect(result.current.liveGroups.map(group => [group.name, group.color])).toEqual([
      ['Group 1', 'primary'],
      ['Group 2', 'info']
    ]);
    const second = result.current.liveGroups[1].id;
    expect(result.current.selectedGroupId).toBe(second);
    expect(result.current.freshGroupId).toBe(second);
    expect(onGroupCreated).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenNthCalledWith(1, 'Grouped 2 blocks — ⌘Z to undo');
    expect(announce).toHaveBeenNthCalledWith(2, 'Grouped 1 block — ⌘Z to undo');
  });

  it('reuses the number of a group that was ungrouped', () => {
    const { ids, result, run } = setUp();
    run(actions => actions.createGroup([ids[0]]));
    run(actions => actions.createGroup([ids[1]]));
    run(actions => actions.ungroup(result.current.liveGroups[0].id));
    run(actions => actions.createGroup([ids[2]]));
    expect(result.current.liveGroups.map(group => group.name)).toEqual(['Group 2', 'Group 1']);
  });

  it('refuses a group whose arrows would make a loop, and says why', () => {
    const { store, fileId, ids, announce, onGroupCreated, result, run } = setUp();
    dispatch(store, edgeAdded({ fileId, source: ids[0], target: ids[1], outcomes: ['kept'] }));
    dispatch(store, edgeAdded({ fileId, source: ids[1], target: ids[2], outcomes: ['kept'] }));

    run(actions => actions.createGroup([ids[0], ids[2]]));
    expect(result.current.groups).toEqual([]);
    expect(result.current.selectedGroupId).toBeNull();
    expect(onGroupCreated).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith('Can’t group these blocks: arrows through the group would make a loop.');
  });

  it('hides a group whose blocks are all gone, until an undo brings one back', () => {
    const { store, ids, result, run } = setUp();
    run(actions => actions.createGroup([ids[0]]));
    const groupId = result.current.selectedGroupId;

    dispatch(store, blockRemoved({ instanceId: ids[0] }));
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.liveGroups).toEqual([]);
    expect(result.current.selectedGroup).toBeUndefined();

    dispatch(store, undone());
    expect(result.current.selectedGroup?.id).toBe(groupId);
  });

  it('deletes a group with its blocks as one undo step', () => {
    const { store, ids, announce, result, run } = setUp();
    run(actions => actions.createGroup([ids[0], ids[1]]));
    const groupId = result.current.selectedGroupId!;
    const before = store.getState();

    run(actions => actions.deleteGroupWithBlocks(groupId));
    expect(store.getState().canvas.map(block => block.instanceId)).toEqual([ids[2]]);
    expect(store.getState().groups).toEqual([]);
    expect(result.current.selectedGroupId).toBeNull();
    expect(announce).toHaveBeenLastCalledWith('Deleted the group and its 2 blocks — ⌘Z to undo');

    dispatch(store, undone());
    expect(store.getState().canvas).toBe(before.canvas);
    expect(store.getState().groups).toBe(before.groups);
  });

  it('moves a dropped block into a group, or refuses when its arrows would make a loop', () => {
    const { store, fileId, ids, announce, result, run } = setUp();
    run(actions => actions.createGroup([ids[0]]));
    const groupId = result.current.selectedGroupId!;

    expect(run(actions => actions.canvasCallbacks.onMembershipChange([ids[1]], groupId))).toBe(true);
    expect(announce).toHaveBeenLastCalledWith('Added to "Group 1"');
    expect(run(actions => actions.canvasCallbacks.onMembershipChange([ids[1]], null))).toBe(true);
    expect(announce).toHaveBeenLastCalledWith('Removed from its group');

    // g -> b -> c, then c dropped into g.
    dispatch(store, edgeAdded({ fileId, source: groupId, target: ids[1], outcomes: ['kept'] }));
    dispatch(store, edgeAdded({ fileId, source: ids[1], target: ids[2], outcomes: ['kept'] }));
    expect(run(actions => actions.canvasCallbacks.onMembershipChange([ids[2]], groupId))).toBe(false);
    expect(announce).toHaveBeenLastCalledWith('Can’t move it there: its arrows would make a loop.');
    expect(store.getState().canvas.find(block => block.instanceId === ids[2])?.groupId).toBeUndefined();
  });

  it('snaps a resized frame to the grid', () => {
    const { store, ids, result, run } = setUp();
    run(actions => actions.createGroup([ids[0]]));
    const groupId = result.current.selectedGroupId!;

    run(actions => actions.canvasCallbacks.onGroupResize(groupId, { x: 11, y: 29, width: 409, height: 151 }));
    expect(store.getState().groups[0].rect).toEqual({ x: 20, y: 20, width: 400, height: 160 });
  });
});
