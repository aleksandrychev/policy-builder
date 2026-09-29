import type { DecoratorValueType } from '../blocks/decorators';
import { entryName } from '../blocks/definitionEntries';
import type { BlockDescriptor, BlockValueSource } from '../blocks/types';
import { BINDING_TARGET_PREFIX } from '../store/canvasSlice';
import type { BlockInstance, DecoratorInstance, EditableSubject } from '../store/canvasSlice/types';
import { GRID_SIZE, type Position } from './layout';

export const DATA_NODE_WIDTH = 260;
const GAP = 24; // between stacked chain nodes
const SIDE_OFFSET = 60; // between a chain node and its block

export const DATA_NODE_PREFIX = 'data:';
export const DATA_EDGE_PREFIX = 'data-link:';

// Which block/entry/parameter a chain belongs to. `entryId` uses the same
// convention as the canvas reducers: a DefinitionEntry id, or
// BINDING_TARGET_PREFIX + param name for a data-fed parameter.
export interface ChainOwner {
  entryId?: string;
  instanceId: string;
}

/**
 * A value source and its transformation steps, drawn as one node listing them,
 * with an arrow into the variable (or block parameter) they produce. Derived
 * from Define Variable entries and parameter bindings — the same data the
 * Properties panel edits — so nothing here is stored except a dragged position.
 */
export interface DataChain {
  baseType: DecoratorValueType | undefined;
  key: string;
  nodeId: string;
  owner: ChainOwner;
  position: Position;
  sampleInput: string;
  source: BlockValueSource;
  sourceParams: Record<string, string>;
  steps: DecoratorInstance[];
  targetId: string;
  targetKind: 'parameter' | 'variable';
  targetLabel: string; // variable name, or parameter label
}

// What a value source's chain starts from; undefined for structured data
// (steps can't transform it) and typed-in values (no chain at all).
export function sourceBaseType(source: BlockValueSource | undefined): DecoratorValueType | undefined {
  if (!source || source.literal) return undefined;
  return source.value_type === 'slist' || source.value_type === 'string' ? source.value_type : undefined;
}

const sourceOf = (descriptor: BlockDescriptor, valueSourceId: string | undefined) =>
  descriptor.value_sources?.find(candidate => candidate.id === valueSourceId) ?? descriptor.value_sources?.[0];

const snap = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

// Measured height of a data node, if the canvas has rendered it.
export type DataNodeHeight = (nodeId: string) => number | undefined;

interface ChainSubject {
  owner: ChainOwner;
  subject: EditableSubject;
  targetKind: DataChain['targetKind'];
  targetLabel: string;
}

// Every chain a block owns: its computed Define Variable entries, then its data-fed parameters.
function chainSubjects(instance: BlockInstance, defineVariable: BlockDescriptor, descriptor: BlockDescriptor | undefined): ChainSubject[] {
  const subjects: ChainSubject[] = [];
  if (instance.blockId === 'define-variable') {
    for (const entry of instance.entries ?? []) {
      // Values typed in directly have no flow worth drawing.
      if (sourceOf(defineVariable, entry.valueSourceId)?.literal) continue;
      const name = entryName(defineVariable, entry);
      subjects.push({ owner: { instanceId: instance.instanceId, entryId: entry.id }, subject: entry, targetKind: 'variable', targetLabel: name || '…' });
    }
  }
  for (const [param, binding] of Object.entries(instance.paramBindings ?? {})) {
    const label = descriptor?.parameters?.find(parameter => parameter.name === param)?.label ?? param;
    subjects.push({
      owner: { instanceId: instance.instanceId, entryId: `${BINDING_TARGET_PREFIX}${param}` },
      subject: binding,
      targetKind: 'parameter',
      targetLabel: label
    });
  }
  return subjects;
}

const chainKey = (fileId: string, owner: ChainOwner) => `${fileId}|data|${owner.instanceId}|${owner.entryId ?? ''}`;

// Height before the canvas has measured it: header, source, then ~40px per step.
const estimateHeight = (subject: EditableSubject) => 110 + (subject.decorators?.length ?? 0) * 44;

// A block's chain nodes stack in a column to its left, the first level with the block.
interface Slot {
  height: number;
  key: string;
  subject: ChainSubject;
  top: number; // relative to the block's top
}

function layoutColumn(subjects: ChainSubject[], fileId: string, nodeHeight: DataNodeHeight): Slot[] {
  let top = 0;
  return subjects.map(subject => {
    const key = chainKey(fileId, subject.owner);
    const height = nodeHeight(`${DATA_NODE_PREFIX}${key}`) ?? estimateHeight(subject.subject);
    const slot = { height, key, subject, top };
    top += height + GAP;
    return slot;
  });
}

/** Room a block's chains take up when placed by default (left of it, and below its top); Tidy up reserves it. */
export function dataFootprint(
  instance: BlockInstance,
  fileId: string,
  nodeHeight: DataNodeHeight,
  descriptorsById: Map<string, BlockDescriptor>
): { height: number; left: number } {
  const defineVariable = descriptorsById.get('define-variable');
  const subjects = defineVariable ? chainSubjects(instance, defineVariable, descriptorsById.get(instance.blockId)) : [];
  if (subjects.length === 0) return { height: 0, left: 0 };
  const last = layoutColumn(subjects, fileId, nodeHeight).at(-1)!;
  return { height: last.top + last.height, left: SIDE_OFFSET + DATA_NODE_WIDTH };
}

function chainFor(
  { key, subject: { owner, subject, targetKind, targetLabel }, top }: Slot,
  target: BlockInstance,
  stored: Record<string, Position>,
  defineVariable: BlockDescriptor
): DataChain | undefined {
  const source = sourceOf(defineVariable, subject.valueSourceId);
  if (!source) return undefined;
  const targetPosition = target.position ?? { x: 0, y: 0 };
  const position = { x: snap(targetPosition.x - SIDE_OFFSET - DATA_NODE_WIDTH), y: snap(targetPosition.y + top) };
  return {
    key,
    nodeId: `${DATA_NODE_PREFIX}${key}`,
    position: stored[key] ?? position,
    owner,
    source,
    sourceParams: subject.params,
    steps: subject.decorators ?? [],
    sampleInput: subject.sampleInput ?? '',
    baseType: sourceBaseType(source),
    targetId: target.instanceId,
    targetKind,
    targetLabel
  };
}

export function deriveDataChains(
  instances: BlockInstance[],
  fileId: string,
  stored: Record<string, Position>,
  nodeHeight: DataNodeHeight,
  descriptorsById: Map<string, BlockDescriptor>
): DataChain[] {
  const defineVariable = descriptorsById.get('define-variable');
  if (!defineVariable) return [];
  return instances.flatMap(instance => {
    const descriptor = descriptorsById.get(instance.blockId);
    return layoutColumn(chainSubjects(instance, defineVariable, descriptor), fileId, nodeHeight)
      .map(slot => chainFor(slot, instance, stored, defineVariable))
      .filter((chain): chain is DataChain => chain !== undefined);
  });
}
