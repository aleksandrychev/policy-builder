import { newDefinitionEntry } from '../blocks/definitionEntries';
import { blockDescriptors, blockDescriptorsById } from '../blocks/loadBlocks';
import { resolveBlockShape } from '../blocks/resolveBlockShape';
import type { BlockDescriptor } from '../blocks/types';
import { blockAdvice } from '../canvas/advice';
import { executionOrder, isSequenced, wouldCreateCycle } from '../canvas/executionOrder';
import { nextStackPosition } from '../canvas/layout';
import { tidyPositions } from '../canvas/tidy';
import { describeProblem } from '../components/properties/CustomTextProblems';
import { toCfbsProject } from '../project/cfbsProject';
import { compiledPart } from '../project/useCompiledPolicy';
import type { RootState } from '../store';
import {
  blockAdded,
  blockLabelChanged,
  blockNoteChanged,
  blockParamChanged,
  blockRemoved,
  blockRunIntervalChanged,
  blocksMoved,
  conditionRemoved,
  conditionSet
} from '../store/canvasSlice';
import type { BlockInstance, Condition } from '../store/canvasSlice/types';
import { derivedNodePositionsClearedForFile } from '../store/derivedNodesSlice';
import { edgeAdded, edgeRemoved } from '../store/edgesSlice';
import type { BlockOutcome } from '../store/edgesSlice/types';
import { changeMembership } from '../store/groupArrows';
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
    // CFEngine Build modules, in build order (get_module for one); saving adds their dependencies too.
    modules: state.modules.map(module => ({ name: module.name, addedFor: module.addedBy })),
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
      note: block.note,
      runInterval: block.runInterval,
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
    entries: descriptor.entries ? 'Holds a list of entries (one variable or class each): see list_value_sources, add_entry and update_entry.' : undefined,
    requiresModule: descriptor.requires_module
      ? `Its promise type comes from the CFEngine Build module ${descriptor.requires_module}: adding the block adds the module to the project (installed on save; hosts need python3).`
      : undefined
  };
}

// What the compiler left out ("# Skipped …: why." in the policy), by the block whose lines hold it.
async function skippedParts(state: RootState): Promise<Map<string, string[]>> {
  const skipped = new Map<string, string[]>();
  if (!state.project) return skipped;
  const compiled = await window.api?.compilePolicy(compiledPart(toCfbsProject({ ...state, testEnvironments: [] }, state.project).project));
  for (const [path, policy] of Object.entries(compiled?.files ?? {})) {
    const ranges = Object.entries(compiled?.sourceMap[path] ?? {});
    policy.split('\n').forEach((line, index) => {
      const reason = /^\s*# (Skipped .*)\.$/.exec(line)?.[1];
      const at = index + 1;
      const owner = ranges
        .flatMap(([id, spans]) => spans.filter(([first, last]) => first <= at && at <= last).map(([first, last]) => ({ id, size: last - first })))
        .sort((a, b) => a.size - b.size)[0]?.id;
      if (reason && owner) skipped.set(owner, [...(skipped.get(owner) ?? []), reason]);
    });
  }
  return skipped;
}

// Custom CFEngine blocks' text, checked with the bundled linter: problems by block id.
async function customProblems(state: RootState): Promise<Record<string, string[]>> {
  const namespaces = new Map(state.files.files.map(file => [file.id, file.namespace]));
  const blocks = state.canvas
    .filter(block => blockDescriptorsById.get(block.blockId)?.custom)
    .map(block => ({
      id: block.instanceId,
      namespace: namespaces.get(block.fileId) ?? 'custom',
      promises: block.params.promises ?? '',
      definitions: block.params.definitions ?? ''
    }));
  if (!blocks.length || !window.api) return {};
  const found = await window.api.lintCustom(blocks);
  return Object.fromEntries(Object.entries(found).map(([id, problems]) => [id, problems.map(describeProblem)]));
}

async function warnings(state: RootState) {
  const [skipped, custom] = await Promise.all([skippedParts(state), customProblems(state)]);
  const missing = state.canvas.flatMap(block => {
    const descriptor = blockDescriptorsById.get(block.blockId);
    if (!descriptor) return [];
    const notCompiled = skipped.get(block.instanceId);
    if (block.entries) return notCompiled ? [{ blockId: block.instanceId, label: block.label, fileId: block.fileId, notCompiled }] : [];
    const parameters = resolveBlockShape(descriptor, block.valueSourceId).parameters.filter(param => !block.paramBindings?.[param.name]);
    const empty = parameters.filter(param => param.required && !block.params[param.name]?.trim()).map(param => param.label ?? param.name);
    const invalid = parameters.flatMap(param => {
      const value = block.params[param.name] ?? '';
      const problem = param.type === 'cases' || !value ? undefined : valueProblem(param, value);
      return problem ? [`${param.name} ${problem}`] : [];
    });
    const advice = blockAdvice(block, state.edges);
    const customText = custom[block.instanceId]?.length ? custom[block.instanceId] : undefined;
    return empty.length || invalid.length || notCompiled || advice.length || customText
      ? [
          {
            blockId: block.instanceId,
            label: block.label,
            fileId: block.fileId,
            ...(empty.length ? { missing: empty } : {}),
            ...(invalid.length ? { invalid } : {}),
            ...(notCompiled ? { notCompiled } : {}),
            ...(advice.length ? { advice } : {}),
            ...(customText ? { customText } : {})
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

const OUTCOMES: BlockOutcome[] = ['kept', 'repaired', 'not_kept'];

// A block to add, checked against the project (and the blocks before it in a batch) before anything changes.
interface BlockSpec {
  // From an existing block or group (its id), or a block earlier in the same batch (its index).
  after?: { outcomes: BlockOutcome[]; source: number | string };
  condition?: Condition;
  descriptor: BlockDescriptor;
  fileId: string;
  groupId?: string;
  label: string;
  note?: string;
  params: Record<string, string>;
  runInterval?: string;
  valueSourceId?: string;
}

// "How often" in minutes, for blocks without a run_interval parameter of their own; "" removes it.
function runIntervalInput(input: Input, descriptor: BlockDescriptor): string | undefined {
  if (input.runInterval === undefined || input.runInterval === null) return undefined;
  const minutes = String(input.runInterval).trim();
  if (descriptor.parameters?.some(parameter => parameter.name === 'run_interval')) {
    throw new ToolError(`${descriptor.name} sets how often with its run_interval parameter`);
  }
  if (descriptor.entries) throw new ToolError(`${descriptor.name} has no How often`);
  if (minutes !== '' && !/^[1-9]\d*$/.test(minutes)) throw new ToolError('runInterval is a whole number of minutes, at least 1 ("" removes it)');
  return minutes;
}

function conditionInput(input: Input): Condition | undefined {
  const condition = input.condition as { className?: unknown; mode?: unknown } | null | undefined;
  if (condition === null || condition === undefined) return undefined;
  if (typeof condition.className !== 'string' || !condition.className.trim() || (condition.mode !== 'if' && condition.mode !== 'unless')) {
    throw new ToolError('condition needs a className and a mode of if or unless');
  }
  return { kind: 'class', className: condition.className.trim(), mode: condition.mode };
}

function outcomesInput(input: Input): BlockOutcome[] {
  const outcomes = Array.isArray(input.outcomes) && input.outcomes.length ? (input.outcomes as BlockOutcome[]) : (['kept', 'repaired'] as BlockOutcome[]);
  if (!outcomes.every(outcome => OUTCOMES.includes(outcome))) throw new ToolError('Outcomes are kept, repaired and not_kept');
  return outcomes;
}

function checkedGroupId(state: RootState, input: Input, fileId: string, sequenced: boolean): string | undefined {
  const groupId = optionalStr(input, 'groupId');
  if (!groupId) return undefined;
  const group = state.groups.find(item => item.id === groupId);
  if (!group) throw new ToolError(`No group ${groupId}; get_file lists a file's groups`);
  if (group.fileId !== fileId) throw new ToolError('A group holds blocks of its own file');
  if (!sequenced) throw new ToolError('Define Variable / Define Class blocks don’t go in groups');
  return groupId;
}

const NO_ARROWS = 'Define Variable / Define Class blocks can’t take arrows; use a condition on their classes';
const CROSSES_GROUP = 'Arrows can’t cross a group’s edge: connect to the group itself';

// The arrow into a new block (`after`): from an existing block or group, or an earlier block of the batch.
function checkedArrow(state: RootState, input: Input, spec: BlockSpec, earlier: BlockSpec[]): BlockSpec['after'] {
  if (input.after === undefined || input.after === null) return undefined;
  if (!isSequenced(spec.descriptor)) throw new ToolError(NO_ARROWS);
  const outcomes = outcomesInput(input);
  if (typeof input.after === 'number') {
    const source = earlier[input.after];
    if (!Number.isInteger(input.after) || !source) throw new ToolError('after as a number is the index of an earlier block in the same batch');
    if (source.fileId !== spec.fileId) throw new ToolError('Arrows connect blocks of the same file');
    if (!isSequenced(source.descriptor)) throw new ToolError(NO_ARROWS);
    if (source.groupId !== spec.groupId) throw new ToolError(CROSSES_GROUP);
    return { source: input.after, outcomes };
  }
  const sourceId = str(input, 'after');
  const from = endpoint(state, sourceId);
  if (from.fileId !== spec.fileId) throw new ToolError('Arrows connect blocks of the same file');
  if (!from.takesArrows) throw new ToolError(NO_ARROWS);
  if (from.groupId !== spec.groupId || sourceId === spec.groupId) throw new ToolError(CROSSES_GROUP);
  return { source: sourceId, outcomes };
}

function checkedBlockSpec(state: RootState, input: Input, earlier: BlockSpec[] = []): BlockSpec {
  const fileId = str(input, 'fileId');
  fileOf(state, fileId);
  const descriptor = descriptorOf(str(input, 'blockType'));
  if (descriptor.entries && input.params) throw new ToolError(`${descriptor.name} holds entries: add it without params, then add_entry`);
  const valueSourceId = descriptor.value_sources?.[0]?.id;
  const params = checkedBlockParams(descriptor, valueSourceId, input.params);
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : descriptor.name;
  const groupId = checkedGroupId(state, input, fileId, isSequenced(descriptor));
  const note = optionalStr(input, 'note')?.trim() || undefined;
  const runInterval = runIntervalInput(input, descriptor) || undefined;
  const spec: BlockSpec = { fileId, descriptor, label, note, params, runInterval, valueSourceId, condition: conditionInput(input), groupId };
  return { ...spec, after: checkedArrow(state, input, spec, earlier) };
}

// Adds one checked block (inside the caller's undo step): its condition, group and arrow with it.
function dispatchBlock(env: CanvasEnv, spec: BlockSpec, added: string[]): string {
  const { descriptor, fileId, label } = spec;
  const defaults = Object.fromEntries(resolveBlockShape(descriptor, spec.valueSourceId).parameters.map(param => [param.name, String(param.default ?? '')]));
  const position = nextStackPosition(
    env.getState().canvas.filter(block => block.fileId === fileId),
    env.sizeOf
  );
  const instanceId = env.dispatch(
    blockAdded(
      descriptor.entries
        ? { blockId: descriptor.id, fileId, label, params: {}, entries: [newDefinitionEntry(descriptor)], position }
        : { blockId: descriptor.id, fileId, label, params: { ...defaults, ...spec.params }, valueSourceId: spec.valueSourceId, position }
    )
  ).payload.instanceId;
  if (spec.note) env.dispatch(blockNoteChanged({ instanceId, note: spec.note }));
  if (spec.runInterval) env.dispatch(blockRunIntervalChanged({ instanceId, runInterval: spec.runInterval }));
  if (spec.condition) env.dispatch(conditionSet({ instanceId, condition: spec.condition }));
  if (spec.groupId) env.dispatch(changeMembership(fileId, [instanceId], spec.groupId));
  if (spec.after) {
    const source = typeof spec.after.source === 'number' ? added[spec.after.source] : spec.after.source;
    env.dispatch(edgeAdded({ fileId, source, target: instanceId, outcomes: spec.after.outcomes }));
  }
  return instanceId;
}

function addBlock(env: CanvasEnv, input: Input) {
  const spec = checkedBlockSpec(env.getState(), input);
  env.openFile(spec.fileId);
  let instanceId = '';
  inOneStep(env.dispatch, () => {
    instanceId = dispatchBlock(env, spec, []);
  });
  return { id: instanceId, label: spec.label };
}

const MAX_BATCH = 50;

// Several blocks in one call and one undo step: every one is checked first, so it's all or nothing.
function addBlocks(env: CanvasEnv, input: Input) {
  if (!Array.isArray(input.blocks) || !input.blocks.length) throw new ToolError('blocks needs at least one block');
  if (input.blocks.length > MAX_BATCH) throw new ToolError(`At most ${MAX_BATCH} blocks per call`);
  const state = env.getState();
  const specs: BlockSpec[] = [];
  input.blocks.forEach((item: unknown, index) => {
    try {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new ToolError('each block is an object, as add_block takes it');
      specs.push(checkedBlockSpec(state, item as Input, specs));
    } catch (error) {
      throw new ToolError(`blocks[${index}]: ${error instanceof Error ? error.message : String(error)}. Nothing was added.`);
    }
  });
  env.openFile(specs[0].fileId);
  const added: string[] = [];
  inOneStep(env.dispatch, () => {
    for (const spec of specs) added.push(dispatchBlock(env, spec, added));
  });
  return { added: specs.map((spec, index) => ({ id: added[index], label: spec.label, fileId: spec.fileId })) };
}

function updateBlock(env: CanvasEnv, input: Input) {
  const block = blockOf(env.getState(), str(input, 'blockId'));
  const descriptor = descriptorOf(block.blockId);
  if (block.entries && input.params) throw new ToolError(`${descriptor.name} holds entries: change them with update_entry`);
  const params = checkedBlockParams(descriptor, block.valueSourceId, input.params);
  const condition = input.condition === null ? null : conditionInput(input);
  const runInterval = runIntervalInput(input, descriptor);
  env.openFile(block.fileId);
  inOneStep(env.dispatch, () => {
    if (typeof input.label === 'string' && input.label.trim()) env.dispatch(blockLabelChanged({ instanceId: block.instanceId, label: input.label.trim() }));
    if (typeof input.note === 'string') env.dispatch(blockNoteChanged({ instanceId: block.instanceId, note: input.note.trim() }));
    if (runInterval !== undefined) env.dispatch(blockRunIntervalChanged({ instanceId: block.instanceId, runInterval }));
    for (const [paramName, value] of Object.entries(params)) env.dispatch(blockParamChanged({ instanceId: block.instanceId, paramName, value }));
    if (condition === null) env.dispatch(conditionRemoved({ instanceId: block.instanceId }));
    else if (condition) env.dispatch(conditionSet({ instanceId: block.instanceId, condition }));
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
  const outcomes = outcomesInput(input);
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
  list_block_types: () =>
    blockDescriptors.map(({ id, name, category, description, requires_module }) => ({ id, name, category, description, requiresModule: requires_module })),
  get_block_type: (_env, input) => blockType(str(input, 'blockType')),
  get_generated_policy: (env, input) => generatedPolicy(env.getState(), optionalStr(input, 'fileId')),
  get_warnings: env => warnings(env.getState()),
  add_block: (env, input) => addBlock(canvasOf(env), input),
  add_blocks: (env, input) => addBlocks(canvasOf(env), input),
  update_block: (env, input) => updateBlock(canvasOf(env), input),
  remove_block: (env, input) => removeBlock(canvasOf(env), input),
  connect: (env, input) => connect(canvasOf(env), input),
  disconnect: (env, input) => disconnect(canvasOf(env), input),
  tidy_file: (env, input) => tidyFile(canvasOf(env), input)
};
