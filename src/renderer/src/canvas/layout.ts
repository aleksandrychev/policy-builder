import dagre from '@dagrejs/dagre';

import type { BlockDescriptor } from '../blocks/types';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';
import { cardRows } from './cardRows';
import { isSequenced } from './executionOrder';

export const NODE_WIDTH = 360;
export const GRID_SIZE = 20;
const STACK_GAP = 40;
const CLUSTER_PREFIX = 'cluster:';

export type Position = { x: number; y: number };
export type SizeOf = (instance: BlockInstance) => { height: number; width: number };
// Extra room a block needs around it: its condition gate and data chains to
// the left (see dataFootprint), how far they reach down from its top, and
// how far a lifted gate rises above it.
export type FootprintOf = (instance: BlockInstance) => { above: number; height: number; left: number };

const snap = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

// Card height before the canvas has measured it (freshly added blocks, the
// demo generator) — header plus one ~20px line per summary row. The
// canvas's real measurement wins once known.
export function estimateNodeHeight(instance: BlockInstance, descriptor: BlockDescriptor | undefined): number {
  const { rows, hidden } = cardRows(instance, descriptor, new Set());
  const rowCount = rows.length + (hidden > 0 ? 1 : 0);
  // Per-entry conditions get a summary line; the block's own condition is a gate pill beside it.
  const conditionLines = (instance.entries ?? []).some(entry => entry.condition) ? 1 : 0;
  return 24 + 32 + (rowCount > 0 ? 16 + rowCount * 20 : 0) + conditionLines * 30;
}

// Where a newly added block goes: under the lowest block on the canvas, in
// the leftmost column — so adding blocks without drawing arrows keeps
// building the same top-to-bottom sequence as before.
export function nextStackPosition(instances: BlockInstance[], sizeOf: SizeOf): Position {
  if (instances.length === 0) return { x: 0, y: 0 };
  const bottom = Math.max(...instances.map(instance => (instance.position?.y ?? 0) + sizeOf(instance).height));
  const left = Math.min(...instances.map(instance => instance.position?.x ?? 0));
  return { x: snap(left), y: snap(bottom + STACK_GAP) };
}

// One dagre node per block, sized with room for its pills and chains, and
// parented to its group's cluster.
function addLayoutNodes(
  graph: InstanceType<typeof dagre.graphlib.Graph>,
  ids: string[],
  byId: Map<string, BlockInstance>,
  sizeOf: SizeOf,
  footprintOf: FootprintOf,
  groupOf: (instance: BlockInstance) => string | undefined
): void {
  for (const id of ids) {
    const instance = byId.get(id);
    if (!instance) continue;
    const size = sizeOf(instance);
    const footprint = footprintOf(instance);
    graph.setNode(id, {
      width: footprint.left + size.width,
      height: footprint.above + Math.max(size.height, footprint.height),
      above: footprint.above,
      left: footprint.left
    });
    const groupId = groupOf(instance);
    if (groupId) {
      const cluster = `${CLUSTER_PREFIX}${groupId}`;
      if (!graph.hasNode(cluster)) graph.setNode(cluster, {});
      graph.setParent(id, cluster);
    }
  }
}

/**
 * "Tidy up": a top-to-bottom dagre layout (n8n uses dagre too, left-to-right).
 * Besides the real arrows, consecutive blocks in the current execution order
 * are chained with invisible layout edges, so tidying never changes that
 * order — unconnected blocks stay a vertical sequence instead of dagre
 * spreading them across one row. Define Variable / Define Class blocks
 * aren't sequenced, so they go in a column of their own to the left.
 * Each block is laid out with room for its gate and data chains (left of it).
 * A group's blocks are a dagre cluster, so they stay together; Define blocks
 * in a group stay in it rather than joining the Define column.
 */
export function tidyLayout(
  instances: BlockInstance[],
  edges: BlockEdge[],
  order: string[],
  sizeOf: SizeOf,
  footprintOf: FootprintOf,
  descriptorsById: Map<string, BlockDescriptor>,
  groupOf: (instance: BlockInstance) => string | undefined = () => undefined
): Record<string, Position> {
  const positions: Record<string, Position> = {};
  const graph = new dagre.graphlib.Graph({ compound: true });
  // Frames add padding and a title bar around each cluster, so groups need more room.
  const spacing = instances.some(instance => groupOf(instance)) ? 120 : 60;
  graph.setGraph({ rankdir: 'TB', nodesep: spacing, ranksep: spacing, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));

  const byId = new Map(instances.map(instance => [instance.instanceId, instance]));
  const isDefinition = (instance: BlockInstance) => !isSequenced(descriptorsById.get(instance.blockId));
  const groupedDefinitions = instances.filter(instance => isDefinition(instance) && groupOf(instance)).map(instance => instance.instanceId);
  addLayoutNodes(graph, [...order, ...groupedDefinitions], byId, sizeOf, footprintOf, groupOf);
  for (const edge of edges) if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) graph.setEdge(edge.source, edge.target);
  for (let index = 1; index < order.length; index++) {
    const [previous, current] = [order[index - 1], order[index]];
    if (!graph.hasEdge(previous, current)) graph.setEdge(previous, current, { weight: 0 });
  }
  dagre.layout(graph);
  let minX = 0;
  for (const id of graph.nodes()) {
    if (id.startsWith(CLUSTER_PREFIX)) continue;
    const node = graph.node(id) as ReturnType<typeof graph.node> & { above: number; left: number };
    // dagre reports centers; the canvas stores top-left corners.
    const left = node.x - node.width / 2;
    minX = Math.min(minX, left);
    positions[id] = { x: snap(left + node.left), y: snap(node.y - node.height / 2 + node.above) };
  }

  const definitions = instances.filter(instance => isDefinition(instance) && !groupOf(instance)).sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0));
  let y = 0;
  for (const instance of definitions) {
    const { above, height } = footprintOf(instance);
    y += above;
    positions[instance.instanceId] = { x: snap(minX - NODE_WIDTH - 80), y: snap(y) };
    y += Math.max(sizeOf(instance).height, height) + STACK_GAP;
  }
  return positions;
}
