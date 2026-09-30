import { blockDescriptorsById } from '../blocks/loadBlocks';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';
import { executionOrder, isSequenced, wouldCreateCycle } from './executionOrder';

const block = (instanceId: string, x: number, y: number, blockId = 'report-message'): BlockInstance => ({
  blockId,
  fileId: 'f1',
  instanceId,
  label: instanceId,
  params: {},
  position: { x, y }
});

const edge = (source: string, target: string): BlockEdge => ({ fileId: 'f1', id: `${source}->${target}`, outcomes: ['kept'], source, target });

const order = (instances: BlockInstance[], edges: BlockEdge[] = []) => executionOrder(instances, edges, blockDescriptorsById);

describe('isSequenced', () => {
  it('sequences own_bundle blocks only', () => {
    expect(isSequenced(blockDescriptorsById.get('install-package'))).toBe(true);
    expect(isSequenced(blockDescriptorsById.get('define-variable'))).toBe(false);
    expect(isSequenced(blockDescriptorsById.get('define-class'))).toBe(false);
    expect(isSequenced(undefined)).toBe(false);
  });
});

describe('executionOrder', () => {
  it('reads top-to-bottom, then left-to-right, when there are no arrows', () => {
    const instances = [block('c', 0, 200), block('b', 300, 0), block('a', 0, 0), block('d', 0, 100)];
    expect(order(instances)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('treats a missing position as the origin', () => {
    const noPosition = { ...block('p', 0, 0), position: undefined };
    expect(order([block('a', 0, 50), noPosition])).toEqual(['p', 'a']);
  });

  it('puts an arrow source before its target even when the source sits lower', () => {
    const instances = [block('top', 0, 0), block('bottom', 0, 500)];
    expect(order(instances, [edge('bottom', 'top')])).toEqual(['bottom', 'top']);
  });

  it('breaks ties among ready blocks by reading order', () => {
    // a → z (z is low on the canvas); b and c are free. After a, the ready set is {b, c, z}.
    const instances = [block('a', 0, 0), block('z', 0, 900), block('c', 0, 300), block('b', 0, 200)];
    expect(order(instances, [edge('a', 'z')])).toEqual(['a', 'b', 'c', 'z']);
  });

  it('inserts a newly ready block at its reading-order place', () => {
    // late (y=150) becomes ready after first, and should run before mid2 (y=200).
    const instances = [block('first', 0, 0), block('mid2', 0, 200), block('late', 0, 150), block('gate', 0, 100)];
    expect(order(instances, [edge('gate', 'late')])).toEqual(['first', 'gate', 'late', 'mid2']);
  });

  it('waits for every incoming arrow', () => {
    const instances = [block('target', 0, 0), block('s1', 0, 100), block('s2', 0, 200)];
    expect(order(instances, [edge('s1', 'target'), edge('s2', 'target')])).toEqual(['s1', 's2', 'target']);
  });

  it('leaves out Define Variable / Define Class blocks', () => {
    const instances = [block('var', 0, 0, 'define-variable'), block('cls', 0, 10, 'define-class'), block('run', 0, 20)];
    expect(order(instances)).toEqual(['run']);
  });

  it('ignores arrows touching blocks that are not sequenced or not present', () => {
    const instances = [block('a', 0, 0), block('b', 0, 100), block('var', 0, 50, 'define-variable')];
    expect(order(instances, [edge('var', 'a'), edge('ghost', 'a'), edge('b', 'nowhere')])).toEqual(['a', 'b']);
  });

  it('appends blocks caught in a cycle in reading order', () => {
    const instances = [block('free', 0, 500), block('x', 0, 300), block('y', 0, 100)];
    expect(order(instances, [edge('x', 'y'), edge('y', 'x')])).toEqual(['free', 'y', 'x']);
  });
});

describe('wouldCreateCycle', () => {
  const edges = [edge('a', 'b'), edge('b', 'c')];

  it('refuses a self-loop', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });

  it('refuses an arrow that closes a loop, directly or transitively', () => {
    expect(wouldCreateCycle(edges, 'b', 'a')).toBe(true);
    expect(wouldCreateCycle(edges, 'c', 'a')).toBe(true);
  });

  it('allows arrows that keep the graph acyclic', () => {
    expect(wouldCreateCycle(edges, 'a', 'c')).toBe(false);
    expect(wouldCreateCycle(edges, 'c', 'd')).toBe(false);
    expect(wouldCreateCycle(edges, 'd', 'a')).toBe(false);
  });

  it('terminates on a graph that already has a cycle', () => {
    expect(wouldCreateCycle([edge('x', 'y'), edge('y', 'x')], 'a', 'x')).toBe(false);
  });
});
