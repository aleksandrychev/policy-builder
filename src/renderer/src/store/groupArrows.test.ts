import { edgeAdded } from './edgesSlice';
import { changeMembership, groupBlocks, ungroupBlocks } from './groupArrows';
import { undone } from './history';
import { type TestStore, addBlock, addFile, blockOf, makeStore } from './test/storeTestUtils';

const link = (store: TestStore, fileId: string, source: string, target: string) => store.dispatch(edgeAdded({ fileId, source, target, outcomes: ['kept'] }));

// The arrows as "source->target", ids shown by name.
const arrows = (store: TestStore, names: Record<string, string>) =>
  store.getState().edges.map(({ source, target }) => `${names[source] ?? source}->${names[target] ?? target}`);

function setUp() {
  const store = makeStore();
  const fileId = addFile(store);
  const [a, b, c] = [addBlock(store, fileId), addBlock(store, fileId), addBlock(store, fileId)];
  return { store, fileId, a, b, c, names: { [a]: 'a', [b]: 'b', [c]: 'c' } };
}

const group = (fileId: string, instanceIds: string[]) => ({ color: 'primary' as const, fileId, instanceIds, name: 'Group 1' });

// The undoable content, to compare before and after an undo.
const content = (store: TestStore) => {
  const { canvas, edges, groups } = store.getState();
  return { canvas, edges, groups };
};

describe('groupBlocks', () => {
  it('groups the blocks and attaches their arrows to the frame, as one undo step', () => {
    const { store, fileId, a, b, c, names } = setUp();
    link(store, fileId, a, b);
    link(store, fileId, b, c);
    const before = content(store);

    const groupId = store.dispatch(groupBlocks(group(fileId, [a, b])))!;
    expect(blockOf(store, a)?.groupId).toBe(groupId);
    expect(blockOf(store, b)?.groupId).toBe(groupId);
    expect(blockOf(store, c)?.groupId).toBeUndefined();
    expect(arrows(store, { ...names, [groupId]: 'g' })).toEqual(['a->b', 'g->c']);

    store.dispatch(undone());
    expect(content(store)).toEqual(before);
  });

  it('refuses, changing nothing, when attaching the arrows to the frame would close a loop', () => {
    const { store, fileId, a, b, c } = setUp();
    link(store, fileId, a, b);
    link(store, fileId, b, c);
    const before = store.getState();

    // a and c grouped: a->b becomes g->b, b->c becomes b->g.
    expect(store.dispatch(groupBlocks(group(fileId, [a, c])))).toBeNull();
    expect(store.getState()).toBe(before);
  });

  it('leaves other files’ arrows alone', () => {
    const { store, fileId, a, b } = setUp();
    const otherFile = addFile(store, 'Other');
    const [x, y] = [addBlock(store, otherFile), addBlock(store, otherFile)];
    link(store, otherFile, x, y);
    link(store, fileId, a, b);

    store.dispatch(groupBlocks(group(fileId, [a])));
    expect(store.getState().edges.filter(item => item.fileId === otherFile)).toEqual([expect.objectContaining({ source: x, target: y })]);
  });
});

describe('changeMembership', () => {
  it('turns a joining block’s arrow to the group into one to the group’s first block', () => {
    const { store, fileId, a, b, c, names } = setUp();
    const groupId = store.dispatch(groupBlocks(group(fileId, [a])))!;
    link(store, fileId, c, groupId);

    expect(store.dispatch(changeMembership(fileId, [c], groupId))).toBe(true);
    expect(blockOf(store, c)?.groupId).toBe(groupId);
    expect(blockOf(store, b)?.groupId).toBeUndefined();
    expect(arrows(store, { ...names, [groupId]: 'g' })).toEqual(['c->a']);
  });

  it('attaches the arrows of a block leaving its group to the frame', () => {
    const { store, fileId, a, b, names } = setUp();
    link(store, fileId, a, b);
    const groupId = store.dispatch(groupBlocks(group(fileId, [a, b])))!;

    expect(store.dispatch(changeMembership(fileId, [b], null))).toBe(true);
    expect(blockOf(store, b)?.groupId).toBeUndefined();
    expect(arrows(store, { ...names, [groupId]: 'g' })).toEqual(['g->b']);
  });

  it('removes a group left without blocks, with its arrows, in the same undo step', () => {
    const { store, fileId, a, b } = setUp();
    const groupId = store.dispatch(groupBlocks(group(fileId, [a])))!;
    link(store, fileId, groupId, b);
    const before = content(store);

    store.dispatch(changeMembership(fileId, [a], null));
    expect(blockOf(store, a)?.groupId).toBeUndefined();
    expect(store.getState().groups).toEqual([]);
    expect(store.getState().edges).toEqual([]);

    store.dispatch(undone());
    expect(content(store)).toEqual(before);
  });

  it('refuses, changing nothing, when the move would close a loop', () => {
    const { store, fileId, a, b, c } = setUp();
    const groupId = store.dispatch(groupBlocks(group(fileId, [a])))!;
    link(store, fileId, groupId, b);
    link(store, fileId, b, c);
    const before = store.getState();

    // c joining: b->c becomes b->g, next to g->b.
    expect(store.dispatch(changeMembership(fileId, [c], groupId))).toBe(false);
    expect(store.getState()).toBe(before);
  });
});

describe('ungroupBlocks', () => {
  it('removes the frame, keeps its blocks and fans its arrows out to them, as one undo step', () => {
    const { store, fileId, a, b, c, names } = setUp();
    link(store, fileId, a, b);
    link(store, fileId, b, c);
    const groupId = store.dispatch(groupBlocks(group(fileId, [a, b])))!;
    const grouped = content(store);

    store.dispatch(ungroupBlocks(fileId, groupId));
    expect(store.getState().groups).toEqual([]);
    expect(store.getState().canvas.map(item => item.groupId)).toEqual([undefined, undefined, undefined]);
    expect(arrows(store, names)).toEqual(['a->b', 'b->c']);

    store.dispatch(undone());
    expect(content(store)).toEqual(grouped);
  });
});
