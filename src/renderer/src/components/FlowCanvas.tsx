import { type MutableRefObject, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import AddIcon from '@mui/icons-material/Add';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import PanToolOutlinedIcon from '@mui/icons-material/PanToolOutlined';
import RemoveIcon from '@mui/icons-material/Remove';
import { Box, Divider, IconButton, Paper, Typography, useTheme } from '@mui/material';

import { useDroppable } from '@dnd-kit/core';
import {
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  MarkerType,
  MiniMap,
  type NodeChange,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
  SelectionMode,
  useReactFlow,
  useStore
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { entryName } from '../blocks/definitionEntries';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import { primaryPromiseType } from '../blocks/resolveBlockShape';
import { type ChainOwner, DATA_EDGE_PREFIX, DATA_NODE_WIDTH, type DataChain, deriveDataChains } from '../canvas/dataChains';
import { executionOrder, isSequenced, wouldCreateCycle } from '../canvas/executionOrder';
import { relationToFileCondition } from '../canvas/fileCondition';
import { GATE_EDGE_PREFIX, GATE_WIDTH, type Gate, deriveGates } from '../canvas/gates';
import { GROUP_NODE_PREFIX, type GroupFrame, type Rect, deriveGroupFrames, frameAt, settleGroup } from '../canvas/groupFrames';
import { GRID_SIZE, NODE_WIDTH, estimateNodeHeight } from '../canvas/layout';
import { defaultOutcomesFor, describeOutcomes } from '../canvas/outcomes';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge, BlockOutcome } from '../store/edgesSlice/types';
import type { PolicyFile } from '../store/filesSlice/types';
import type { BlockGroup } from '../store/groupsSlice/types';
import { BlockCard, type BlockFlowNode, COMPACT_ZOOM, type ConditionSource } from './BlockCard';
import { type DataFlowNode, DataNode } from './DataNode';
import { EmptyCanvas } from './EmptyCanvas';
import { FileConditionBanner } from './FileConditionBanner';
import { GateEdge, type GateFlowEdge } from './GateEdge';
import { type GateFlowNode, GateNode } from './GateNode';
import { type GroupFrameFlowNode, GroupFrameNode } from './GroupFrameNode';
import { OutcomeEdge, type OutcomeFlowEdge } from './OutcomeEdge';

export const CANVAS_DROPPABLE_ID = 'canvas-dropzone';

// Module-level so React Flow sees stable objects (a new object each render
// makes it re-register every node/edge type).
const nodeTypes = { block: BlockCard, gate: GateNode, data: DataNode, groupFrame: GroupFrameNode };
const edgeTypes = { outcome: OutcomeEdge, gate: GateEdge };

export type CanvasNode = BlockFlowNode | DataFlowNode | GateFlowNode | GroupFrameFlowNode;
export type CanvasEdge = Edge | GateFlowEdge | OutcomeFlowEdge;

// Edits a data chain makes from the canvas, addressed to the chain's owner.
export interface DataChainCallbacks {
  addStep: (owner: ChainOwner, decoratorId: string) => void;
  moveStep: (owner: ChainOwner, fromIndex: number, toIndex: number) => void;
  open: (owner: ChainOwner) => void;
  remove: (owner: ChainOwner) => void;
  removeStep: (owner: ChainOwner, stepId: string) => void;
  sampleChange: (owner: ChainOwner, value: string) => void;
}

export type NodeSizes = Record<string, { height: number; width: number }>;

// Where a condition's class is defined: a Define Class entry on this canvas,
// or in another file (classes are project-wide names). Hard classes and
// unknown names have no source.
function conditionSourceOf(className: string, allInstances: BlockInstance[], files: PolicyFile[], currentFileId: string | null): ConditionSource | undefined {
  if (!className) return undefined;
  const definers = allInstances.filter(instance => {
    const descriptor = blockDescriptorsById.get(instance.blockId);
    if (!descriptor?.entries || primaryPromiseType(descriptor) !== 'classes') return false;
    return (instance.entries ?? []).some(entry => entryName(descriptor, entry) === className);
  });
  const here = definers.find(instance => instance.fileId === currentFileId);
  if (here) return { instanceId: here.instanceId };
  const file = files.find(candidate => candidate.id === definers[0]?.fileId);
  return file ? { fileLabel: `${file.name}.cf` } : undefined;
}

// The toolbar's zoom actions, shared with the app's keyboard shortcuts.
export interface ZoomControls {
  fit: () => void;
  reset: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface FlowCanvasProps {
  // Every file's blocks: a condition's class may be defined in another file.
  allInstances: BlockInstance[];
  currentFileId: string | null;
  // The block cut to the clipboard and not pasted yet: shown muted, not draggable.
  cutPendingId: string | null;
  dataCallbacks: DataChainCallbacks;
  // Positions of derived nodes (gates, data chains) the user dragged.
  derivedPositions: Record<string, { x: number; y: number }>;
  duplicateKeys: Set<string>;
  edges: BlockEdge[];
  files: PolicyFile[];
  groups: BlockGroup[];
  instances: BlockInstance[];
  maximized: boolean;
  measured: NodeSizes;
  multiSelectedIds: string[];
  onConnect: (source: string, target: string, outcomes: BlockOutcome[]) => void;
  // A derived node (gate, data-chain node) was dragged.
  onDerivedMove: (key: string, position: { x: number; y: number }) => void;
  onEdgeOutcomesChange: (edgeId: string, outcomes: BlockOutcome[]) => void;
  onEdgeRemove: (edgeId: string) => void;
  onFileConditionRemove: () => void;
  onGateLink: (gate: Gate, instanceId: string) => void;
  onGateLinkRemove: (instanceId: string) => void;
  onGateModeChange: (gate: Gate, mode: 'if' | 'unless') => void;
  onGateRemove: (gate: Gate) => void;
  // A group's frame was dragged: its blocks' new positions, plus moved pills/chain nodes.
  onGroupMove: (
    positions: Record<string, { x: number; y: number }>,
    derived: Record<string, { x: number; y: number }>,
    resized?: { groupId: string; rect: NonNullable<BlockGroup['rect']> }
  ) => void;
  // A frame was resized by dragging its edges (between onNodeDragStart/Stop, one undo step).
  onGroupResize: (groupId: string, rect: NonNullable<BlockGroup['rect']>) => void;
  onInit: (instance: ReactFlowInstance<CanvasNode, CanvasEdge>) => void;
  onInvalidConnection: (message: string) => void;
  // `compact`: measured below COMPACT_ZOOM, where cards hide their rows — not sizes to lay out by.
  onMeasured: (sizes: NodeSizes, compact: boolean) => void;
  // Blocks dropped into (groupId) or out of (null) a group's frame; false when refused.
  onMembershipChange: (instanceIds: string[], groupId: string | null) => boolean;
  onMove: (instanceId: string, position: { x: number; y: number }) => void;
  onMultiSelect: (instanceIds: string[]) => void;
  onNodeDragStart: () => void;
  onNodeDragStop: () => void;
  onRemove: (instanceId: string) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onSelectGate: (key: string | null) => void;
  onSelectGroup: (groupId: string | null) => void;
  onSelectInstance: (instanceId: string | null) => void;
  onTidy: () => void;
  onToggleMaximize: () => void;
  // The data chain opened from the canvas (its owner's entry id), selected in place of its block.
  selectedChainEntryId: string | null;
  selectedEdgeId: string | null;
  selectedGateKey: string | null;
  selectedGroupId: string | null;
  selectedInstanceId: string | null;
  // Extra toolbar content (the maximized canvas's "Add block" popover).
  toolbarExtra?: ReactNode;
  zoomControlsRef?: MutableRefObject<ZoomControls | null>;
}

function CanvasToolbar({
  maximized,
  onTidy,
  onToggleMaximize,
  extra,
  zoomControlsRef,
  autoFitRef,
  selectMode,
  onSelectModeChange
}: {
  autoFitRef: MutableRefObject<boolean>;
  extra?: ReactNode;
  maximized: boolean;
  onSelectModeChange: (selectMode: boolean) => void;
  onTidy: () => void;
  onToggleMaximize: () => void;
  selectMode: boolean;
  zoomControlsRef?: MutableRefObject<ZoomControls | null>;
}) {
  const { zoomIn, zoomOut, fitView, getViewport, setCenter } = useReactFlow();
  const zoom = useStore(state => state.transform[2]);
  const paneWidth = useStore(state => state.width);
  const paneHeight = useStore(state => state.height);
  const buttonSx = { p: 0.75 };
  const modeActiveSx = { bgcolor: 'action.selected', color: 'primary.main' };

  // Back to 100% around whatever is in the middle of the view right now —
  // a plain zoomTo(1) pivots elsewhere and can push content off-screen.
  const controls: ZoomControls = {
    zoomIn: () => zoomIn({ duration: 150 }),
    zoomOut: () => zoomOut({ duration: 150 }),
    fit: () => fitView({ padding: 0.2, maxZoom: 1, duration: 200 }),
    reset: () => {
      const viewport = getViewport();
      setCenter((paneWidth / 2 - viewport.x) / viewport.zoom, (paneHeight / 2 - viewport.y) / viewport.zoom, { zoom: 1, duration: 200 });
    }
  };
  useEffect(() => {
    if (zoomControlsRef) zoomControlsRef.current = controls;
  });

  // The pane often settles to its final size only after the first fit
  // (saved sidebar widths load asynchronously; full screen toggles it), which
  // would leave the view off-centre. Keep fitting to size changes until the
  // user pans or zooms themselves — then their viewport is theirs.
  useEffect(() => {
    if (autoFitRef.current && paneWidth > 0 && paneHeight > 0) fitView({ padding: 0.2, maxZoom: 1 });
  }, [paneWidth, paneHeight, autoFitRef, fitView]);

  return (
    <Panel position="bottom-left">
      <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', gap: 0.25, px: 0.5, py: 0.25, bgcolor: 'background.default' }}>
        {extra}
        {extra && <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />}
        <IconButton
          size="small"
          title="Hand: drag the canvas to move around"
          aria-pressed={!selectMode}
          onClick={() => onSelectModeChange(false)}
          sx={{ ...buttonSx, ...(!selectMode && modeActiveSx) }}
        >
          <PanToolOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <IconButton
          size="small"
          title="Select: drag a box around blocks to select them (or hold Shift and drag)"
          aria-pressed={selectMode}
          onClick={() => onSelectModeChange(true)}
          sx={{ ...buttonSx, ...(selectMode && modeActiveSx) }}
        >
          <HighlightAltIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <IconButton size="small" title="Zoom out (-)" onClick={controls.zoomOut} sx={buttonSx}>
          <RemoveIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <Typography
          title="Reset to 100% (0)"
          onClick={controls.reset}
          sx={{ fontSize: 12, fontFamily: 'monospace', width: 44, textAlign: 'center', cursor: 'pointer', color: 'text.primary' }}
        >
          {Math.round(zoom * 100)}%
        </Typography>
        <IconButton size="small" title="Zoom in (+)" onClick={controls.zoomIn} sx={buttonSx}>
          <AddIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <IconButton size="small" title="Fit to screen (1)" onClick={controls.fit} sx={buttonSx}>
          <FitScreenIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <IconButton size="small" title="Tidy up" onClick={onTidy} sx={buttonSx}>
          <AccountTreeOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <IconButton size="small" title={maximized ? 'Exit full screen (Esc)' : 'Full screen canvas'} onClick={onToggleMaximize} sx={buttonSx}>
          {maximized ? <CloseFullscreenIcon sx={{ fontSize: 18 }} /> : <OpenInFullIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Paper>
    </Panel>
  );
}

/**
 * One policy file's blocks as a free-form graph (React Flow). Blocks stay
 * where they're dropped; arrows from a block's kept / repaired / not kept
 * port gate other blocks, and together with position they define the
 * compiled execution order (canvas/executionOrder.ts), shown as #n.
 */
export function FlowCanvas({
  allInstances,
  instances,
  cutPendingId,
  edges,
  files,
  currentFileId,
  derivedPositions,
  duplicateKeys,
  measured,
  maximized,
  selectedInstanceId,
  selectedChainEntryId,
  multiSelectedIds,
  onMultiSelect,
  onNodeDragStart,
  onNodeDragStop,
  selectedEdgeId,
  selectedGateKey,
  selectedGroupId,
  groups,
  onGroupMove,
  onGroupResize,
  onMembershipChange,
  onSelectGroup,
  toolbarExtra,
  onSelectInstance,
  onSelectEdge,
  onSelectGate,
  onDerivedMove,
  dataCallbacks,
  onFileConditionRemove,
  onGateLink,
  onGateLinkRemove,
  onGateModeChange,
  onGateRemove,
  onRemove,
  onMove,
  onMeasured,
  onConnect,
  onEdgeOutcomesChange,
  onEdgeRemove,
  onInvalidConnection,
  onTidy,
  onToggleMaximize,
  onInit,
  zoomControlsRef
}: FlowCanvasProps) {
  const theme = useTheme();
  const { setNodeRef } = useDroppable({ id: CANVAS_DROPPABLE_ID });
  const autoFitRef = useRef(true);
  const boxSelectionRef = useRef<Set<string> | null>(null);
  // While a frame is being resized, its position changes aren't a group move.
  const resizingRef = useRef(false);
  const [selectMode, setSelectMode] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // Blocks being dragged right now, and the group frame they'd join on drop.
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(new Set());
  const [dropGroupId, setDropGroupId] = useState<string | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  // Where dragged blocks started, to carry a resized frame along when its whole group moves.
  const dragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const order = useMemo(() => executionOrder(instances, edges, blockDescriptorsById), [instances, edges]);
  const orderNumbers = useMemo(() => new Map(order.map((instanceId, index) => [instanceId, index + 1])), [order]);
  const byId = useMemo(() => new Map(instances.map(instance => [instance.instanceId, instance])), [instances]);

  const chains: DataChain[] = useMemo(
    () => (currentFileId ? deriveDataChains(instances, currentFileId, derivedPositions, nodeId => measured[nodeId]?.height, blockDescriptorsById) : []),
    [instances, currentFileId, derivedPositions, measured]
  );
  const chainByNodeId = new Map(chains.map(chain => [chain.nodeId, chain] as const));
  const fedBlocks = useMemo(() => new Set(chains.map(chain => chain.targetId)), [chains]);

  const blockNodes: BlockFlowNode[] = instances.map(instance => {
    const descriptor = blockDescriptorsById.get(instance.blockId);
    return {
      id: instance.instanceId,
      type: 'block',
      position: instance.position ?? { x: 0, y: 0 },
      selected: (instance.instanceId === selectedInstanceId && !selectedChainEntryId) || multiSelectedIds.includes(instance.instanceId),
      draggable: instance.instanceId !== cutPendingId,
      // Every block can take a condition gate on its left; outcome arrows are
      // restricted separately (connectionProblem).
      connectable: true,
      measured: measured[instance.instanceId],
      data: {
        instance,
        descriptor,
        duplicateKeys,
        orderNumber: orderNumbers.get(instance.instanceId),
        onRemove: () => onRemove(instance.instanceId),
        cutPending: instance.instanceId === cutPendingId,
        highlighted: instance.instanceId === highlightedId,
        hasDataInput: fedBlocks.has(instance.instanceId)
      }
    };
  });

  const fileCondition = files.find(file => file.id === currentFileId)?.condition;
  const gates = useMemo(
    () => (currentFileId ? deriveGates(instances, currentFileId, derivedPositions, instance => fedBlocks.has(instance.instanceId)) : []),
    [instances, currentFileId, derivedPositions, fedBlocks]
  );
  const clearSelection = () => {
    onSelectGroup(null);
    onSelectInstance(null);
    onSelectEdge(null);
    onSelectGate(null);
  };
  const gateByNodeId = new Map(gates.map(gate => [gate.nodeId, gate]));
  const gateNodes: GateFlowNode[] = gates.map(gate => ({
    id: gate.nodeId,
    type: 'gate',
    position: gate.position,
    selected: gate.key === selectedGateKey,
    measured: measured[gate.nodeId],
    data: {
      gate,
      source: conditionSourceOf(gate.condition.className, allInstances, files, currentFileId),
      fileRelation: relationToFileCondition(gate.condition, fileCondition),
      onHighlight: setHighlightedId,
      onModeChange: mode => onGateModeChange(gate, mode),
      onRemove: () => onGateRemove(gate)
    }
  }));
  const gateEdges: GateFlowEdge[] = gates.flatMap(gate =>
    gate.instanceIds.map(instanceId => ({
      id: `${GATE_EDGE_PREFIX}${instanceId}`,
      source: gate.nodeId,
      sourceHandle: 'gate-out',
      target: instanceId,
      targetHandle: 'gate',
      type: 'gate' as const,
      selected: `${GATE_EDGE_PREFIX}${instanceId}` === selectedEdgeId,
      data: { onRemove: () => onGateLinkRemove(instanceId) }
    }))
  );

  // What a group's frame encloses: its cards, plus the pills and chain nodes serving only its members.
  const rectOf = (id: string, position: { x: number; y: number }, fallback: { height: number; width: number }): Rect => ({
    ...position,
    ...(measured[id] ?? fallback)
  });
  const footprintOf = (memberIds: string[]): Rect[] => {
    const members = new Set(memberIds);
    const rects = memberIds.flatMap(id => {
      const instance = byId.get(id);
      if (!instance) return [];
      const estimate = { width: NODE_WIDTH, height: estimateNodeHeight(instance, blockDescriptorsById.get(instance.blockId)) };
      return [rectOf(id, instance.position ?? { x: 0, y: 0 }, estimate)];
    });
    for (const gate of gates) {
      if (gate.instanceIds.every(id => members.has(id))) rects.push(rectOf(gate.nodeId, gate.position, { width: GATE_WIDTH, height: 56 }));
    }
    for (const chain of chains) {
      if (members.has(chain.targetId)) rects.push(rectOf(chain.nodeId, chain.position, { width: DATA_NODE_WIDTH, height: 120 }));
    }
    return rects;
  };
  const frames = deriveGroupFrames(
    groups.map(group => carriedFrame(group)),
    groupId => instances.filter(instance => instance.groupId === groupId).map(instance => instance.instanceId),
    footprintOf,
    draggingIds
  );
  const frameByNodeId = new Map(frames.map(frame => [frame.nodeId, frame]));
  // A group takes arrows when it has a block that runs.
  const runsAnything = (memberIds: string[]) => memberIds.some(id => isSequenced(blockDescriptorsById.get(byId.get(id)?.blockId ?? '')));
  const groupById = new Map(frames.map(frame => [frame.group.id, frame]));
  // An arrow end on the canvas: a block's node id, or a frame's for a group.
  const nodeIdOf = (endpoint: string) => (groupById.has(endpoint) ? `${GROUP_NODE_PREFIX}${endpoint}` : endpoint);
  const endpointOf = (nodeId: string) => frameByNodeId.get(nodeId)?.group.id ?? nodeId;
  const groupNodes: GroupFrameFlowNode[] = frames.map(frame => ({
    id: frame.nodeId,
    type: 'groupFrame',
    position: { x: frame.rect.x, y: frame.rect.y },
    width: frame.rect.width,
    height: frame.rect.height,
    // Sized by us, not by rendering — tell React Flow so it can drag it right away.
    measured: { width: frame.rect.width, height: frame.rect.height },
    zIndex: 0,
    dragHandle: '.group-drag-handle',
    selectable: false,
    connectable: runsAnything(frame.memberIds),
    // The wrapper lets the pointer through (only the title bar and resize
    // handles take it), and selection lives in `data`, not `selected`, so
    // React Flow doesn't lift a selected frame above the blocks inside it.
    style: { pointerEvents: 'none' },
    data: {
      isSelected: frame.group.id === selectedGroupId,
      group: frame.group,
      memberCount: frame.memberIds.length,
      connectable: runsAnything(frame.memberIds),
      dropTarget: frame.group.id === dropGroupId,
      onResizeStart: () => {
        resizingRef.current = true;
        onNodeDragStart();
      },
      onResize: rect => onGroupResize(frame.group.id, rect),
      onResizeEnd: () => {
        resizingRef.current = false;
        onNodeDragStop();
      }
    }
  }));

  const outcomeEdges: OutcomeFlowEdge[] = edges.map(edge => {
    const color = theme.palette[describeOutcomes(edge.outcomes).color].main;
    return {
      id: edge.id,
      source: nodeIdOf(edge.source),
      target: nodeIdOf(edge.target),
      sourceHandle: 'out',
      targetHandle: 'in',
      type: 'outcome',
      selected: edge.id === selectedEdgeId,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      data: { outcomes: edge.outcomes, onOutcomesChange: outcomes => onEdgeOutcomesChange(edge.id, outcomes), onDelete: () => onEdgeRemove(edge.id) }
    };
  });
  const dataNodes: DataFlowNode[] = chains.map(chain => ({
    id: chain.nodeId,
    type: 'data' as const,
    position: chain.position,
    connectable: false,
    measured: measured[chain.nodeId],
    selected: chain.owner.instanceId === selectedInstanceId && chain.owner.entryId === selectedChainEntryId,
    data: {
      chain,
      onAddStep: decoratorId => dataCallbacks.addStep(chain.owner, decoratorId),
      onMoveStep: (fromIndex, toIndex) => dataCallbacks.moveStep(chain.owner, fromIndex, toIndex),
      onRemove: () => dataCallbacks.remove(chain.owner),
      onRemoveStep: stepId => dataCallbacks.removeStep(chain.owner, stepId),
      onSampleChange: value => dataCallbacks.sampleChange(chain.owner, value)
    }
  }));
  // Solid info-blue arrows: data flowing into what a chain produces — unlike
  // outcome arrows (coloured, labelled by outcome) and condition links (dashed grey).
  const dataEdges: Edge[] = chains.map(chain => ({
    id: `${DATA_EDGE_PREFIX}${chain.key}`,
    source: chain.nodeId,
    sourceHandle: 'data-out',
    target: chain.targetId,
    targetHandle: 'data',
    selectable: false,
    style: { stroke: theme.palette.info.main, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: theme.palette.info.main, width: 16, height: 16 }
  }));

  // Later nodes draw on top: a chain's controls stay usable even where it overlaps a block.
  const nodes: CanvasNode[] = [...groupNodes, ...gateNodes, ...blockNodes, ...dataNodes];
  const flowEdges: CanvasEdge[] = [...gateEdges, ...dataEdges, ...outcomeEdges];

  // Positions and measured sizes live outside React Flow (Redux / the
  // parent), so only those two change kinds matter; selection is driven by
  // the click handlers, and deletion by the app's own key handler.
  const handleNodesChange = (changes: NodeChange<CanvasNode>[]) => {
    const sizes: NodeSizes = {};
    trackBoxSelection(changes);
    for (const change of changes) {
      if (change.type === 'position' && change.position) applyPosition(change.id, change.position);
      if (change.type === 'dimensions' && change.dimensions) sizes[change.id] = change.dimensions;
    }
    if (Object.keys(sizes).length > 0) onMeasured(sizes, (flowInstanceRef.current?.getZoom() ?? 1) < COMPACT_ZOOM);
  };

  // A dragged node's new position: a frame moves its group, a pill or chain
  // node is remembered as a derived position, a block moves itself.
  const applyPosition = (id: string, position: { x: number; y: number }) => {
    const frame = frameByNodeId.get(id);
    const gate = gateByNodeId.get(id);
    const chain = chainByNodeId.get(id);
    if (frame) {
      if (!resizingRef.current) moveGroup(frame, position);
    } else if (gate) onDerivedMove(gate.key, position);
    else if (chain) onDerivedMove(chain.key, position);
    else onMove(id, position);
  };

  // Dragging a frame moves its members by the same (grid-snapped) offset,
  // along with any of their pills / chain nodes the user had dragged aside.
  const moveGroup = (frame: GroupFrame, to: { x: number; y: number }) => {
    const dx = Math.round((to.x - frame.rect.x) / GRID_SIZE) * GRID_SIZE;
    const dy = Math.round((to.y - frame.rect.y) / GRID_SIZE) * GRID_SIZE;
    if (dx === 0 && dy === 0) return;
    const shift = (position: { x: number; y: number }) => ({ x: position.x + dx, y: position.y + dy });
    const members = new Set(frame.memberIds);
    const positions = Object.fromEntries(frame.memberIds.map(id => [id, shift(byId.get(id)?.position ?? { x: 0, y: 0 })]));
    const derived: Record<string, { x: number; y: number }> = {};
    for (const gate of gates) if (derivedPositions[gate.key] && gate.instanceIds.every(id => members.has(id))) derived[gate.key] = shift(gate.position);
    for (const chain of chains) {
      if (members.has(chain.targetId) && derivedPositions[chain.key]) derived[chain.key] = shift(chain.position);
    }
    const { rect } = frame.group;
    onGroupMove(positions, derived, rect && { groupId: frame.group.id, rect: { ...rect, x: rect.x + dx, y: rect.y + dy } });
  };

  // A resized frame whose every block is being dragged moves with them, keeping its size.
  function carriedFrame(group: BlockGroup): BlockGroup {
    const memberIds = instances.filter(instance => instance.groupId === group.id).map(instance => instance.instanceId);
    const start = memberIds.length > 0 ? dragStartRef.current.get(memberIds[0]) : undefined;
    if (!group.rect || !start || !memberIds.every(id => draggingIds.has(id))) return group;
    const now = byId.get(memberIds[0])?.position ?? start;
    const [dx, dy] = [now.x - start.x, now.y - start.y];
    return dx === 0 && dy === 0 ? group : { ...group, rect: { ...group.rect, x: group.rect.x + dx, y: group.rect.y + dy } };
  }

  // The frame a dragged block's centre is over.
  const frameUnder = (node: { id: string; position: { x: number; y: number } }) => {
    const size = measured[node.id] ?? { width: NODE_WIDTH, height: 80 };
    return frameAt(frames, { x: node.position.x + size.width / 2, y: node.position.y + size.height / 2 });
  };

  // On drop, each dragged block joins the frame it's over, or leaves its own
  // (only possible while other members stayed put — see deriveGroupFrames).
  // Alt+drag moves without changing membership.
  const applyMembership = (dragged: { id: string; position: { x: number; y: number } }[]) => {
    const moves = new Map<string | null, string[]>();
    const finalGroup = new Map<string, string | undefined>();
    for (const node of dragged) {
      const instance = byId.get(node.id);
      if (!instance) continue;
      const target = frameUnder(node)?.group.id ?? null;
      const stayedBehind = instance.groupId && instances.some(other => other.groupId === instance.groupId && !draggingIds.has(other.instanceId));
      const unchanged = target === (instance.groupId ?? null) || (target === null && !stayedBehind);
      finalGroup.set(instance.instanceId, unchanged ? instance.groupId : (target ?? undefined));
      if (unchanged) continue;
      moves.set(target, [...(moves.get(target) ?? []), instance.instanceId]);
    }
    for (const [groupId, instanceIds] of moves) {
      if (onMembershipChange(instanceIds, groupId)) continue;
      for (const id of instanceIds) finalGroup.set(id, byId.get(id)?.groupId);
    }
    settleDroppedInto(dragged, finalGroup);
  };

  // A group that grew while settling pushes the blocks below it down by as
  // much, so it doesn't land on them (their order among themselves is kept).
  const makeRoomBelow = (cards: (Rect & { id: string })[], settled: Record<string, { x: number; y: number }>, droppedAt: Map<string, unknown>) => {
    const bottom = (list: Rect[]) => Math.max(...list.map(card => card.y + card.height));
    const growth = bottom(cards.map(card => ({ ...card, ...settled[card.id] }))) - bottom(cards);
    if (growth <= 0) return {};
    const left = Math.min(...cards.map(card => card.x));
    const right = Math.max(...cards.map(card => card.x + card.width));
    const oldBottom = bottom(cards);
    const members = new Set(cards.map(card => card.id));
    const pushed: Record<string, { x: number; y: number }> = {};
    for (const instance of instances) {
      const position = instance.position ?? { x: 0, y: 0 };
      const width = measured[instance.instanceId]?.width ?? NODE_WIDTH;
      const below = position.y >= oldBottom - GRID_SIZE && position.x < right && left < position.x + width;
      if (!members.has(instance.instanceId) && !droppedAt.has(instance.instanceId) && below)
        pushed[instance.instanceId] = { x: position.x, y: position.y + growth };
    }
    return pushed;
  };

  // Make room in each group that blocks were dropped into, so no cards overlap.
  const settleDroppedInto = (dragged: { id: string; position: { x: number; y: number } }[], finalGroup: Map<string, string | undefined>) => {
    const droppedAt = new Map(dragged.map(node => [node.id, node.position]));
    const moved: Record<string, { x: number; y: number }> = {};
    for (const groupId of new Set([...finalGroup.values()].filter((id): id is string => Boolean(id)))) {
      const cards = instances
        .filter(instance => (finalGroup.has(instance.instanceId) ? finalGroup.get(instance.instanceId) : instance.groupId) === groupId)
        .map(instance => {
          const size = measured[instance.instanceId] ?? { width: NODE_WIDTH, height: estimateNodeHeight(instance, blockDescriptorsById.get(instance.blockId)) };
          return { id: instance.instanceId, ...(droppedAt.get(instance.instanceId) ?? instance.position ?? { x: 0, y: 0 }), ...size };
        });
      const droppedHere = cards.filter(card => finalGroup.get(card.id) === groupId).map(card => card.id);
      const settled = settleGroup(cards, droppedHere, 40, GRID_SIZE);
      Object.assign(moved, settled, makeRoomBelow(cards, settled, droppedAt));
    }
    if (Object.keys(moved).length > 0) onGroupMove(moved, {});
  };

  // Only the selection box drives selection through changes; clicks go through onNodeClick.
  const trackBoxSelection = (changes: NodeChange<CanvasNode>[]) => {
    const box = boxSelectionRef.current;
    if (!box) return;
    let changed = false;
    for (const change of changes) {
      if (change.type !== 'select' || !byId.has(change.id)) continue;
      if (change.selected) box.add(change.id);
      else box.delete(change.id);
      changed = true;
    }
    if (changed) onMultiSelect([...box]);
  };

  // Shift+click adds a block to the selection, or takes it out.
  const toggleSelected = (instanceId: string) => {
    const current = new Set(multiSelectedIds.length > 0 ? multiSelectedIds : selectedInstanceId ? [selectedInstanceId] : []);
    if (current.has(instanceId)) current.delete(instanceId);
    else current.add(instanceId);
    onMultiSelect([...current]);
  };

  // A condition gate may link to any block's left edge; an outcome arrow
  // runs from a block's bottom output to another block's top input.
  const gateLinkProblem = (gate: Gate, target: string, targetHandle: string | null | undefined): string | null => {
    if (!byId.has(target) || targetHandle !== 'gate') return 'Drop a condition on a block’s left edge.';
    if (gate.instanceIds.includes(target)) return 'That block already has this condition.';
    return null;
  };

  // The group an arrow end sits in: a block's, or the group itself for a frame.
  const groupAt = (endpoint: string) => (groupById.has(endpoint) ? undefined : byId.get(endpoint)?.groupId);

  const connectionProblem = ({ source: sourceNode, target: targetNode, sourceHandle, targetHandle }: Connection | Edge): string | null => {
    if (!sourceNode || !targetNode || sourceNode === targetNode) return 'An arrow needs two different blocks.';
    const gate = gateByNodeId.get(sourceNode);
    if (gate) return gateLinkProblem(gate, targetNode, targetHandle);
    if (sourceHandle !== 'out' || targetHandle !== 'in')
      return 'Arrows go from a block’s bottom dot to another block’s top dot; the left edge is for conditions.';
    const [source, target] = [endpointOf(sourceNode), endpointOf(targetNode)];
    const takesArrows = (endpoint: string) => {
      const frame = groupById.get(endpoint);
      return frame ? runsAnything(frame.memberIds) : isSequenced(blockDescriptorsById.get(byId.get(endpoint)?.blockId ?? ''));
    };
    if (!takesArrows(source) || !takesArrows(target)) {
      return 'Define Variable / Define Class blocks can’t take arrows — use a Condition to react to their classes.';
    }
    if (groupAt(source) === target || groupAt(target) === source) return 'That block is inside this group — it already runs as part of it.';
    if (groupAt(source) !== groupAt(target)) return 'Arrows can’t cross a group’s edge: connect to the group’s frame instead (its top and bottom dots).';
    if (edges.some(edge => edge.source === source && edge.target === target))
      return 'Those are already connected — click the arrow’s label to change what it waits for.';
    if (wouldCreateCycle(edges, source, target)) return 'That arrow would create a loop.';
    return null;
  };

  return (
    <Box
      ref={setNodeRef}
      component="main"
      // React Flow's group rectangle would swallow clicks on everything inside
      // it; dragging any selected block already moves the whole group.
      sx={{
        flex: 1,
        position: 'relative',
        minWidth: 0,
        '& .react-flow__nodesselection': { display: 'none' },
        ...(selectMode && { '& .react-flow__pane': { cursor: 'crosshair' } })
      }}
    >
      <ReactFlow<CanvasNode, CanvasEdge>
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={instance => {
          flowInstanceRef.current = instance;
          onInit(instance);
        }}
        // `event` is only set for user-driven pans/zooms, not programmatic ones.
        onMoveStart={event => {
          if (event) autoFitRef.current = false;
        }}
        onNodesChange={handleNodesChange}
        // A drag is one undo step, however many blocks it moves.
        onNodeDragStart={(_event, _node, dragged) => {
          const blocks = dragged.filter(item => byId.has(item.id));
          dragStartRef.current = new Map(blocks.map(item => [item.id, byId.get(item.id)?.position ?? item.position]));
          setDraggingIds(new Set(blocks.map(item => item.id)));
          onNodeDragStart();
        }}
        onNodeDrag={(_event, node) => {
          const frame = byId.has(node.id) ? frameUnder(node) : undefined;
          setDropGroupId(frame && frame.group.id !== byId.get(node.id)?.groupId ? frame.group.id : null);
        }}
        onNodeDragStop={(event, _node, dragged) => {
          if (!event.altKey) applyMembership(dragged);
          for (const group of groups) {
            const carried = carriedFrame(group);
            if (carried !== group && carried.rect) onGroupResize(group.id, carried.rect);
          }
          dragStartRef.current = new Map();
          setDraggingIds(new Set());
          setDropGroupId(null);
          onNodeDragStop();
        }}
        onNodeClick={(event, node) => {
          const frame = frameByNodeId.get(node.id);
          if (frame) return onSelectGroup(frame.group.id);
          const gate = gateByNodeId.get(node.id);
          const chain = chainByNodeId.get(node.id);
          if (event.shiftKey && byId.has(node.id)) toggleSelected(node.id);
          else if (gate) onSelectGate(gate.key);
          else if (chain) dataCallbacks.open(chain.owner);
          else onSelectInstance(node.id);
        }}
        // Data arrows aren't selectable, but React Flow still reports their clicks.
        onEdgeClick={(_event, edge) => edge.selectable !== false && onSelectEdge(edge.id)}
        onPaneClick={clearSelection}
        onConnect={connection => {
          if (connectionProblem(connection)) return;
          const gate = gateByNodeId.get(connection.source);
          if (gate) return onGateLink(gate, connection.target);
          const [source, target] = [endpointOf(connection.source), endpointOf(connection.target)];
          // A group's call is kept or repaired when nothing in it failed.
          const outcomes: BlockOutcome[] = groupById.has(source)
            ? ['kept', 'repaired']
            : defaultOutcomesFor(blockDescriptorsById.get(byId.get(source)?.blockId ?? ''));
          onConnect(source, target, outcomes);
        }}
        isValidConnection={connection => connectionProblem(connection) === null}
        onConnectEnd={(_event, state) => {
          if (state.isValid === false && state.fromNode && state.toNode) {
            const problem = connectionProblem({
              source: state.fromNode.id,
              target: state.toNode.id,
              sourceHandle: state.fromHandle?.id ?? null,
              targetHandle: state.toHandle?.id ?? null
            });
            if (problem) onInvalidConnection(problem);
          }
        }}
        // The app's own key handler owns Delete/Backspace (it knows about
        // text fields and dialogs).
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        // Hand mode: dragging empty canvas pans, Shift+drag draws a selection
        // box. Select mode: dragging draws the box, middle-drag pans. Either
        // way scroll pans, pinch or Ctrl/Cmd+scroll zooms.
        selectionOnDrag={selectMode}
        selectionKeyCode="Shift"
        selectionMode={SelectionMode.Partial}
        panOnDrag={selectMode ? [1] : true}
        panOnScroll
        // Seeded with the current selection: React Flow only reports blocks whose state changes.
        onSelectionStart={() => {
          boxSelectionRef.current = new Set(multiSelectedIds.length > 0 ? multiSelectedIds : selectedInstanceId ? [selectedInstanceId] : []);
        }}
        onSelectionEnd={() => {
          boxSelectionRef.current = null;
        }}
        zoomOnDoubleClick={false}
        snapToGrid
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        colorMode={theme.palette.mode}
        attributionPosition="top-right"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} color={theme.palette.divider} />
        <MiniMap pannable zoomable position="bottom-right" nodeBorderRadius={4} />
        {fileCondition && (
          <Panel position="top-center">
            {/* With nothing selected, the Properties panel shows the file's settings. */}
            <FileConditionBanner condition={fileCondition} onOpen={clearSelection} onRemove={onFileConditionRemove} />
          </Panel>
        )}
        <CanvasToolbar
          maximized={maximized}
          onTidy={onTidy}
          onToggleMaximize={onToggleMaximize}
          extra={toolbarExtra}
          zoomControlsRef={zoomControlsRef}
          autoFitRef={autoFitRef}
          selectMode={selectMode}
          onSelectModeChange={setSelectMode}
        />
      </ReactFlow>
      {instances.length === 0 && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <EmptyCanvas />
        </Box>
      )}
    </Box>
  );
}
