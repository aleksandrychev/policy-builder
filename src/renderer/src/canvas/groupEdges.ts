import type { BlockDescriptor } from '../blocks/types';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge, BlockOutcome } from '../store/edgesSlice/types';
import { isSequenced } from './executionOrder';

const OUTCOMES: BlockOutcome[] = ['kept', 'repaired', 'not_kept'];

/**
 * Arrows can't cross a group's frame (a group runs as one bundle, and its
 * blocks' outcome classes aren't seen outside it): an end inside a group whose
 * other end is outside attaches to the group itself. Arrows between a group
 * and its own blocks go; ones that now share both ends merge their outcomes.
 * Returns `edges` itself when nothing changed.
 */
export function attachToFrames(edges: BlockEdge[], instances: BlockInstance[]): BlockEdge[] {
  const groupOf = new Map(instances.map(instance => [instance.instanceId, instance.groupId]));
  const result: BlockEdge[] = [];
  let changed = false;
  for (const edge of edges) {
    const sourceGroup = groupOf.get(edge.source);
    const targetGroup = groupOf.get(edge.target);
    const crosses = sourceGroup !== targetGroup;
    const source = crosses && sourceGroup ? sourceGroup : edge.source;
    const target = crosses && targetGroup ? targetGroup : edge.target;
    if (source === target || groupOf.get(source) === target || groupOf.get(target) === source) {
      changed = true;
      continue;
    }
    const same = result.find(other => other.source === source && other.target === target);
    if (same) {
      same.outcomes = OUTCOMES.filter(outcome => same.outcomes.includes(outcome) || edge.outcomes.includes(outcome));
      changed = true;
    } else {
      if (source !== edge.source || target !== edge.target) changed = true;
      result.push({ ...edge, source, target });
    }
  }
  return changed ? result : edges;
}

// Whether the arrows form a loop anywhere.
export function hasCycle(edges: BlockEdge[]): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const state = new Map<string, 'done' | 'open'>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 'open') return true;
    if (state.get(id) === 'done') return false;
    state.set(id, 'open');
    const looped = (outgoing.get(id) ?? []).some(visit);
    state.set(id, 'done');
    return looped;
  };
  return [...outgoing.keys()].some(visit);
}

// A group's blocks that take arrows, and which of them nothing inside points at / leads on from.
function endsOf(groupId: string, edges: BlockEdge[], instances: BlockInstance[], descriptorsById: Map<string, BlockDescriptor>) {
  const members = instances
    .filter(instance => instance.groupId === groupId && isSequenced(descriptorsById.get(instance.blockId)))
    .map(instance => instance.instanceId);
  const inside = new Set(members);
  const inner = edges.filter(edge => inside.has(edge.source) && inside.has(edge.target));
  return {
    entries: members.filter(id => !inner.some(edge => edge.target === id)),
    exits: members.filter(id => !inner.some(edge => edge.source === id))
  };
}

/**
 * Ungrouping keeps what the group's arrows meant: one into the group goes to
 * each of its first blocks (nothing inside points at them), one out of it
 * leaves from each of its last blocks.
 */
export function fanOut(groupId: string, edges: BlockEdge[], instances: BlockInstance[], descriptorsById: Map<string, BlockDescriptor>): BlockEdge[] {
  const { entries, exits } = endsOf(groupId, edges, instances, descriptorsById);
  return edges.flatMap(edge => {
    if (edge.target === groupId) return entries.map(target => ({ ...edge, id: crypto.randomUUID(), target }));
    if (edge.source === groupId) return exits.map(source => ({ ...edge, id: crypto.randomUUID(), source }));
    return [edge];
  });
}

/**
 * Blocks joining a group keep their arrows to and from it, as arrows to its
 * first blocks / from its last ones (`instances`: before they join).
 */
export function intoGroup(
  groupId: string,
  joiningIds: string[],
  edges: BlockEdge[],
  instances: BlockInstance[],
  descriptorsById: Map<string, BlockDescriptor>
): BlockEdge[] {
  const joining = new Set(joiningIds);
  if (!edges.some(edge => (joining.has(edge.source) && edge.target === groupId) || (edge.source === groupId && joining.has(edge.target)))) return edges;
  const { entries, exits } = endsOf(groupId, edges, instances, descriptorsById);
  return edges.flatMap(edge => {
    if (joining.has(edge.source) && edge.target === groupId) return entries.map(target => ({ ...edge, id: crypto.randomUUID(), target }));
    if (edge.source === groupId && joining.has(edge.target)) return exits.map(source => ({ ...edge, id: crypto.randomUUID(), source }));
    return [edge];
  });
}

/** For laying out (Tidy): an arrow to or from a group as arrows to its first / from its last blocks. */
export function throughGroups(edges: BlockEdge[], instances: BlockInstance[], descriptorsById: Map<string, BlockDescriptor>): BlockEdge[] {
  const groupIds = new Set(instances.flatMap(instance => (instance.groupId ? [instance.groupId] : [])));
  return [...groupIds].reduce((result, groupId) => fanOut(groupId, result, instances, descriptorsById), edges);
}
