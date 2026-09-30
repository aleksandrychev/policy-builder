import type { BlockGroup } from '../store/groupsSlice/types';
import { GROUP_NODE_PREFIX, GROUP_TITLE_HEIGHT, type Rect, boundingRect, deriveGroupFrames, frameAt, settleGroup } from './groupFrames';

const group = (id: string, rect?: Rect): BlockGroup => ({ id, name: id, color: 'primary', fileId: 'f1', rect });
const rect = (x: number, y: number, width = 100, height = 100): Rect => ({ x, y, width, height });

describe('boundingRect', () => {
  it('is undefined for nothing', () => {
    expect(boundingRect([])).toBeUndefined();
  });

  it('encloses every rect', () => {
    expect(boundingRect([rect(0, 0, 10, 10), rect(50, -20, 10, 100)])).toEqual({ x: 0, y: -20, width: 60, height: 100 });
  });
});

describe('deriveGroupFrames', () => {
  const rects: Record<string, Rect> = { a: rect(0, 0), b: rect(200, 300), c: rect(1000, 1000) };
  const footprintOf = (ids: string[]) => ids.map(id => rects[id]);
  const members: Record<string, string[]> = { g: ['a', 'b'], empty: [] };
  const membersOf = (id: string) => members[id] ?? [];
  const frames = (groups: BlockGroup[], dragging: string[] = []) => deriveGroupFrames(groups, membersOf, footprintOf, new Set(dragging));

  it('hugs its members with padding and room for the title', () => {
    const [frame] = frames([group('g')]);
    expect(frame.nodeId).toBe(`${GROUP_NODE_PREFIX}g`);
    expect(frame.memberIds).toEqual(['a', 'b']);
    const padding = -frame.rect.x;
    expect(padding).toBeGreaterThan(0);
    expect(frame.rect.y).toBe(-padding - GROUP_TITLE_HEIGHT);
    expect(frame.rect.x + frame.rect.width).toBe(300 + padding);
    expect(frame.rect.y + frame.rect.height).toBe(400 + padding);
  });

  it('skips a group with no members', () => {
    expect(frames([group('empty')])).toEqual([]);
  });

  it('grows to a dragged-out size but never cuts a member', () => {
    const [fit] = frames([group('g')]);
    const [bigger] = frames([group('g', rect(-500, -500, 100, 100))]);
    expect(bigger.rect).toEqual(boundingRect([fit.rect, rect(-500, -500, 100, 100)]));
    const [smaller] = frames([group('g', rect(0, 0, 1, 1))]);
    expect(smaller.rect).toEqual(fit.rect);
  });

  it('holds still while some members are dragged', () => {
    const [frame] = frames([group('g')], ['b']);
    const [aloneA] = deriveGroupFrames([group('g')], () => ['a'], footprintOf, new Set());
    expect(frame.rect).toEqual(aloneA.rect);
    expect(frame.memberIds).toEqual(['a', 'b']);
  });

  it('follows its members when all of them are dragged', () => {
    expect(frames([group('g')], ['a', 'b'])[0].rect).toEqual(frames([group('g')])[0].rect);
  });

  it('orders big frames first so smaller ones draw on top', () => {
    const withSmall = (id: string) => (id === 'small' ? ['c'] : membersOf(id));
    const result = deriveGroupFrames([group('small'), group('g')], withSmall, footprintOf, new Set());
    expect(result.map(frame => frame.group.id)).toEqual(['g', 'small']);
  });
});

describe('frameAt', () => {
  const frame = (id: string, r: Rect) => ({ group: group(id), memberIds: [], nodeId: id, rect: r });
  const big = frame('big', rect(0, 0, 1000, 1000));
  const small = frame('small', rect(100, 100, 100, 100));

  it('finds the smallest frame containing the point', () => {
    expect(frameAt([big, small], { x: 150, y: 150 })?.group.id).toBe('small');
    expect(frameAt([small, big], { x: 150, y: 150 })?.group.id).toBe('small');
    expect(frameAt([big, small], { x: 500, y: 500 })?.group.id).toBe('big');
  });

  it('includes edges and misses outside points', () => {
    expect(frameAt([small], { x: 200, y: 200 })?.group.id).toBe('small');
    expect(frameAt([big, small], { x: -1, y: 0 })).toBeUndefined();
  });
});

describe('settleGroup', () => {
  const card = (id: string, x: number, y: number, width = 200, height = 100) => ({ id, x, y, width, height });

  it('lines a dropped card up with the member it landed on and moves it below', () => {
    const moved = settleGroup([card('member', 0, 0), card('dropped', 50, 40)], ['dropped'], 40, 20);
    expect(moved).toEqual({ dropped: { x: 0, y: 140 } });
  });

  it('pushes overlapped cards down in a cascade, below the dropped card', () => {
    const cards = [card('dropped', 0, 0), card('m1', 0, 0), card('m2', 0, 120)];
    const moved = settleGroup(cards, ['dropped'], 40, 20);
    expect(moved.dropped).toBeUndefined();
    expect(moved.m1).toEqual({ x: 0, y: 140 });
    expect(moved.m2).toEqual({ x: 0, y: 280 });
  });

  it('snaps pushed cards down to the grid', () => {
    const moved = settleGroup([card('a', 0, 0, 200, 105), card('b', 0, 50)], [], 40, 20);
    expect(moved.b).toEqual({ x: 0, y: 160 });
  });

  it('leaves cards that do not overlap where they are', () => {
    const cards = [card('a', 0, 0), card('b', 400, 0), card('c', 0, 500), card('dropped', 1000, 1000)];
    expect(settleGroup(cards, ['dropped'], 40, 20)).toEqual({});
  });

  it('moves a card closer than the gap down to respect it', () => {
    const moved = settleGroup([card('a', 0, 0), card('b', 0, 120)], [], 40, 20);
    expect(moved.b).toEqual({ x: 0, y: 140 });
  });
});
