import { blockDescriptorsById } from '../blocks/loadBlocks';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';
import { executionOrder } from './executionOrder';
import { GRID_SIZE, NODE_WIDTH, type Position, estimateNodeHeight, nextStackPosition, tidyLayout } from './layout';

const block = (instanceId: string, x: number, y: number, overrides: Partial<BlockInstance> = {}): BlockInstance => ({
  blockId: 'report-message',
  fileId: 'f1',
  instanceId,
  label: instanceId,
  params: {},
  position: { x, y },
  ...overrides
});

const edge = (source: string, target: string): BlockEdge => ({ fileId: 'f1', id: `${source}->${target}`, outcomes: ['kept'], source, target });

const HEIGHT = 120;
const sizeOf = () => ({ width: NODE_WIDTH, height: HEIGHT });
const noFootprint = () => ({ above: 0, height: 0, left: 0 });

function tidy(instances: BlockInstance[], edges: BlockEdge[] = [], groupOf?: (instance: BlockInstance) => string | undefined) {
  const order = executionOrder(instances, edges, blockDescriptorsById);
  return tidyLayout(instances, edges, order, sizeOf, noFootprint, blockDescriptorsById, groupOf);
}

const overlap = (a: Position, b: Position) => a.x < b.x + NODE_WIDTH && b.x < a.x + NODE_WIDTH && a.y < b.y + HEIGHT && b.y < a.y + HEIGHT;

function expectNoOverlaps(positions: Record<string, Position>) {
  const entries = Object.entries(positions);
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) expect(overlap(entries[i][1], entries[j][1]), `${entries[i][0]} overlaps ${entries[j][0]}`).toBe(false);
}

describe('tidyLayout', () => {
  it('places every block, on the grid', () => {
    const instances = [block('a', 0, 0), block('b', 500, 0), block('v', 0, 0, { blockId: 'define-variable' })];
    const positions = tidy(instances);
    expect(Object.keys(positions).sort()).toEqual(['a', 'b', 'v']);
    for (const { x, y } of Object.values(positions)) {
      expect(Math.abs(x % GRID_SIZE)).toBe(0);
      expect(Math.abs(y % GRID_SIZE)).toBe(0);
    }
  });

  it('keeps unconnected blocks a vertical sequence in execution order', () => {
    const positions = tidy([block('a', 0, 0), block('b', 900, 10), block('c', 300, 20)]);
    expect(positions.a.y).toBeLessThan(positions.b.y);
    expect(positions.b.y).toBeLessThan(positions.c.y);
    expectNoOverlaps(positions);
  });

  it('points every arrow downward and never overlaps cards', () => {
    const instances = ['a', 'b', 'c', 'd', 'e'].map((id, index) => block(id, index * 50, 500 - index * 100));
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd'), edge('d', 'e')];
    const positions = tidy(instances, edges);
    for (const { source, target } of edges) expect(positions[source].y).toBeLessThan(positions[target].y);
    expectNoOverlaps(positions);
  });

  it('puts Define blocks in a column of their own to the left', () => {
    const instances = [
      block('a', 0, 0),
      block('b', 0, 200),
      block('v1', 0, 300, { blockId: 'define-variable' }),
      block('v2', 0, 100, { blockId: 'define-class' })
    ];
    const positions = tidy(instances);
    expect(positions.v1.x).toBe(positions.v2.x);
    expect(positions.v1.x + NODE_WIDTH).toBeLessThan(Math.min(positions.a.x, positions.b.x));
    // Stacked in their canvas order.
    expect(positions.v2.y).toBeLessThan(positions.v1.y);
    expectNoOverlaps(positions);
  });

  it('keeps a group’s blocks together', () => {
    // Execution order interleaves the groups: a1, b1, a2, b2.
    const instances = [block('a1', 0, 0), block('b1', 0, 100), block('a2', 0, 200), block('b2', 0, 300)];
    const groupOf = (instance: BlockInstance) => (instance.instanceId.startsWith('a') ? 'A' : 'B');
    const positions = tidy(instances, [], groupOf);
    const box = (ids: string[]) => ({
      left: Math.min(...ids.map(id => positions[id].x)),
      right: Math.max(...ids.map(id => positions[id].x + NODE_WIDTH)),
      top: Math.min(...ids.map(id => positions[id].y)),
      bottom: Math.max(...ids.map(id => positions[id].y + HEIGHT))
    });
    const a = box(['a1', 'a2']);
    const b = box(['b1', 'b2']);
    const disjoint = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
    expect(disjoint).toBe(true);
    expectNoOverlaps(positions);
  });

  it('leaves room for a block’s gate and chains to its left', () => {
    const instances = [block('a', 0, 0), block('b', 0, 200)];
    const order = executionOrder(instances, [], blockDescriptorsById);
    const roomy = tidyLayout(instances, [], order, sizeOf, () => ({ above: 0, height: 0, left: 400 }), blockDescriptorsById);
    const plain = tidyLayout(instances, [], order, sizeOf, noFootprint, blockDescriptorsById);
    expect(roomy.a.x - plain.a.x).toBe(400);
  });
});

describe('nextStackPosition', () => {
  it('starts at the origin on an empty canvas', () => {
    expect(nextStackPosition([], sizeOf)).toEqual({ x: 0, y: 0 });
  });

  it('goes under the lowest block, in the leftmost column, on the grid', () => {
    const position = nextStackPosition([block('a', 200, 0), block('b', 43, 300), block('c', 500, 100)], sizeOf);
    expect(position.x).toBe(40);
    expect(position.y).toBeGreaterThan(300 + HEIGHT);
    expect(position.y % GRID_SIZE).toBe(0);
  });

  it('uses each block’s own height to find the bottom', () => {
    const tall = (instance: BlockInstance) => ({ width: NODE_WIDTH, height: instance.instanceId === 'tall' ? 1000 : 50 });
    expect(nextStackPosition([block('tall', 0, 0), block('low', 0, 400)], tall).y).toBeGreaterThan(1000);
  });
});

describe('estimateNodeHeight', () => {
  const descriptor = blockDescriptorsById.get('install-package');

  it('grows with the rows a card shows', () => {
    const empty = estimateNodeHeight(block('a', 0, 0, { blockId: 'install-package' }), descriptor);
    const filled = estimateNodeHeight(block('a', 0, 0, { blockId: 'install-package', params: { package_name: 'nginx' } }), descriptor);
    expect(empty).toBeGreaterThan(0);
    expect(filled).toBeGreaterThan(empty);
  });

  it('adds a line when an entry has its own condition', () => {
    const dv = blockDescriptorsById.get('define-variable');
    const entry = { id: 'e', valueSourceId: 'literal', params: { variable_name: 'x', value: '1' } };
    const plain = estimateNodeHeight(block('v', 0, 0, { blockId: 'define-variable', entries: [entry] }), dv);
    const conditioned = estimateNodeHeight(
      block('v', 0, 0, { blockId: 'define-variable', entries: [{ ...entry, condition: { kind: 'class', mode: 'if', className: 'linux' } }] }),
      dv
    );
    expect(conditioned).toBeGreaterThan(plain);
  });

  it('has a header-only height for an unknown block', () => {
    expect(estimateNodeHeight(block('a', 0, 0, { blockId: 'nope' }), undefined)).toBeGreaterThan(0);
  });
});
