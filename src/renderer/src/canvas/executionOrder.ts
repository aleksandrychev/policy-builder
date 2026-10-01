import type { BlockDescriptor } from '../blocks/types';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';

// Only own_bundle blocks have an outcome to branch on and a place in the
// sequence; file_vars ones compile into the file's shared `vars` bundle.
export function isSequenced(descriptor: BlockDescriptor | undefined): boolean {
  return descriptor?.compile_target === 'own_bundle';
}

type Positioned = { id: string; position?: { x: number; y: number } };

function readingOrder(a: Positioned, b: Positioned): number {
  const ay = a.position?.y ?? 0;
  const by = b.position?.y ?? 0;
  if (ay !== by) return ay - by;
  return (a.position?.x ?? 0) - (b.position?.x ?? 0);
}

// Kahn's topological sort over `nodes`, using only the arrows between them;
// whenever several are free to go next, the one highest on the canvas wins, then the leftmost.
function sortByArrows(nodes: Positioned[], edges: BlockEdge[]): string[] {
  const ids = new Set(nodes.map(node => node.id));
  const indegree = new Map(nodes.map(node => [node.id, 0]));
  const relevant = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  for (const edge of relevant) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);

  const byId = new Map(nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of relevant) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  // Kept sorted by reading order, so the next node is always at the front.
  const ready = nodes.filter(node => indegree.get(node.id) === 0).sort(readingOrder);
  const insertReady = (node: Positioned) => {
    let low = 0;
    let high = ready.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (readingOrder(ready[middle], node) <= 0) low = middle + 1;
      else high = middle;
    }
    ready.splice(low, 0, node);
  };
  const order: string[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    order.push(next.id);
    for (const target of outgoing.get(next.id) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) insertReady(byId.get(target)!);
    }
  }
  // Cycles are refused when drawn; this only guards against one slipping in.
  const placed = new Set(order);
  return [
    ...order,
    ...nodes
      .filter(node => !placed.has(node.id))
      .sort(readingOrder)
      .map(node => node.id)
  ];
}

/**
 * The call order for one file's canvas: every arrow's source comes before its
 * target, and whenever several blocks are free to go next, the one highest on
 * the canvas wins, then the leftmost. A group runs as one step (its own
 * bundle), placed by its top-left block, with its members sorted the same way
 * among themselves. Derived, never stored, so it can't drift from the canvas.
 */
export function executionOrder(instances: BlockInstance[], edges: BlockEdge[], descriptorsById: Map<string, BlockDescriptor>): string[] {
  const sequenced = instances.filter(instance => isSequenced(descriptorsById.get(instance.blockId)));
  const members = new Map<string, Positioned[]>();
  const outer: Positioned[] = [];
  for (const instance of sequenced) {
    const node = { id: instance.instanceId, position: instance.position };
    if (instance.groupId) members.set(instance.groupId, [...(members.get(instance.groupId) ?? []), node]);
    else outer.push(node);
  }
  for (const [groupId, nodes] of members) {
    const xs = nodes.map(node => node.position?.x ?? 0);
    const ys = nodes.map(node => node.position?.y ?? 0);
    outer.push({ id: groupId, position: { x: Math.min(...xs), y: Math.min(...ys) } });
  }
  return sortByArrows(outer, edges).flatMap(id => {
    const group = members.get(id);
    return group ? sortByArrows(group, edges) : [id];
  });
}

// Whether adding source → target would close a loop, i.e. target already
// (transitively) leads back to source.
export function wouldCreateCycle(edges: BlockEdge[], source: string, target: string): boolean {
  if (source === target) return true;
  const stack = [target];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) if (edge.source === current) stack.push(edge.target);
  }
  return false;
}
