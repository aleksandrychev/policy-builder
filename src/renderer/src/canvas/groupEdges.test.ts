import { blockDescriptorsById } from '../blocks/loadBlocks';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge, BlockOutcome } from '../store/edgesSlice/types';
import { attachToFrames, fanOut, hasCycle, intoGroup, throughGroups } from './groupEdges';

const block = (instanceId: string, groupId?: string, blockId = 'report-message'): BlockInstance => ({
  blockId,
  fileId: 'f1',
  instanceId,
  label: instanceId,
  params: {},
  ...(groupId ? { groupId } : {})
});

const edge = (source: string, target: string, outcomes: BlockOutcome[] = ['kept']): BlockEdge => ({
  fileId: 'f1',
  id: `${source}->${target}`,
  outcomes,
  source,
  target
});

const ends = (edges: BlockEdge[]) => edges.map(({ source, target }) => `${source}->${target}`);

describe('attachToFrames', () => {
  it('returns the same array when no arrow crosses a frame', () => {
    const edges = [edge('a', 'b'), edge('b', 'c')];
    expect(attachToFrames(edges, [block('a', 'g'), block('b', 'g'), block('c', 'g')])).toBe(edges);
    expect(attachToFrames(edges, [block('a'), block('b'), block('c')])).toBe(edges);
  });

  it('attaches an end inside a group to the group when the other end is outside', () => {
    const instances = [block('in', 'g'), block('out')];
    expect(ends(attachToFrames([edge('in', 'out')], instances))).toEqual(['g->out']);
    expect(ends(attachToFrames([edge('out', 'in')], instances))).toEqual(['out->g']);
  });

  it('connects two groups’ frames when an arrow runs between their blocks', () => {
    expect(ends(attachToFrames([edge('a', 'b')], [block('a', 'g1'), block('b', 'g2')]))).toEqual(['g1->g2']);
  });

  it('drops arrows between a group and its own blocks', () => {
    expect(attachToFrames([edge('g', 'a'), edge('a', 'g')], [block('a', 'g')])).toEqual([]);
  });

  it('merges arrows that now share both ends, keeping every outcome in order', () => {
    const instances = [block('a', 'g'), block('b', 'g'), block('out')];
    const result = attachToFrames([edge('a', 'out', ['not_kept']), edge('b', 'out', ['kept'])], instances);
    expect(result).toEqual([{ ...edge('a', 'out'), source: 'g', outcomes: ['kept', 'not_kept'] }]);
  });

  it('leaves the input arrows untouched', () => {
    const edges = [edge('a', 'out', ['not_kept']), edge('b', 'out', ['kept'])];
    attachToFrames(edges, [block('a', 'g'), block('b', 'g'), block('out')]);
    expect(edges.map(item => item.outcomes)).toEqual([['not_kept'], ['kept']]);
  });
});

describe('hasCycle', () => {
  it('finds no loop in a chain, a fork or a join', () => {
    expect(hasCycle([])).toBe(false);
    expect(hasCycle([edge('a', 'b'), edge('b', 'c')])).toBe(false);
    expect(hasCycle([edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')])).toBe(false);
  });

  it('finds a loop of any length, including an arrow to itself', () => {
    expect(hasCycle([edge('a', 'a')])).toBe(true);
    expect(hasCycle([edge('a', 'b'), edge('b', 'a')])).toBe(true);
    expect(hasCycle([edge('x', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'a')])).toBe(true);
  });
});

describe('fanOut', () => {
  // first -> last inside g, plus a variable block (takes no arrows).
  const instances = [block('first', 'g'), block('last', 'g'), block('vars', 'g', 'define-variable'), block('out')];
  const inner = edge('first', 'last');

  it('sends an arrow into the group to each of its first blocks, and one out of it from each last block', () => {
    const result = fanOut('g', [inner, edge('out', 'g', ['repaired']), edge('g', 'out')], instances, blockDescriptorsById);
    expect(ends(result)).toEqual(['first->last', 'out->first', 'last->out']);
    expect(result[1].outcomes).toEqual(['repaired']);
  });

  it('fans out to every block when nothing inside is connected', () => {
    const result = fanOut('g', [edge('out', 'g')], [block('a', 'g'), block('b', 'g'), block('out')], blockDescriptorsById);
    expect(ends(result)).toEqual(['out->a', 'out->b']);
  });

  it('gives each new arrow an id of its own', () => {
    const result = fanOut('g', [edge('out', 'g')], [block('a', 'g'), block('b', 'g'), block('out')], blockDescriptorsById);
    expect(new Set(result.map(item => item.id)).size).toBe(2);
    expect(result.map(item => item.id)).not.toContain('out->g');
  });

  it('leaves other arrows as they are', () => {
    const other = edge('out', 'elsewhere');
    expect(fanOut('g', [other], instances, blockDescriptorsById)).toEqual([other]);
  });
});

describe('intoGroup', () => {
  // `instances` are before `x` joins g.
  const instances = [block('first', 'g'), block('last', 'g'), block('x')];
  const inner = edge('first', 'last');

  it('returns the same array when the joining blocks have no arrow to or from the group', () => {
    const edges = [inner, edge('x', 'elsewhere')];
    expect(intoGroup('g', ['x'], edges, instances, blockDescriptorsById)).toBe(edges);
  });

  it('turns a joining block’s arrow into the group into arrows to its first blocks', () => {
    expect(ends(intoGroup('g', ['x'], [inner, edge('x', 'g')], instances, blockDescriptorsById))).toEqual(['first->last', 'x->first']);
  });

  it('turns the group’s arrow to a joining block into arrows from its last blocks', () => {
    expect(ends(intoGroup('g', ['x'], [inner, edge('g', 'x')], instances, blockDescriptorsById))).toEqual(['first->last', 'last->x']);
  });

  it('keeps arrows to the group from blocks that aren’t joining', () => {
    const instancesWithY = [...instances, block('y')];
    expect(ends(intoGroup('g', ['x'], [inner, edge('x', 'g'), edge('y', 'g')], instancesWithY, blockDescriptorsById))).toEqual([
      'first->last',
      'x->first',
      'y->g'
    ]);
  });
});

describe('throughGroups', () => {
  it('routes arrows between groups through their blocks, for layout', () => {
    const instances = [block('a1', 'g1'), block('a2', 'g1'), block('b1', 'g2'), block('b2', 'g2')];
    const edges = [edge('a1', 'a2'), edge('b1', 'b2'), edge('g1', 'g2')];
    expect(ends(throughGroups(edges, instances, blockDescriptorsById))).toEqual(['a1->a2', 'b1->b2', 'a2->b1']);
  });

  it('returns arrows unchanged without groups', () => {
    const edges = [edge('a', 'b')];
    expect(throughGroups(edges, [block('a'), block('b')], blockDescriptorsById)).toEqual(edges);
  });
});
