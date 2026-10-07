import { blockDescriptorsById } from '../blocks/loadBlocks';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { ProjectData } from './cfbsProject';

export interface ProjectChange {
  // For a changed block: which parts, e.g. "params, condition".
  detail?: string;
  kind: 'added' | 'changed' | 'removed';
  // "Harden SSH (Set Config Values)", "File security.cf", "2 arrows".
  what: string;
}

// The parts of a block a user edits (not where it sits on the canvas).
const PARTS: [keyof BlockInstance, string][] = [
  ['label', 'label'],
  ['params', 'params'],
  ['entries', 'values'],
  ['valueSourceId', 'value source'],
  ['decorators', 'transforms'],
  ['paramBindings', 'data inputs'],
  ['condition', 'condition'],
  ['incomingMode', 'arrows mode'],
  ['groupId', 'group']
];

// Key order doesn't matter: the saved file and the store list an object's fields differently.
const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, stable(item)])
        )
      : value;
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));
const blockName = (block: BlockInstance) => `${block.label} (${blockDescriptorsById.get(block.blockId)?.name ?? block.blockId})`;

function byId<T>(items: T[], id: (item: T) => string) {
  return new Map(items.map(item => [id(item), item]));
}

function fileChanges(old: ProjectData, now: ProjectData): ProjectChange[] {
  const changes: ProjectChange[] = [];
  const before = byId(old.files.files, file => file.id);
  for (const file of now.files.files) {
    const previous = before.get(file.id);
    if (!previous) changes.push({ kind: 'added', what: `File ${file.name}.cf` });
    else if (previous.name !== file.name) changes.push({ kind: 'changed', what: `File ${previous.name}.cf`, detail: `renamed to ${file.name}.cf` });
    else if (!same(previous.condition, file.condition)) changes.push({ kind: 'changed', what: `File ${file.name}.cf`, detail: 'condition' });
  }
  const after = byId(now.files.files, file => file.id);
  return [...changes, ...old.files.files.filter(file => !after.has(file.id)).map(file => ({ kind: 'removed' as const, what: `File ${file.name}.cf` }))];
}

function blockChanges(old: ProjectData, now: ProjectData): ProjectChange[] {
  const changes: ProjectChange[] = [];
  const before = byId(old.canvas, block => block.instanceId);
  for (const block of now.canvas) {
    const previous = before.get(block.instanceId);
    if (!previous) {
      changes.push({ kind: 'added', what: blockName(block) });
      continue;
    }
    const parts = PARTS.filter(([key]) => !same(previous[key], block[key])).map(([, label]) => label);
    if (parts.length) changes.push({ kind: 'changed', what: blockName(previous), detail: parts.join(', ') });
  }
  const after = byId(now.canvas, block => block.instanceId);
  return [...changes, ...old.canvas.filter(block => !after.has(block.instanceId)).map(block => ({ kind: 'removed' as const, what: blockName(block) }))];
}

function groupChanges(old: ProjectData, now: ProjectData): ProjectChange[] {
  const before = byId(old.groups, group => group.id);
  const after = byId(now.groups, group => group.id);
  // Its frame's size and colour aren't policy.
  const policyOf = (group: ProjectData['groups'][number]) => ({ ...group, rect: null, color: null });
  return [
    ...now.groups.filter(group => !before.has(group.id)).map(group => ({ kind: 'added' as const, what: `Group ${group.name}` })),
    ...now.groups
      .filter(group => before.has(group.id) && !same(policyOf(before.get(group.id)!), policyOf(group)))
      .map(group => ({ kind: 'changed' as const, what: `Group ${before.get(group.id)!.name}` })),
    ...old.groups.filter(group => !after.has(group.id)).map(group => ({ kind: 'removed' as const, what: `Group ${group.name}` }))
  ];
}

function edgeChanges(old: ProjectData, now: ProjectData): ProjectChange[] {
  const before = byId(old.edges, edge => edge.id);
  const after = byId(now.edges, edge => edge.id);
  const count = (n: number) => `${n} ${n === 1 ? 'arrow' : 'arrows'}`;
  const added = now.edges.filter(edge => !before.has(edge.id)).length;
  const changed = now.edges.filter(edge => before.has(edge.id) && !same(before.get(edge.id), edge)).length;
  const removed = old.edges.filter(edge => !after.has(edge.id)).length;
  return [
    ...(added ? [{ kind: 'added' as const, what: count(added) }] : []),
    ...(changed ? [{ kind: 'changed' as const, what: count(changed), detail: 'outcomes' }] : []),
    ...(removed ? [{ kind: 'removed' as const, what: count(removed) }] : [])
  ];
}

/** What changed from `before` (the last commit) to `after`, in the builder's own terms. */
export function projectChanges(before: ProjectData | null, after: ProjectData): ProjectChange[] {
  const old = before ?? ({ canvas: [], edges: [], groups: [], files: { files: [] } } as unknown as ProjectData);
  return [...fileChanges(old, after), ...blockChanges(old, after), ...groupChanges(old, after), ...edgeChanges(old, after)];
}

/** A commit message from the changes: "Added Harden SSH, changed Nginx settings, …". */
export function commitMessage(changes: ProjectChange[]): string {
  if (changes.length === 0) return '';
  const verb = { added: 'Added', changed: 'Changed', removed: 'Removed' };
  const label = (change: ProjectChange) => change.what.replace(/ \([^)]*\)$/, '');
  const groups = (['added', 'changed', 'removed'] as const)
    .map(kind => ({ kind, items: changes.filter(change => change.kind === kind).map(label) }))
    .filter(group => group.items.length);
  const title = groups
    .map(
      (group, index) =>
        `${index === 0 ? verb[group.kind] : verb[group.kind].toLowerCase()} ${group.items.slice(0, 3).join(', ')}${group.items.length > 3 ? ' …' : ''}`
    )
    .join('; ');
  const body = changes.map(change => `- ${verb[change.kind]} ${change.what}${change.detail ? `: ${change.detail}` : ''}`).join('\n');
  return `${title.length > 80 ? `${title.slice(0, 77)}…` : title}\n\n${body}`;
}
