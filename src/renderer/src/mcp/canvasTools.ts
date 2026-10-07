import { newDefinitionEntry } from '../blocks/definitionEntries';
import { blockDescriptors, blockDescriptorsById } from '../blocks/loadBlocks';
import { resolveBlockShape } from '../blocks/resolveBlockShape';
import type { BlockDescriptor } from '../blocks/types';
import { executionOrder, isSequenced, wouldCreateCycle } from '../canvas/executionOrder';
import { nextStackPosition } from '../canvas/layout';
import { tidyPositions } from '../canvas/tidy';
import { toCfbsProject } from '../project/cfbsProject';
import { compiledPart } from '../project/useCompiledPolicy';
import type { RootState } from '../store';
import { blockAdded, blockLabelChanged, blockParamChanged, blockRemoved, blocksMoved, conditionRemoved, conditionSet } from '../store/canvasSlice';
import type { BlockInstance, Condition } from '../store/canvasSlice/types';
import { derivedNodePositionsClearedForFile } from '../store/derivedNodesSlice';
import { edgeAdded, edgeRemoved } from '../store/edgesSlice';
import type { BlockOutcome } from '../store/edgesSlice/types';
import { groupFramesFitted } from '../store/groupsSlice';
import { inOneStep } from '../store/history';
import { asRecord, checkedParams, parameterView, valueProblem } from './params';
import { type CanvasEnv, type Input, type Tool, ToolError, canvasOf, optionalStr, str } from './shared';

/** Blocks and arrows (src/main/mcpTools/canvas.ts names them): edits are store actions, one undo step per call. */

const conditionText = (condition?: Condition) => (condition?.className.trim() ? `${condition.mode} ${condition.className.trim()}` : undefined);

const descriptorOf = (blockType: string): BlockDescriptor => {
  const descriptor = blockDescriptorsById.get(blockType);
  if (!descriptor) throw new ToolError(`No block type ${blockType}; list_block_types lists them`);
  return descriptor;
};

function fileOf(state: RootState, fileId: string) {
  const file = state.files.files.find(item => item.id === fileId);
  if (!file) throw new ToolError(`No file ${fileId}; get_project_overview lists them`);
  return file;
}

function blockOf(state: RootState, blockId: string): BlockInstance {
  const block = state.canvas.find(item => item.instanceId === blockId);
  if (!block) throw new ToolError(`No block ${blockId}`);
  return block;
}

function projectOverview(state: RootState, env: CanvasEnv) {
  const { files, folders, currentFileId } = state.files;
  const folderPath = (folderId: string | null) => {
    const names: string[] = [];
    for (let folder = folders.find(item => item.id === folderId); folder; folder = folders.find(item => item.id === folder?.parentId))
      names.unshift(folder.name);
    return names.length ? names.join('/') : undefined;
  };
  const selected = state.canvas.find(block => block.instanceId === env.selectedInstanceId);
  return {
    project: state.project?.name ?? null,
    files: files.map(file => {
      const counts: Record<string, number> = {};
      for (const block of state.canvas.filter(item => item.fileId === file.id)) {
        const name = blockDescriptorsById.get(block.blockId)?.name ?? block.blockId;
        counts[name] = (counts[name] ?? 0) + 1;
      }
      return {
        id: file.id,
        name: file.name,
        namespace: file.namespace,
        folder: folderPath(file.parentId),
        condition: conditionText(file.condition),
        description: file.description || undefined,
        blocks: counts,
        groups: state.groups.filter(group => group.fileId === file.id).map(group => ({ id: group.id, name: group.name }))
      };
    }),
    openFileId: currentFileId,
    selectedBlock: selected ? { id: selected.instanceId, label: selected.label, fileId: selected.fileId } : null
  };
}

function fileDetail(state: RootState, fileId: string) {
  const file = fileOf(state, fileId);
  const blocks = state.canvas.filter(block => block.fileId === fileId);
  const edges = state.edges.filter(edge => edge.fileId === fileId);
  const order = executionOrder(blocks, edges, blockDescriptorsById);
  const byOrder = [...blocks].sort((a, b) => (order.indexOf(a.instanceId) + 1 || Infinity) - (order.indexOf(b.instanceId) + 1 || Infinity));
  return {
    id: file.id,
    name: file.name,
    namespace: file.namespace,
    condition: conditionText(file.condition),
    blocks: byOrder.map(block => ({
      id: block.instanceId,
      label: block.label,
      type: block.blockId,
      runOrder: order.indexOf(block.instanceId) + 1 || undefined,
      params: block.entries ? undefined : block.params,
      valueSource: block.valueSourceId,
      entries: block.entries?.map(entry => ({
        id: entry.id,
        valueSource: entry.valueSourceId,
        params: entry.params,
        condition: conditionText(entry.condition)
      })),
      condition: conditionText(block.condition),
      group: block.groupId
    })),
    arrows: edges.map(edge => ({ source: edge.source, target: edge.target, outcomes: edge.outcomes })),
    groups: state.groups.filter(group => group.fileId === fileId).map(group => ({ id: group.id, name: group.name, condition: conditionText(group.condition) }))
  };
}

function blockType(blockTypeId: string) {
  const descriptor = descriptorOf(blockTypeId);
  const parameter = parameterView;

  return {
    id: descriptor.id,
    name: descriptor.name,
    description: descriptor.description,
    takesArrows: isSequenced(descriptor),
    parameters: (descriptor.parameters ?? []).map(parameter),
    valueSources: descriptor.value_sources?.map(source => ({ id: source.id, label: source.label, parameters: source.parameters.map(parameter) })),
    entries: descriptor.entries ? 'Holds a list of entries (one variable or class each): see list_value_sources, add_entry and update_entry.' : undefined
  };
}

function warnings(state: RootState) {
  const missing = state.canvas.flatMap(block => {
    const descriptor = blockDescriptorsById.get(block.blockId);
    if (!descriptor || block.entries) return [];
    const parameters = resolveBlockShape(descriptor, block.valueSourceId).parameters.filter(param => !block.paramBindings?.[param.name]);
    const empty = parameters.filter(param => param.required && !block.params[param.name]?.trim()).map(param => param.label ?? param.name);
    const invalid = parameters.flatMap(param => {
      const value = block.params[param.name] ?? '';
      const problem = param.type === 'cases' || !value ? undefined : valueProblem(param, value);
      return problem ? [`${param.name} ${problem}`] : [];
    });
    return empty.length || invalid.length
      ? [
          {
            blockId: block.instanceId,
            label: block.label,
            fileId: block.fileId,
            ...(empty.length ? { missing: empty } : {}),
            ...(invalid.length ? { invalid } : {})
          }
        ]
      : [];
  });
  return { blocks: missing };
}

// One file's policy with the lines each block produced, or (no file) every generated file.
async function generatedPolicy(state: RootState, fileId: string | undefined) {
  if (fileId) fileOf(state, fileId);
  if (!state.project) throw new ToolError('No project is open');
  const content = toCfbsProject({ ...state, testEnvironments: [] }, state.project);
  const compiled = await window.api?.compilePolicy(compiledPart(content.project));
  if (!compiled) throw new ToolError('The policy couldn’t be generated');
  if (!fileId) return { files: compiled.files };
  const path = content.project.files.find(file => file.id === fileId)?.path;
  if (!path) throw new ToolError('The policy couldn’t be generated');
  const lines = Object.entries(compiled.sourceMap[path] ?? {}).map(([id, ranges]) => ({ id, lines: ranges }));
  return { path, policy: compiled.files[path], blocks: lines };
}

// Parameters a block type takes, checked as the Properties form checks them before they're set.
function checkedBlockParams(descriptor: BlockDescriptor, valueSourceId: string | undefined, params: unknown): Record<string, string> {
  return checkedParams(resolveBlockShape(descriptor, valueSourceId).parameters, asRecord(params, 'params'), descriptor.name);
}

function addBlock(env: CanvasEnv, input: Input) {
  const state = env.getState();
  const fileId = str(input, 'fileId');
  fileOf(state, fileId);
  const descriptor = descriptorOf(str(input, 'blockType'));
  if (descriptor.entries && input.params) throw new ToolError(`${descriptor.name} holds entries: add it without params, then add_entry`);
  const valueSourceId = descriptor.value_sources?.[0]?.id;
  const params = checkedBlockParams(descriptor, valueSourceId, input.params);
  const defaults = Object.fromEntries(resolveBlockShape(descriptor, valueSourceId).parameters.map(param => [param.name, String(param.default ?? '')]));
  const position = nextStackPosition(
    state.canvas.filter(block => block.fileId === fileId),
    env.sizeOf
  );
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : descriptor.name;
  env.openFile(fileId);
  let instanceId = '';
  inOneStep(env.dispatch, () => {
    const action = env.dispatch(
      blockAdded(
        descriptor.entries
          ? { blockId: descriptor.id, fileId, label, params: {}, entries: [newDefinitionEntry(descriptor)], position }
          : { blockId: descriptor.id, fileId, label, params: { ...defaults, ...params }, valueSourceId, position }
      )
    );
    instanceId = action.payload.instanceId;
  });
  return { id: instanceId, label };
}

function updateBlock(env: CanvasEnv, input: Input) {
  const block = blockOf(env.getState(), str(input, 'blockId'));
  const descriptor = descriptorOf(block.blockId);
  if (block.entries && input.params) throw new ToolError(`${descriptor.name} holds entries: change them with update_entry`);
  const params = checkedBlockParams(descriptor, block.valueSourceId, input.params);
  const condition = input.condition as { className?: unknown; mode?: unknown } | null | undefined;
  if (condition && (typeof condition.className !== 'string' || (condition.mode !== 'if' && condition.mode !== 'unless'))) {
    throw new ToolError('condition needs a className and a mode of if or unless');
  }
  env.openFile(block.fileId);
  inOneStep(env.dispatch, () => {
    if (typeof input.label === 'string' && input.label.trim()) env.dispatch(blockLabelChanged({ instanceId: block.instanceId, label: input.label.trim() }));
    for (const [paramName, value] of Object.entries(params)) env.dispatch(blockParamChanged({ instanceId: block.instanceId, paramName, value }));
    if (condition === null) env.dispatch(conditionRemoved({ instanceId: block.instanceId }));
    else if (condition) {
      env.dispatch(
        conditionSet({
          instanceId: block.instanceId,
          condition: { kind: 'class', className: condition.className as string, mode: condition.mode as 'if' | 'unless' }
        })
      );
    }
  });
  return { id: block.instanceId, updated: true };
}

function removeBlock(env: CanvasEnv, input: Input) {
  const block = blockOf(env.getState(), str(input, 'blockId'));
  env.openFile(block.fileId);
  inOneStep(env.dispatch, () => env.dispatch(blockRemoved({ instanceId: block.instanceId })));
  return { removed: block.instanceId, label: block.label };
}

// A block or group of the project: its file, whether it takes arrows, its group.
function endpoint(state: RootState, id: string) {
  const group = state.groups.find(item => item.id === id);
  if (group) return { fileId: group.fileId, takesArrows: true, groupId: undefined };
  const block = blockOf(state, id);
  return { fileId: block.fileId, takesArrows: isSequenced(blockDescriptorsById.get(block.blockId)), groupId: block.groupId };
}

const OUTCOMES: BlockOutcome[] = ['kept', 'repaired', 'not_kept'];

function connect(env: CanvasEnv, input: Input) {
  const state = env.getState();
  const [source, target] = [str(input, 'sourceId'), str(input, 'targetId')];
  if (source === target) throw new ToolError('An arrow needs two different blocks');
  const [from, to] = [endpoint(state, source), endpoint(state, target)];
  if (from.fileId !== to.fileId) throw new ToolError('Arrows connect blocks of the same file');
  if (!from.takesArrows || !to.takesArrows) throw new ToolError('Define Variable / Define Class blocks can’t take arrows; use a condition on their classes');
  if (from.groupId !== to.groupId || from.groupId === target || to.groupId === source) {
    throw new ToolError('Arrows can’t cross a group’s edge: connect to the group itself');
  }
  const edges = state.edges.filter(edge => edge.fileId === from.fileId);
  if (edges.some(edge => edge.source === source && edge.target === target)) throw new ToolError('Those are already connected');
  if (wouldCreateCycle(edges, source, target)) throw new ToolError('That arrow would create a loop');
  const outcomes = Array.isArray(input.outcomes) && input.outcomes.length ? (input.outcomes as BlockOutcome[]) : (['kept', 'repaired'] as BlockOutcome[]);
  if (!outcomes.every(outcome => OUTCOMES.includes(outcome))) throw new ToolError('Outcomes are kept, repaired and not_kept');
  env.openFile(from.fileId);
  inOneStep(env.dispatch, () => env.dispatch(edgeAdded({ fileId: from.fileId, source, target, outcomes })));
  return { connected: { source, target, outcomes } };
}

function disconnect(env: CanvasEnv, input: Input) {
  const [source, target] = [str(input, 'sourceId'), str(input, 'targetId')];
  const edge = env.getState().edges.find(item => item.source === source && item.target === target);
  if (!edge) throw new ToolError('There’s no arrow between those');
  env.openFile(edge.fileId);
  inOneStep(env.dispatch, () => env.dispatch(edgeRemoved({ edgeId: edge.id })));
  return { disconnected: { source, target } };
}

// The canvas's Tidy: blocks laid out by run order, side nodes back beside their blocks, frames refitted.
function tidyFile(env: CanvasEnv, input: Input) {
  const state = env.getState();
  const fileId = str(input, 'fileId');
  fileOf(state, fileId);
  const blocks = state.canvas.filter(block => block.fileId === fileId);
  const edges = state.edges.filter(edge => edge.fileId === fileId);
  const groups = state.groups.filter(group => group.fileId === fileId);
  env.openFile(fileId);
  inOneStep(env.dispatch, () => {
    env.dispatch(blocksMoved({ positions: tidyPositions(blocks, edges, groups, fileId, env.sizeOf, env.nodeHeight) }));
    env.dispatch(derivedNodePositionsClearedForFile({ fileId }));
    env.dispatch(groupFramesFitted({ groupIds: groups.map(group => group.id) }));
  });
  env.fitView();
  return { tidied: fileId, blocks: blocks.length };
}

export const CANVAS_TOOLS: Record<string, Tool> = {
  get_project_overview: env => projectOverview(env.getState(), canvasOf(env)),
  get_file: (env, input) => fileDetail(env.getState(), str(input, 'fileId')),
  list_block_types: () => blockDescriptors.map(({ id, name, category, description }) => ({ id, name, category, description })),
  get_block_type: (_env, input) => blockType(str(input, 'blockType')),
  get_generated_policy: (env, input) => generatedPolicy(env.getState(), optionalStr(input, 'fileId')),
  get_warnings: env => warnings(env.getState()),
  add_block: (env, input) => addBlock(canvasOf(env), input),
  update_block: (env, input) => updateBlock(canvasOf(env), input),
  remove_block: (env, input) => removeBlock(canvasOf(env), input),
  connect: (env, input) => connect(canvasOf(env), input),
  disconnect: (env, input) => disconnect(canvasOf(env), input),
  tidy_file: (env, input) => tidyFile(canvasOf(env), input)
};
