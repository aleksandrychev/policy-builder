import type { BlockInstance, Condition } from '../store/canvasSlice/types';
import { GRID_SIZE, type Position } from './layout';

export const GATE_WIDTH = 260;
const GATE_GAP = 80;
// Horizontal room a gate takes left of its block.
export const GATE_SPACE = GATE_WIDTH + GATE_GAP;
// How far a gate rises above its block when the block's data chains take the spot beside it.
export const GATE_LIFT = 120;

// A condition gate on the canvas: one pill per distinct condition in the
// file, linked (dashed) to every block carrying it. Derived from blocks'
// `condition` fields — which stay the source of truth, and what compiles —
// so the canvas and the Properties panel can never disagree.
export interface Gate {
  condition: Condition;
  instanceIds: string[];
  key: string;
  nodeId: string;
  position: Position;
}

export const GATE_NODE_PREFIX = 'gate:';
export const GATE_EDGE_PREFIX = 'gate-link:';

// Blocks with the same mode + class share a gate; a condition whose class
// isn't chosen yet gets its own, since there's nothing to share.
export function gateKey(fileId: string, instanceId: string, condition: Condition): string {
  return condition.className ? `${fileId}|${condition.mode}|${condition.className}` : `${fileId}|pending|${instanceId}`;
}

const snap = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

export function deriveGates(
  instances: BlockInstance[],
  fileId: string,
  storedPositions: Record<string, Position>,
  hasChains: (instance: BlockInstance) => boolean = () => false
): Gate[] {
  const byKey = new Map<string, { condition: Condition; instances: BlockInstance[] }>();
  for (const instance of instances) {
    if (!instance.condition) continue;
    const key = gateKey(fileId, instance.instanceId, instance.condition);
    const group = byKey.get(key);
    if (group) group.instances.push(instance);
    else byKey.set(key, { condition: instance.condition, instances: [instance] });
  }
  return [...byKey.entries()].map(([key, group]) => {
    // Unless dragged somewhere, a gate sits left of the highest block it gates
    // (above-left, if that block's data chains are beside it).
    const top = [...group.instances].sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))[0];
    const left = Math.min(...group.instances.map(instance => instance.position?.x ?? 0));
    const y = (top.position?.y ?? 0) - (hasChains(top) ? GATE_LIFT : 0);
    return {
      key,
      nodeId: `${GATE_NODE_PREFIX}${key}`,
      condition: group.condition,
      instanceIds: group.instances.map(instance => instance.instanceId),
      position: storedPositions[key] ?? { x: snap(left - GATE_WIDTH - GATE_GAP), y: snap(y) }
    };
  });
}
