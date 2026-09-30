import type { BlockDescriptor } from '../blocks/types';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';

// Only own_bundle blocks have an outcome to branch on and a place in the
// sequence; file_vars ones compile into the file's shared `vars` bundle.
export function isSequenced(descriptor: BlockDescriptor | undefined): boolean {
  return descriptor?.compile_target === 'own_bundle';
}

function readingOrder(a: BlockInstance, b: BlockInstance): number {
  const ay = a.position?.y ?? 0;
  const by = b.position?.y ?? 0;
  if (ay !== by) return ay - by;
  return (a.position?.x ?? 0) - (b.position?.x ?? 0);
}

/**
 * The methods: call order for one file's canvas: every arrow's source comes
 * before its target (Kahn's topological sort), and whenever several blocks
 * are free to go next, the one highest on the canvas wins, then the
 * leftmost. With no arrows at all this is plain top-to-bottom reading order,
 * which is how a vertical stack of blocks always behaved. Derived, never
 * stored, so it can't drift from what the canvas shows.
 */
export function executionOrder(instances: BlockInstance[], edges: BlockEdge[], descriptorsById: Map<string, BlockDescriptor>): string[] {
  const nodes = instances.filter(instance => isSequenced(descriptorsById.get(instance.blockId)));
  const ids = new Set(nodes.map(node => node.instanceId));
  const indegree = new Map(nodes.map(node => [node.instanceId, 0]));
  const relevant = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  for (const edge of relevant) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);

  const byId = new Map(nodes.map(node => [node.instanceId, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of relevant) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  // Kept sorted by reading order, so the next block is always at the front.
  const ready = nodes.filter(node => indegree.get(node.instanceId) === 0).sort(readingOrder);
  const insertReady = (node: BlockInstance) => {
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
    order.push(next.instanceId);
    for (const target of outgoing.get(next.instanceId) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) insertReady(byId.get(target)!);
    }
  }
  // Cycles are refused when drawn; this only guards against one slipping in.
  const placed = new Set(order);
  const leftovers = nodes.filter(node => !placed.has(node.instanceId)).sort(readingOrder);
  return [...order, ...leftovers.map(node => node.instanceId)];
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
