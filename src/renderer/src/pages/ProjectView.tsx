import { useEffect, useMemo, useRef, useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { Box, Button, CircularProgress, Paper, Popover, Stack, Typography } from '@mui/material';

import { DndContext, type DragEndEvent, DragOverlay, type DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { ReactFlowInstance } from '@xyflow/react';

import { duplicateDefinitionKeys, newDefinitionEntry } from '../blocks/definitionEntries';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import { PROMISE_TYPE_ICONS } from '../blocks/promiseTypeIcons';
import { primaryPromiseType, resolveBlockShape } from '../blocks/resolveBlockShape';
import type { BlockDescriptor } from '../blocks/types';
import type { ChainOwner } from '../canvas/dataChains';
import { executionOrder } from '../canvas/executionOrder';
import { describeFileCondition } from '../canvas/fileCondition';
import { GATE_EDGE_PREFIX, type Gate, deriveGates, gateKey } from '../canvas/gates';
import { GRID_SIZE, NODE_WIDTH, type Position, estimateNodeHeight, nextStackPosition } from '../canvas/layout';
import { tidyPositions } from '../canvas/tidy';
import { BlockGroupRow } from '../components/BlockGroupRow';
import { BlockPalette } from '../components/BlockPalette';
import { DeploymentView } from '../components/DeploymentView';
import { CANVAS_DROPPABLE_ID, type CanvasEdge, type CanvasNode, FlowCanvas, type NodeSizes, type ZoomControls } from '../components/FlowCanvas';
import { GeneratedPolicyView } from '../components/GeneratedPolicyView';
import { GroupPanel } from '../components/GroupPanel';
import { PolicyFileExplorer } from '../components/PolicyFileExplorer';
import { ProjectStatusLabel } from '../components/ProjectStatusLabel';
import { FileSettingsPanel, PropertiesPanel } from '../components/PropertiesPanel';
import type { NewClassDefinition } from '../components/PropertiesPanel';
import { ResizeHandle } from '../components/ResizeHandle';
import { StatusBar } from '../components/StatusBar';
import { TestResultsView } from '../components/TestResultsView';
import { PROJECT_TABS, TopBar } from '../components/TopBar';
import { AgentLock } from '../components/agent/AgentLock';
import { ConfirmDialog } from '../components/dialogs/ConfirmDialog';
import { ConditionSection } from '../components/properties/ConditionSection';
import { RunsWhenSection } from '../components/properties/RunsWhenSection';
import { buildClassNameOptions } from '../components/properties/classOptions';
import {
  LEFT_SIDEBAR_MAX,
  LEFT_SIDEBAR_MIN,
  PALETTE_HEIGHT_MAX,
  PALETTE_HEIGHT_MIN,
  RIGHT_SIDEBAR_MAX,
  RIGHT_SIDEBAR_MIN,
  clamp,
  useLayoutSettings
} from '../hooks/useLayoutSettings';
import { useMcpCanvas } from '../mcp/useMcpTools';
import { markDeploySeen, useDeployActivity } from '../project/deployRuns';
import { markTestActivitySeen, useTestActivity } from '../project/testRuns';
import { useCompiledPolicy } from '../project/useCompiledPolicy';
import { useAppDispatch, useAppSelector } from '../store';
import {
  blockAdded,
  blockGroupChanged,
  blockLabelChanged,
  blockMoved,
  blockParamChanged,
  blockRemoved,
  blockValueSourceChanged,
  blocksMoved,
  blocksRemovedForFile,
  classRefAdded,
  classRefChanged,
  classRefRemoved,
  conditionClassNameChanged,
  conditionEnabled,
  conditionModeChanged,
  conditionRemoved,
  conditionSet,
  dataChainRemoved,
  decoratorAdded,
  decoratorMoved,
  decoratorParamChanged,
  decoratorRemoved,
  entryAdded,
  entryMoved,
  entryRemoved,
  incomingModeChanged,
  inventoryAttributeNameChanged,
  inventoryEnabled,
  inventoryRemoved,
  paramBound,
  paramUnbound,
  sampleInputChanged
} from '../store/canvasSlice';
import { selectBlocksForFile, selectCanvasBlocks } from '../store/canvasSlice/selectors';
import type { BlockInstance } from '../store/canvasSlice/types';
import { clipboardCleared } from '../store/clipboardSlice';
import { selectClipboard, selectCutPendingId } from '../store/clipboardSlice/selectors';
import { derivedNodeForgotten, derivedNodeMoved, derivedNodePositionsClearedForFile } from '../store/derivedNodesSlice';
import { selectDerivedNodePositions } from '../store/derivedNodesSlice/selectors';
import { edgeAdded, edgeOutcomesChanged, edgeRemoved } from '../store/edgesSlice';
import { selectEdges } from '../store/edgesSlice/selectors';
import {
  fileAdded,
  fileConditionClassNameChanged,
  fileConditionEnabled,
  fileConditionModeChanged,
  fileConditionRemoved,
  fileDescriptionChanged,
  fileRemoved,
  fileRenamed,
  fileSelected,
  folderAdded,
  folderRemoved,
  folderRenamed
} from '../store/filesSlice';
import { collectFolderDescendants } from '../store/filesSlice/fileTree';
import { selectCurrentFile, selectCurrentFileId, selectFiles, selectFolders } from '../store/filesSlice/selectors';
import {
  groupColorChanged,
  groupConditionClassNameChanged,
  groupConditionEnabled,
  groupConditionModeChanged,
  groupConditionRemoved,
  groupIncomingModeChanged,
  groupRenamed
} from '../store/groupsSlice';
import { historyBatchEnded, historyBatchStarted, inOneStep, redone, undone } from '../store/history';
import { selectCurrentProject } from '../store/projectSlice/selectors';
import { definedNames } from './pasteCopies';
import { useClipboardActions } from './useClipboardActions';
import { useGroupActions } from './useGroupActions';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { useSelection } from './useSelection';

const UNDO_KEY = navigator.platform.startsWith('Mac') ? '⌘Z' : 'Ctrl+Z';
const GROUP_KEY = navigator.platform.startsWith('Mac') ? '⌘G' : 'Ctrl+G';

// The blocks a canvas action applies to: the multi-selection, else the one selected block.
const selectionOf = (multiSelectedIds: string[], selectedInstanceId: string | null): string[] =>
  multiSelectedIds.length > 0 ? multiSelectedIds : selectedInstanceId ? [selectedInstanceId] : [];

// On the Test Results tab's name: a spinner while an environment action runs, then a
// check (or a red dot when it failed) until the tab is opened.
function TestActivityBadge() {
  const { outcome, running } = useTestActivity();
  if (running) return <CircularProgress size={12} thickness={5} aria-label="Test environment busy" />;
  if (outcome === 'ok') return <CheckCircleIcon color="success" sx={{ fontSize: 14 }} aria-label="Test environment action done" />;
  if (outcome === 'error')
    return <Box component="span" aria-label="Test environment action failed" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }} />;
  return null;
}

// The Deployment tab name: a spinner while a Build or deploy runs, then how it ended until looked at.
function DeployActivityBadge({ path }: { path: string | null }) {
  const { outcome, running } = useDeployActivity(path);
  if (running) return <CircularProgress size={12} thickness={5} aria-label="Deployment busy" />;
  if (outcome === 'ok') return <CheckCircleIcon color="success" sx={{ fontSize: 14 }} aria-label="Deployment done" />;
  if (outcome === 'error')
    return <Box component="span" aria-label="Deployment failed" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }} />;
  return null;
}

// The tabs besides the canvas.
function OtherTab({
  tab,
  dirty,
  onOpenTests,
  onReload,
  onSave,
  onShowBlock,
  ...policy
}: {
  dirty: boolean;
  onOpenTests: () => void;
  onReload: () => Promise<void>;
  onSave: () => Promise<boolean>;
  onShowBlock: (fileId: string, id: string) => void;
  tab: number;
} & Parameters<typeof GeneratedPolicyView>[0]) {
  if (tab === 1) return <GeneratedPolicyView {...policy} />;
  if (tab === 3)
    return <DeploymentView compiled={policy.compiled} dirty={dirty} onOpenTests={onOpenTests} onReload={onReload} onSave={onSave} onShowBlock={onShowBlock} />;
  return <TestResultsView onShowBlock={onShowBlock} />;
}

function initialParams(descriptor: BlockDescriptor): Record<string, string> {
  const { parameters } = resolveBlockShape(descriptor, undefined);
  return Object.fromEntries(parameters.map(parameter => [parameter.name, String(parameter.default ?? '')]));
}

// The Properties panel with nothing selected: the open file's settings.
function CurrentFileSettings() {
  const dispatch = useAppDispatch();
  const file = useAppSelector(selectCurrentFile);
  const files = useAppSelector(selectFiles);
  const allInstances = useAppSelector(selectCanvasBlocks);
  if (!file) return null;
  const fileId = file.id;
  return (
    <FileSettingsPanel
      file={file}
      allInstances={allInstances}
      files={files}
      onEnable={() => dispatch(fileConditionEnabled({ fileId }))}
      onRemove={() => dispatch(fileConditionRemoved({ fileId }))}
      onModeChange={mode => dispatch(fileConditionModeChanged({ fileId, mode }))}
      onClassNameChange={className => dispatch(fileConditionClassNameChanged({ fileId, className }))}
      onDescriptionChange={description => dispatch(fileDescriptionChanged({ fileId, description }))}
    />
  );
}

// The pill of a block's own condition, when no other block shares it (so it can move with a mode change).
function soleGateOf(instances: BlockInstance[], instance: BlockInstance, fileId: string): Gate | undefined {
  const condition = instance.condition;
  if (!condition?.className) return undefined;
  const key = gateKey(fileId, instance.instanceId, condition);
  const shared = instances.some(other => other !== instance && other.condition && gateKey(fileId, other.instanceId, other.condition) === key);
  return shared ? undefined : { condition, instanceIds: [instance.instanceId], key, nodeId: '', position: { x: 0, y: 0 } };
}

interface DragPreview {
  badge: string;
  label: string;
}

// Mirrors BlockCard's header so the floating clone under the cursor reads
// as "a block", not an empty rectangle — dnd-kit doesn't render anything by
// itself unless you give it a DragOverlay.
function DragPreviewCard({ badge, label }: DragPreview) {
  const TypeIcon = PROMISE_TYPE_ICONS[badge.toLowerCase()];

  return (
    <Box
      sx={{
        width: 360,
        bgcolor: 'background.default',
        border: '2px solid',
        borderColor: 'primary.main',
        borderRadius: '4px',
        p: 1.5,
        boxShadow: 6,
        cursor: 'grabbing'
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: '6px',
              bgcolor: 'action.hover',
              color: 'text.muted',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            {TypeIcon && <TypeIcon sx={{ fontSize: 18 }} />}
          </Box>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary', wordBreak: 'break-word' }}>{label}</Typography>
        </Box>
        <Typography sx={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: 'text.muted', letterSpacing: 0.5, flexShrink: 0 }}>
          {badge.toUpperCase()}
        </Typography>
      </Box>
    </Box>
  );
}

interface ProjectViewProps {
  // Unsaved changes since the last save (see project/useProjectSession.ts).
  dirty: boolean;
  // An AI agent is working: the editor is locked (viewing only).
  locked: boolean;
  // Opens Connect an AI agent (the MCP server).
  onConnectAgent: () => void;
  onOpenSettings: () => void;
  // Opens the project from disk again (Deployment, after pulling commits into it).
  onReload: () => Promise<void>;
  // Resolves with whether the project ended up saved.
  onSave: () => Promise<boolean>;
}

/** The open project; saving it into cfbs.json is owned by App (project/useProjectSession.ts). */
export default function ProjectView({ dirty, locked, onConnectAgent, onOpenSettings, onReload, onSave }: ProjectViewProps) {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const files = useAppSelector(selectFiles);
  const folders = useAppSelector(selectFolders);
  const currentFileId = useAppSelector(selectCurrentFileId);
  const currentFile = useAppSelector(selectCurrentFile);
  const allInstances = useAppSelector(selectCanvasBlocks);
  const instances = useAppSelector(state => selectBlocksForFile(state, currentFileId));
  const clipboard = useAppSelector(selectClipboard);
  const cutPendingId = useAppSelector(selectCutPendingId);
  const allEdges = useAppSelector(selectEdges);
  const edges = useMemo(() => allEdges.filter(edge => edge.fileId === currentFileId), [allEdges, currentFileId]);
  const derivedPositions = useAppSelector(selectDerivedNodePositions);
  const [activeTab, setActiveTab] = useState(0);
  // Generated Policy shows it; Deployment traces build problems to blocks with its source map.
  const compiled = useCompiledPolicy(activeTab === 1 || activeTab === 3);
  const {
    selectedInstanceId,
    setSelectedInstanceId,
    multiSelectedIds,
    setMultiSelectedIds,
    selectedEdgeId,
    setSelectedEdgeId,
    selectedGateKey,
    setSelectedGateKey,
    focusEntryId,
    setFocusEntryId,
    clear: clearCanvasSelection
  } = useSelection(instances, edges, currentFileId);
  const {
    groups,
    liveGroups,
    selectedGroupId,
    selectedGroup,
    freshGroupId,
    deleteGroupId,
    setDeleteGroupId,
    setSelectedGroupId,
    membersOf,
    createGroup,
    ungroup,
    deleteGroupWithBlocks,
    selectGroup,
    fitFrames,
    canvasCallbacks: groupCanvasCallbacks
  } = useGroupActions({
    announce: message => announce(message),
    currentFileId,
    instances,
    undoKey: UNDO_KEY,
    onGroupCreated: () => {
      setMultiSelectedIds([]);
      setSelectedInstanceId(null);
    }
  });
  const canUndo = useAppSelector(state => state.history.past.length > 0);
  const canRedo = useAppSelector(state => state.history.future.length > 0);
  // In-app "full screen": side panels hidden, properties as an overlay.
  const [maximized, setMaximized] = useState(false);
  // Test Results and Deployment have their own layout: no block palette or Properties panel.
  const showSidebars = !maximized && activeTab < 2;
  const testActivity = useTestActivity();
  // Looking at the Test Results tab acknowledges how the last action ended.
  useEffect(() => {
    if (activeTab === 2 && testActivity.outcome) markTestActivitySeen();
  }, [activeTab, testActivity.outcome]);
  const projectPath = project?.path ?? null;
  const deployActivity = useDeployActivity(projectPath);
  useEffect(() => {
    if (activeTab === 3 && deployActivity.outcome) markDeploySeen(projectPath);
  }, [activeTab, deployActivity.outcome, projectPath]);
  const [addBlockAnchor, setAddBlockAnchor] = useState<HTMLElement | null>(null);
  const [tidyConfirmOpen, setTidyConfirmOpen] = useState(false);
  const [convertTargetId, setConvertTargetId] = useState<string | null>(null);
  // Card sizes as React Flow measures them — used to stack new blocks under
  // the lowest one and for auto-layout, before which estimates stand in.
  const [measured, setMeasured] = useState<NodeSizes>({});
  // The same, minus sizes measured zoomed out (cards hide their rows there): what layout uses.
  const [layoutSizes, setLayoutSizes] = useState<NodeSizes>({});
  const flowRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  // A canvas drag's undo batch is open (closed on drag stop, or if the canvas goes away mid-drag).
  const dragBatchRef = useRef(false);
  const zoomControlsRef = useRef<ZoomControls | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const statusMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { layout, setLayout, commitLayout } = useLayoutSettings();
  // Sidebar/palette widths and heights are stored as fractions of this row so
  // they stay proportional across window sizes; resize handles report deltas
  // in pixels, so convert against the row's *current* measured size.
  const layoutRowRef = useRef<HTMLDivElement>(null);

  const handleLeftResize = (deltaPx: number) => {
    const width = layoutRowRef.current?.clientWidth;
    if (!width) return;
    setLayout(current => ({ ...current, leftSidebarFraction: clamp(current.leftSidebarFraction + deltaPx / width, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX) }));
  };

  const handleRightResize = (deltaPx: number) => {
    const width = layoutRowRef.current?.clientWidth;
    if (!width) return;
    setLayout(current => ({
      ...current,
      rightSidebarFraction: clamp(current.rightSidebarFraction - deltaPx / width, RIGHT_SIDEBAR_MIN, RIGHT_SIDEBAR_MAX)
    }));
  };

  const handlePaletteResize = (deltaPx: number) => {
    const height = layoutRowRef.current?.clientHeight;
    if (!height) return;
    setLayout(current => ({
      ...current,
      paletteHeightFraction: clamp(current.paletteHeightFraction + deltaPx / height, PALETTE_HEIGHT_MIN, PALETTE_HEIGHT_MAX)
    }));
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const sizeOf = (instance: BlockInstance) =>
    layoutSizes[instance.instanceId] ?? { width: NODE_WIDTH, height: estimateNodeHeight(instance, blockDescriptorsById.get(instance.blockId)) };

  // `position` is where the block was dropped; click-to-add (no position)
  // stacks it under the lowest block and pans there, so adding blocks
  // without drawing arrows keeps building a top-to-bottom sequence.
  const addBlockToCanvas = (descriptor: BlockDescriptor, position?: Position) => {
    if (!currentFileId) return;
    const placed = position ?? nextStackPosition(instances, sizeOf);
    // Multi-entry blocks keep their params per entry and always start with one.
    const action = dispatch(
      blockAdded(
        descriptor.entries
          ? { blockId: descriptor.id, fileId: currentFileId, label: descriptor.name, params: {}, entries: [newDefinitionEntry(descriptor)], position: placed }
          : {
              blockId: descriptor.id,
              fileId: currentFileId,
              label: descriptor.name,
              params: initialParams(descriptor),
              valueSourceId: descriptor.value_sources?.[0]?.id,
              position: placed
            }
      )
    );
    if (!position && flowRef.current) {
      flowRef.current.setCenter(placed.x + NODE_WIDTH / 2, placed.y + 80, { zoom: flowRef.current.getZoom(), duration: 200 });
    }
    selectOnly(action.payload.instanceId);
  };

  const handleAddFile = (name: string, parentId: string | null) => {
    dispatch(fileAdded(name, parentId));
  };

  const handleAddFolder = (name: string, parentId: string | null) => {
    dispatch(folderAdded(name, parentId));
  };

  const handleRenameFile = (fileId: string, name: string) => {
    dispatch(fileRenamed({ fileId, name }));
  };

  const handleRenameFolder = (folderId: string, name: string) => {
    dispatch(folderRenamed({ folderId, name }));
  };

  const handleDeleteFile = (fileId: string) => {
    asOneStep(() => {
      dispatch(fileRemoved({ fileId }));
      dispatch(blocksRemovedForFile({ fileId }));
    });
    clearSelection();
  };

  // folderRemoved (filesSlice) only removes files/folders — the caller
  // cleans up canvasSlice's blocks for every removed file, same convention
  // as handleDeleteFile above.
  const handleDeleteFolder = (folderId: string) => {
    const { fileIds } = collectFolderDescendants(files, folders, folderId);
    asOneStep(() => {
      dispatch(folderRemoved({ folderId }));
      for (const fileId of fileIds) dispatch(blocksRemovedForFile({ fileId }));
    });
    clearSelection();
  };

  // Adds a new Define Class block for the condition editor's "+ New class"
  // flow, then points the condition being edited at it. Deliberately doesn't
  // change selectedInstanceId — unlike the palette's addBlockToCanvas, the
  // user's focus should stay on the block whose condition they're editing,
  // not jump to the class they just created.
  const addClassBlock = (definition: NewClassDefinition) => {
    const defineClass = blockDescriptorsById.get('define-class');
    if (!currentFileId || !defineClass) return;
    dispatch(
      blockAdded({
        blockId: 'define-class',
        fileId: currentFileId,
        label: definition.className,
        params: {},
        position: nextStackPosition(instances, sizeOf),
        entries: [
          newDefinitionEntry(defineClass, {
            params: { [defineClass.entries?.name_param ?? 'class_name']: definition.className, ...definition.params },
            valueSourceId: definition.valueSourceId,
            classRefs: definition.classRefs
          })
        ]
      })
    );
  };

  const handleConditionCreateClass = (forInstanceId: string, definition: NewClassDefinition, entryId?: string) => {
    if (!currentFileId || !blockDescriptorsById.get('define-class')) return;
    asOneStep(() => {
      addClassBlock(definition);
      dispatch(conditionClassNameChanged({ instanceId: forInstanceId, entryId, className: definition.className }));
    });
  };

  // dnd-kit only drives dragging blocks *in* from the palette; moving blocks
  // around the canvas is React Flow's own node dragging.
  const handleDragStart = ({ active }: DragStartEvent) => {
    if (active.data.current?.source !== 'palette') return;
    const block = active.data.current.block as BlockDescriptor;
    setDragPreview({ label: block.name, badge: primaryPromiseType(block) ?? '' });
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDragPreview(null);
    if (active.data.current?.source !== 'palette' || over?.id !== CANVAS_DROPPABLE_ID) return;
    const rect = active.rect.current.translated;
    const flow = flowRef.current;
    const dropped = rect && flow ? flow.screenToFlowPosition({ x: rect.left, y: rect.top }) : undefined;
    const snapped = dropped && { x: Math.round(dropped.x / GRID_SIZE) * GRID_SIZE, y: Math.round(dropped.y / GRID_SIZE) * GRID_SIZE };
    addBlockToCanvas(active.data.current.block as BlockDescriptor, snapped);
    setAddBlockAnchor(null);
  };

  // Several dispatches that should undo as one step.
  const asOneStep = (run: () => void) => inOneStep(dispatch, run);

  const clearSelection = () => {
    clearCanvasSelection();
    setSelectedGroupId(null);
  };

  // Selects one block and nothing else, so Delete and Properties act on it.
  const selectOnly = (instanceId: string) => {
    clearSelection();
    setSelectedInstanceId(instanceId);
  };

  const handleRemove = (instanceId: string) => {
    dispatch(blockRemoved({ instanceId }));
    if (selectedInstanceId === instanceId) setSelectedInstanceId(null);
    setSelectedEdgeId(null);
  };

  // Removes only the chain; its block (and variable) stay.
  const removeChain = (owner: ChainOwner) => {
    if (!owner.entryId) return;
    dispatch(dataChainRemoved({ instanceId: owner.instanceId, entryId: owner.entryId }));
    setFocusEntryId(null);
  };

  // A gate is derived from its blocks' conditions, so removing it means
  // removing the condition from each of them.
  const removeGateByKey = (key: string) => {
    if (!currentFileId) return;
    const gate = deriveGates(instances, currentFileId, derivedPositions).find(candidate => candidate.key === key);
    asOneStep(() => {
      for (const instanceId of gate?.instanceIds ?? []) dispatch(conditionRemoved({ instanceId }));
    });
    setSelectedGateKey(null);
  };

  // A gate's key includes its mode: keep a dragged pill where it was, and selected.
  const gateSpotMoved = (fromKey: string, toKey: string) => {
    const stored = derivedPositions[fromKey];
    if (!stored || fromKey === toKey) return;
    dispatch(derivedNodeMoved({ key: toKey, position: stored }));
    dispatch(derivedNodeForgotten({ key: fromKey }));
  };
  const changeGateMode = (gate: Gate, mode: 'if' | 'unless') => {
    if (!currentFileId) return;
    const nextKey = gateKey(currentFileId, gate.instanceIds[0], { ...gate.condition, mode });
    asOneStep(() => {
      for (const instanceId of gate.instanceIds) dispatch(conditionModeChanged({ instanceId, mode }));
      gateSpotMoved(gate.key, nextKey);
    });
    if (selectedGateKey === gate.key) setSelectedGateKey(nextKey);
  };
  // From Properties: a block alone on its pill takes the pill's spot along.
  const handleConditionModeChange = (instance: BlockInstance, mode: 'if' | 'unless', entryId?: string) => {
    const gate = currentFileId && !entryId ? soleGateOf(instances, instance, currentFileId) : undefined;
    if (gate) changeGateMode(gate, mode);
    else dispatch(conditionModeChanged({ instanceId: instance.instanceId, entryId, mode }));
  };

  const handleBindParam = (instanceId: string, param: string, valueSourceId: string) => {
    const source = blockDescriptorsById.get('define-variable')?.value_sources?.find(candidate => candidate.id === valueSourceId);
    const params = Object.fromEntries((source?.parameters ?? []).map(parameter => [parameter.name, String(parameter.default ?? '')]));
    dispatch(paramBound({ instanceId, param, binding: { valueSourceId, params, decorators: [] } }));
  };

  // Run Command → a Define Variable reading the same command's output
  // (execresult), in the same spot. The action is gone: it leaves the run
  // order, and its arrows go with it (vars are evaluated before any action).
  const convertRunCommandToData = (instanceId: string) => {
    const source = instances.find(instance => instance.instanceId === instanceId);
    const defineVariable = blockDescriptorsById.get('define-variable');
    if (!source || !defineVariable || !currentFileId) return;
    const taken = definedNames(instances, 'define-variable', defineVariable);
    let name = 'command_output';
    for (let suffix = 2; taken.has(name); suffix += 1) name = `command_output_${suffix}`;
    let addedId = '';
    asOneStep(() => {
      const action = dispatch(
        blockAdded({
          blockId: 'define-variable',
          fileId: currentFileId,
          label: `${source.label} output`,
          params: {},
          position: source.position,
          condition: source.condition,
          entries: [
            newDefinitionEntry(defineVariable, {
              valueSourceId: 'command-output',
              params: { [defineVariable.entries?.name_param ?? 'variable_name']: name, command: source.params.command ?? '', shell_mode: 'useshell' }
            })
          ]
        })
      );
      dispatch(blockRemoved({ instanceId }));
      addedId = action.payload.instanceId;
    });
    selectOnly(addedId);
    setConvertTargetId(null);
    announce(`"${source.label}" is now the variable $(vars.${name})`);
  };

  const handleMultiSelect = (instanceIds: string[]) => {
    setSelectedGroupId(null);
    setMultiSelectedIds(instanceIds.length > 1 ? instanceIds : []);
    setSelectedInstanceId(instanceIds.length === 1 ? instanceIds[0] : null);
    setFocusEntryId(null);
    setSelectedEdgeId(null);
    setSelectedGateKey(null);
  };

  const handleBatchDelete = () => {
    asOneStep(() => {
      for (const instanceId of multiSelectedIds) dispatch(blockRemoved({ instanceId }));
    });
    announce(`Deleted ${multiSelectedIds.length} blocks — ${UNDO_KEY} to undo`);
    setMultiSelectedIds([]);
  };

  const handleSelectGroup = (groupId: string | null) => {
    selectGroup(groupId);
    if (!groupId) return;
    setSelectedInstanceId(null);
    setMultiSelectedIds([]);
    setSelectedEdgeId(null);
    setSelectedGateKey(null);
  };

  // A block or group of the open file, selected (Generated Policy and Problems link to them).
  const selectInFile = (id: string) => {
    if (groups.some(group => group.id === id)) handleSelectGroup(id);
    else {
      handleSelectGroup(null);
      setSelectedInstanceId(id);
    }
  };

  const handleTidy = () => {
    asOneStep(() => {
      dispatch(blocksMoved({ positions: tidyPositions(instances, edges, groups, currentFileId, sizeOf, nodeId => measured[nodeId]?.height) }));
      // Gates and data-chain nodes go back to their default spots beside their blocks.
      if (currentFileId) dispatch(derivedNodePositionsClearedForFile({ fileId: currentFileId }));
      // Frames go back to hugging their (re-laid-out) blocks.
      fitFrames(groups.map(group => group.id));
    });
    setTidyConfirmOpen(false);
    requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.2, maxZoom: 1, duration: 300 }));
  };

  const announce = (message: string) => {
    setStatusMessage(message);
    if (statusMessageTimeoutRef.current) clearTimeout(statusMessageTimeoutRef.current);
    statusMessageTimeoutRef.current = setTimeout(() => setStatusMessage(null), 2500);
  };

  const { handleCopyBlock, handleCutBlock, handlePasteBlock } = useClipboardActions({
    announce,
    asOneStep,
    currentFileId,
    instances,
    onPasted: selectOnly,
    sizeOf
  });

  // Another file (picked, or brought back by undo) while dragging: close the drag's undo
  // batch rather than leave it swallowing every later step. (Selection resets in useSelection.)
  useEffect(() => {
    if (!dragBatchRef.current) return;
    dragBatchRef.current = false;
    dispatch(historyBatchEnded());
  }, [currentFileId, dispatch]);

  useEffect(() => () => clearTimeout(statusMessageTimeoutRef.current), []);

  const duplicateKeys = useMemo(() => duplicateDefinitionKeys(allInstances, blockDescriptorsById, currentFileId), [allInstances, currentFileId]);

  const handleEscape = () => {
    if (selectedGroup) setSelectedGroupId(null);
    else if (multiSelectedIds.length > 0) setMultiSelectedIds([]);
    else if (clipboard.mode === 'cut' && clipboard.snapshot) {
      dispatch(clipboardCleared());
      announce('Cut cancelled');
    } else if (maximized) setMaximized(false);
  };

  // Delete/Backspace: the selected group (ungroups), blocks, link, pill, arrow, data chain, else block.
  const handleDeleteKey = (): boolean => {
    if (selectedGroup) ungroup(selectedGroup.id);
    else if (multiSelectedIds.length > 0) handleBatchDelete();
    else if (selectedEdgeId?.startsWith(GATE_EDGE_PREFIX)) {
      dispatch(conditionRemoved({ instanceId: selectedEdgeId.slice(GATE_EDGE_PREFIX.length) }));
      setSelectedEdgeId(null);
    } else if (selectedGateKey) removeGateByKey(selectedGateKey);
    else if (selectedEdgeId) {
      dispatch(edgeRemoved({ edgeId: selectedEdgeId }));
      setSelectedEdgeId(null);
    } else if (selectedInstanceId && focusEntryId) removeChain({ instanceId: selectedInstanceId, entryId: focusEntryId });
    else if (selectedInstanceId) handleRemove(selectedInstanceId);
    else return false;
    return true;
  };

  const handleHistoryKey = (redo: boolean) => {
    if (redo ? !canRedo : !canUndo) return announce(redo ? 'Nothing to redo' : 'Nothing to undo');
    dispatch(redo ? redone() : undone());
    announce(redo ? 'Redone' : 'Undone');
  };

  // Copy and cut take one block; with several selected they only explain that.
  const copyOrCutKey = (handle: (instanceId: string) => void): boolean => {
    if (multiSelectedIds.length > 0) announce('Copy and cut work on one block at a time');
    else if (selectedInstanceId) handle(selectedInstanceId);
    else return false;
    return true;
  };

  useMcpCanvas({
    selectedInstanceId,
    sizeOf,
    nodeHeight: nodeId => measured[nodeId]?.height,
    fitView: () => requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.2, maxZoom: 1, duration: 300 })),
    openFile: fileId => {
      dispatch(fileSelected({ fileId }));
      setActiveTab(0);
    },
    showTests: () => setActiveTab(2)
  });

  useKeyboardShortcuts({
    locked,
    canvasActive: activeTab === 0,
    zoomControlsRef,
    onEscape: handleEscape,
    onSave,
    onDelete: handleDeleteKey,
    onUndo: () => handleHistoryKey(false),
    onRedo: () => handleHistoryKey(true),
    // ⌘G groups the selection; ⌘⇧G ungroups the selected group (or the selected block's).
    onGroup: () => createGroup(selectionOf(multiSelectedIds, selectedInstanceId)),
    onUngroup: () => {
      const groupId = selectedGroup?.id ?? instances.find(instance => instance.instanceId === selectedInstanceId)?.groupId;
      if (groupId) ungroup(groupId);
    },
    onCopy: () => copyOrCutKey(handleCopyBlock),
    onCut: () => copyOrCutKey(handleCutBlock),
    onPaste: () => {
      if (!clipboard.snapshot) return false;
      handlePasteBlock();
      return true;
    }
  });

  if (!project) return null;

  const selectedInstance = instances.find(instance => instance.instanceId === selectedInstanceId);
  const selectedDescriptor = selectedInstance ? blockDescriptorsById.get(selectedInstance.blockId) : undefined;
  const order = executionOrder(instances, edges, blockDescriptorsById);
  const orderNumberOf = (instanceId: string) => {
    const index = order.indexOf(instanceId);
    return index === -1 ? undefined : index + 1;
  };
  const selectedOrderNumber = selectedInstance ? orderNumberOf(selectedInstance.instanceId) : undefined;
  const incomingArrowsOf = (targetId: string) =>
    edges
      .filter(edge => edge.target === targetId)
      .map(edge => {
        const group = groups.find(candidate => candidate.id === edge.source);
        return {
          edgeId: edge.id,
          outcomes: edge.outcomes,
          sourceLabel: group ? `group ${group.name}` : (instances.find(instance => instance.instanceId === edge.source)?.label ?? '(missing block)'),
          sourceOrder: orderNumberOf(edge.source)
        };
      });
  const incomingArrows = selectedInstance ? incomingArrowsOf(selectedInstance.instanceId) : [];

  const propertiesContent = (
    <>
      <Box sx={{ py: 1.5, px: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'text.primary' }}>Properties</Typography>
        {selectedDescriptor?.description && <Typography sx={{ fontSize: 12, color: 'text.muted', mt: 0.5 }}>{selectedDescriptor.description}</Typography>}
      </Box>
      {selectedGroup ? (
        <GroupPanel
          key={selectedGroup.id}
          group={selectedGroup}
          members={membersOf(selectedGroup.id)}
          condition={
            <ConditionSection
              condition={selectedGroup.condition}
              scope="this group"
              classNameOptions={buildClassNameOptions(allInstances, new Map(files.map(file => [file.id, file])), currentFileId)}
              templateTokens={[]}
              onEnable={() => dispatch(groupConditionEnabled({ groupId: selectedGroup.id }))}
              onRemove={() => dispatch(groupConditionRemoved({ groupId: selectedGroup.id }))}
              onModeChange={mode => dispatch(groupConditionModeChanged({ groupId: selectedGroup.id, mode }))}
              onClassNameChange={className => dispatch(groupConditionClassNameChanged({ groupId: selectedGroup.id, className }))}
            />
          }
          runsWhen={
            <RunsWhenSection
              arrows={incomingArrowsOf(selectedGroup.id)}
              mode={selectedGroup.incomingMode ?? 'all'}
              onModeChange={mode => dispatch(groupIncomingModeChanged({ groupId: selectedGroup.id, mode }))}
              onOutcomesChange={(edgeId, outcomes) => dispatch(edgeOutcomesChanged({ edgeId, outcomes }))}
              onRemove={edgeId => dispatch(edgeRemoved({ edgeId }))}
            />
          }
          orderOf={orderNumberOf}
          autoFocusName={freshGroupId === selectedGroup.id}
          onRename={name => dispatch(groupRenamed({ groupId: selectedGroup.id, name }))}
          onColorChange={color => dispatch(groupColorChanged({ groupId: selectedGroup.id, color }))}
          onSelectMember={instanceId => {
            setSelectedGroupId(null);
            setSelectedInstanceId(instanceId);
          }}
          onUngroup={() => ungroup(selectedGroup.id)}
          onDeleteWithBlocks={() => setDeleteGroupId(selectedGroup.id)}
          onFit={() => fitFrames([selectedGroup.id])}
        />
      ) : multiSelectedIds.length > 0 ? (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{multiSelectedIds.length} blocks selected</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.muted' }}>
            Drag any of them to move them together. Shift+click adds or removes a block; Esc clears the selection. Delete removes them ({UNDO_KEY}
            undoes it).
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" onClick={() => createGroup(multiSelectedIds)}>
              Group them ({GROUP_KEY})
            </Button>
            <Button color="error" variant="outlined" size="small" onClick={handleBatchDelete}>
              Delete {multiSelectedIds.length} blocks
            </Button>
          </Stack>
        </Box>
      ) : (
        <>
          {selectedInstance && (
            <BlockGroupRow
              instance={selectedInstance}
              groups={liveGroups}
              onJoin={groupId => dispatch(blockGroupChanged({ instanceIds: [selectedInstance.instanceId], groupId }))}
              onLeave={() => dispatch(blockGroupChanged({ instanceIds: [selectedInstance.instanceId], groupId: null }))}
              onNewGroup={() => createGroup([selectedInstance.instanceId])}
              onOpen={groupId => {
                setSelectedInstanceId(null);
                setSelectedGroupId(groupId);
              }}
            />
          )}
          <PropertiesPanel
            // Remounts on selection change so section-expanded defaults
            // (Condition/Inventory/Data transformation start open only
            // when they already have something set) recompute per block,
            // instead of an earlier block's expand/collapse state leaking
            // onto whichever block is selected next.
            key={`${selectedInstance?.instanceId ?? 'none'}:${focusEntryId ?? ''}`}
            focusEntryId={focusEntryId ?? undefined}
            onBindParam={(param, valueSourceId) => selectedInstance && handleBindParam(selectedInstance.instanceId, param, valueSourceId)}
            onUnbindParam={param => selectedInstance && dispatch(paramUnbound({ instanceId: selectedInstance.instanceId, param }))}
            onConvertToData={selectedInstance?.blockId === 'run-command' ? () => setConvertTargetId(selectedInstance.instanceId) : undefined}
            instance={selectedInstance}
            descriptor={selectedDescriptor}
            emptyState={<CurrentFileSettings />}
            allInstances={allInstances}
            files={files}
            currentFileId={currentFileId}
            orderNumber={selectedOrderNumber}
            incomingArrows={incomingArrows}
            onIncomingModeChange={mode => selectedInstance && dispatch(incomingModeChanged({ instanceId: selectedInstance.instanceId, mode }))}
            onArrowOutcomesChange={(edgeId, outcomes) => dispatch(edgeOutcomesChanged({ edgeId, outcomes }))}
            onArrowRemove={edgeId => dispatch(edgeRemoved({ edgeId }))}
            onLabelChange={label => selectedInstance && dispatch(blockLabelChanged({ instanceId: selectedInstance.instanceId, label }))}
            onParamChange={(paramName, value, entryId) =>
              selectedInstance && dispatch(blockParamChanged({ instanceId: selectedInstance.instanceId, entryId, paramName, value }))
            }
            onValueSourceChange={(valueSourceId, entryId) =>
              selectedInstance && dispatch(blockValueSourceChanged({ instanceId: selectedInstance.instanceId, entryId, valueSourceId }))
            }
            onEntryAdd={() => {
              if (!selectedInstance || !selectedDescriptor) return '';
              const entry = newDefinitionEntry(selectedDescriptor);
              dispatch(entryAdded({ instanceId: selectedInstance.instanceId, entry }));
              return entry.id;
            }}
            onEntryRemove={entryId => selectedInstance && dispatch(entryRemoved({ instanceId: selectedInstance.instanceId, entryId }))}
            onEntryMove={(fromIndex, toIndex) => selectedInstance && dispatch(entryMoved({ instanceId: selectedInstance.instanceId, fromIndex, toIndex }))}
            onDecoratorAdd={(decoratorId, entryId) => selectedInstance && dispatch(decoratorAdded(selectedInstance.instanceId, decoratorId, entryId))}
            onDecoratorRemove={(decoratorInstanceId, entryId) =>
              selectedInstance && dispatch(decoratorRemoved({ instanceId: selectedInstance.instanceId, entryId, decoratorInstanceId }))
            }
            onDecoratorParamChange={(decoratorInstanceId, paramName, value, entryId) =>
              selectedInstance && dispatch(decoratorParamChanged({ instanceId: selectedInstance.instanceId, entryId, decoratorInstanceId, paramName, value }))
            }
            onDecoratorMove={(fromIndex, toIndex, entryId) =>
              selectedInstance && dispatch(decoratorMoved({ instanceId: selectedInstance.instanceId, entryId, fromIndex, toIndex }))
            }
            onClassRefAdd={entryId => selectedInstance && dispatch(classRefAdded(selectedInstance.instanceId, entryId))}
            onClassRefRemove={(classRefId, entryId) =>
              selectedInstance && dispatch(classRefRemoved({ instanceId: selectedInstance.instanceId, entryId, classRefId }))
            }
            onClassRefChange={(classRefId, patch, entryId) =>
              selectedInstance && dispatch(classRefChanged({ instanceId: selectedInstance.instanceId, entryId, classRefId, ...patch }))
            }
            onConditionEnable={entryId => selectedInstance && dispatch(conditionEnabled({ instanceId: selectedInstance.instanceId, entryId }))}
            onConditionRemove={entryId => selectedInstance && dispatch(conditionRemoved({ instanceId: selectedInstance.instanceId, entryId }))}
            onConditionModeChange={(mode, entryId) => selectedInstance && handleConditionModeChange(selectedInstance, mode, entryId)}
            onConditionClassNameChange={(className, entryId) =>
              selectedInstance && dispatch(conditionClassNameChanged({ instanceId: selectedInstance.instanceId, entryId, className }))
            }
            onConditionCreateClass={(definition, entryId) => selectedInstance && handleConditionCreateClass(selectedInstance.instanceId, definition, entryId)}
            onCreateClass={addClassBlock}
            onInventoryEnable={entryId => selectedInstance && dispatch(inventoryEnabled({ instanceId: selectedInstance.instanceId, entryId }))}
            onInventoryRemove={entryId => selectedInstance && dispatch(inventoryRemoved({ instanceId: selectedInstance.instanceId, entryId }))}
            onInventoryAttributeNameChange={(attributeName, entryId) =>
              selectedInstance && dispatch(inventoryAttributeNameChanged({ instanceId: selectedInstance.instanceId, entryId, attributeName }))
            }
          />
        </>
      )}
    </>
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setDragPreview(null)}>
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}>
        <TopBar
          projectName={project.name}
          dirty={dirty}
          masterfiles={project.masterfiles}
          namespace={currentFile?.namespace ?? ''}
          fileGate={describeFileCondition(currentFile?.condition)}
          blockCount={instances.length}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          tabBadges={{ 2: <TestActivityBadge />, 3: <DeployActivityBadge path={project.path} /> }}
          onSave={onSave}
          onOpenSettings={onOpenSettings}
          onConnectAgent={onConnectAgent}
          locked={locked}
          savedToDisk={Boolean(project.path)}
          type={project.type}
        />

        <Box ref={layoutRowRef} sx={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          {locked && <AgentLock />}
          {showSidebars && (
            <>
              <Box
                sx={{
                  width: `${layout.leftSidebarFraction * 100}%`,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  bgcolor: 'background.paper'
                }}
              >
                <Box sx={{ height: `${layout.paletteHeightFraction * 100}%`, minHeight: 0, flexShrink: 0 }}>
                  <BlockPalette onAddBlock={addBlockToCanvas} />
                </Box>
                <ResizeHandle label="Resize block palette" orientation="horizontal" onResize={handlePaletteResize} onResizeEnd={commitLayout} />
                <Box sx={{ flex: 1, minHeight: 0 }}>
                  <PolicyFileExplorer
                    files={files}
                    folders={folders}
                    currentFileId={currentFileId}
                    instances={allInstances}
                    onSelectFile={fileId => {
                      dispatch(fileSelected({ fileId }));
                      setSelectedInstanceId(null);
                    }}
                    onAddFile={handleAddFile}
                    onAddFolder={handleAddFolder}
                    onRenameFile={handleRenameFile}
                    onRenameFolder={handleRenameFolder}
                    onDeleteFile={handleDeleteFile}
                    onDeleteFolder={handleDeleteFolder}
                  />
                </Box>
              </Box>
              <ResizeHandle label="Resize left sidebar" orientation="vertical" onResize={handleLeftResize} onResizeEnd={commitLayout} />
            </>
          )}

          {activeTab === 0 ? (
            <FlowCanvas
              // One React Flow per file: remounting fits the view to the file just opened.
              key={currentFileId ?? 'none'}
              allInstances={allInstances}
              instances={instances}
              edges={edges}
              files={files}
              currentFileId={currentFileId}
              derivedPositions={derivedPositions}
              selectedGateKey={selectedGateKey}
              onSelectGate={key => {
                setSelectedGateKey(key);
                if (key) {
                  setMultiSelectedIds([]);
                  setSelectedInstanceId(null);
                  setSelectedEdgeId(null);
                }
              }}
              onDerivedMove={(key, position) => dispatch(derivedNodeMoved({ key, position }))}
              dataCallbacks={{
                open: owner => {
                  setMultiSelectedIds([]);
                  setSelectedInstanceId(owner.instanceId);
                  setFocusEntryId(owner.entryId ?? null);
                  setSelectedEdgeId(null);
                  setSelectedGateKey(null);
                },
                remove: removeChain,
                addStep: (owner, decoratorId) => dispatch(decoratorAdded(owner.instanceId, decoratorId, owner.entryId)),
                moveStep: (owner, fromIndex, toIndex) => dispatch(decoratorMoved({ instanceId: owner.instanceId, entryId: owner.entryId, fromIndex, toIndex })),
                removeStep: (owner, decoratorInstanceId) =>
                  dispatch(decoratorRemoved({ instanceId: owner.instanceId, entryId: owner.entryId, decoratorInstanceId })),
                sampleChange: (owner, value) => dispatch(sampleInputChanged({ instanceId: owner.instanceId, entryId: owner.entryId, value }))
              }}
              onGateLink={(gate, instanceId) => {
                const target = instances.find(instance => instance.instanceId === instanceId);
                if (target?.condition?.className) announce(`Replaced "${target.label}"'s previous condition`);
                dispatch(conditionSet({ instanceId, condition: gate.condition }));
              }}
              onGateLinkRemove={instanceId => {
                dispatch(conditionRemoved({ instanceId }));
                setSelectedEdgeId(null);
              }}
              onGateModeChange={(gate, mode) => changeGateMode(gate, mode)}
              onGateRemove={gate => removeGateByKey(gate.key)}
              onFileConditionRemove={() => currentFile && dispatch(fileConditionRemoved({ fileId: currentFile.id }))}
              duplicateKeys={duplicateKeys}
              cutPendingId={cutPendingId}
              measured={measured}
              maximized={maximized}
              selectedInstanceId={selectedInstanceId}
              selectedChainEntryId={focusEntryId}
              multiSelectedIds={multiSelectedIds}
              onMultiSelect={handleMultiSelect}
              groups={groups}
              selectedGroupId={selectedGroupId}
              onSelectGroup={handleSelectGroup}
              {...groupCanvasCallbacks}
              selectedEdgeId={selectedEdgeId}
              onInit={instance => {
                flowRef.current = instance;
              }}
              onSelectInstance={instanceId => (instanceId ? selectOnly(instanceId) : clearSelection())}
              onSelectEdge={edgeId => {
                setSelectedEdgeId(edgeId);
                if (edgeId) {
                  setMultiSelectedIds([]);
                  setSelectedInstanceId(null);
                  setSelectedGateKey(null);
                }
              }}
              onRemove={handleRemove}
              onMove={(instanceId, position) => dispatch(blockMoved({ instanceId, position }))}
              onNodeDragStart={() => {
                dragBatchRef.current = true;
                dispatch(historyBatchStarted());
              }}
              onNodeDragStop={() => {
                dragBatchRef.current = false;
                dispatch(historyBatchEnded());
              }}
              onMeasured={(sizes, compact) => {
                setMeasured(current => ({ ...current, ...sizes }));
                if (!compact) setLayoutSizes(current => ({ ...current, ...sizes }));
              }}
              onConnect={(source, target, outcomes) => currentFileId && dispatch(edgeAdded({ fileId: currentFileId, source, target, outcomes }))}
              onEdgeOutcomesChange={(edgeId, outcomes) => dispatch(edgeOutcomesChanged({ edgeId, outcomes }))}
              onEdgeRemove={edgeId => {
                dispatch(edgeRemoved({ edgeId }));
                if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
              }}
              onInvalidConnection={announce}
              onTidy={() => setTidyConfirmOpen(true)}
              onToggleMaximize={() => setMaximized(current => !current)}
              zoomControlsRef={zoomControlsRef}
              toolbarExtra={
                maximized && (
                  <Button size="small" startIcon={<AddIcon />} onClick={event => setAddBlockAnchor(event.currentTarget)}>
                    Add block
                  </Button>
                )
              }
            />
          ) : (
            <OtherTab
              tab={activeTab}
              onSave={onSave}
              onReload={onReload}
              dirty={dirty}
              onOpenTests={() => setActiveTab(2)}
              compiled={compiled}
              currentFileId={currentFileId}
              selectedId={selectedGroupId ?? selectedInstanceId}
              onSelect={id => selectInFile(id)}
              onFollow={(fileId, id) => {
                dispatch(fileSelected({ fileId }));
                selectInFile(id);
              }}
              onShowBlock={(fileId, id) => {
                // A problem's block (or group) on the canvas, selected.
                dispatch(fileSelected({ fileId }));
                setActiveTab(0);
                selectInFile(id);
              }}
            />
          )}

          {showSidebars && (
            <>
              <ResizeHandle label="Resize properties panel" orientation="vertical" onResize={handleRightResize} onResizeEnd={commitLayout} />
              <Box
                sx={{
                  width: `${layout.rightSidebarFraction * 100}%`,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  bgcolor: 'background.paper'
                }}
              >
                {propertiesContent}
              </Box>
            </>
          )}

          {maximized && (selectedInstance || selectedGroup || multiSelectedIds.length > 0) && (
            <Paper
              elevation={8}
              sx={{
                position: 'absolute',
                top: 12,
                right: 12,
                bottom: 12,
                width: 400,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                bgcolor: 'background.paper',
                zIndex: 5
              }}
            >
              {propertiesContent}
            </Paper>
          )}
        </Box>

        <Popover
          open={Boolean(addBlockAnchor)}
          anchorEl={addBlockAnchor}
          onClose={() => setAddBlockAnchor(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          <Box sx={{ width: 300, height: 460, display: 'flex', flexDirection: 'column' }}>
            <BlockPalette
              onAddBlock={descriptor => {
                addBlockToCanvas(descriptor);
                setAddBlockAnchor(null);
              }}
            />
          </Box>
        </Popover>

        <ConfirmDialog
          open={convertTargetId !== null}
          title="Use this command's output as data?"
          message="The block becomes a variable holding the command's output, which you can transform and feed into other blocks. It stops being an action: it leaves the run order and its arrows are removed, because variables are evaluated before any action runs."
          confirmLabel="Convert"
          onCancel={() => setConvertTargetId(null)}
          onConfirm={() => convertTargetId && convertRunCommandToData(convertTargetId)}
        />

        <ConfirmDialog
          open={deleteGroupId !== null}
          title="Delete the group and its blocks?"
          message={`The frame and its ${membersOf(deleteGroupId ?? '').length} blocks are removed, along with their arrows. ${UNDO_KEY} brings them back. To keep the blocks, use Ungroup instead.`}
          confirmLabel="Delete"
          onCancel={() => setDeleteGroupId(null)}
          onConfirm={() => deleteGroupId && deleteGroupWithBlocks(deleteGroupId)}
        />

        <ConfirmDialog
          open={tidyConfirmOpen}
          title="Tidy up this canvas?"
          message="Lays out every block on this canvas top to bottom. Arrows and the execution order stay exactly the same, but positions you placed by hand are replaced."
          confirmLabel="Tidy up"
          onCancel={() => setTidyConfirmOpen(false)}
          onConfirm={handleTidy}
        />

        <StatusBar
          left={
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography sx={{ fontSize: 11, color: 'text.muted' }}>{statusMessage ?? 'Ready'}</Typography>
              <Typography sx={{ fontSize: 11, color: 'divider' }}>|</Typography>
              <ProjectStatusLabel project={project} />
              <Typography sx={{ fontSize: 11, color: 'divider' }}>|</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.muted' }}>File: {currentFile ? `${currentFile.name}.cf` : '—'}</Typography>
              <Typography sx={{ fontSize: 11, color: 'divider' }}>|</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.muted' }}>Namespace: {currentFile?.namespace ?? '—'}</Typography>
              <Typography sx={{ fontSize: 11, color: 'divider' }}>|</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.muted' }}>{PROJECT_TABS[activeTab]}</Typography>
            </Stack>
          }
          right={
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography sx={{ fontSize: 11, color: 'text.muted' }}>Blocks: {instances.length}</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.muted', fontFamily: 'monospace' }}>CFEngine x.xx.xx</Typography>
            </Stack>
          }
        />
      </Box>
      <DragOverlay>{dragPreview && <DragPreviewCard label={dragPreview.label} badge={dragPreview.badge} />}</DragOverlay>
    </DndContext>
  );
}
