import { blockDescriptorsById } from '../blocks/loadBlocks';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';
import type { BlockGroup } from '../store/groupsSlice/types';
import { dataFootprint } from './dataChains';
import { executionOrder } from './executionOrder';
import { GATE_LIFT, GATE_SPACE } from './gates';
import { throughGroups } from './groupEdges';
import { type Position, tidyLayout } from './layout';

/**
 * "Tidy up" for one file's canvas: its blocks' new positions, with room for
 * each block's gate and data chains. `sizeOf` / `nodeHeight` are the measured
 * sizes on the canvas, or estimates where nothing is rendered yet (the demo).
 */
export function tidyPositions(
  instances: BlockInstance[],
  edges: BlockEdge[],
  groups: BlockGroup[],
  fileId: string | null,
  sizeOf: (instance: BlockInstance) => { height: number; width: number },
  nodeHeight: (nodeId: string) => number | undefined
): Record<string, Position> {
  const order = executionOrder(instances, edges, blockDescriptorsById);
  const footprintOf = (instance: BlockInstance) => {
    const chains = fileId ? dataFootprint(instance, fileId, nodeHeight, blockDescriptorsById) : { height: 0, left: 0 };
    // With chains beside the block, its gate rises above them (see deriveGates).
    const lifted = Boolean(instance.condition) && chains.left > 0;
    return { above: lifted ? GATE_LIFT : 0, height: chains.height, left: Math.max(chains.left, instance.condition ? GATE_SPACE : 0) };
  };
  const groupOf = (instance: BlockInstance) => (groups.some(group => group.id === instance.groupId) ? instance.groupId : undefined);
  return tidyLayout(instances, throughGroups(edges, instances, blockDescriptorsById), order, sizeOf, footprintOf, blockDescriptorsById, groupOf);
}
