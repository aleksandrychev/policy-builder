import { type Decorator, type DecoratorValueType, chainOutputType, decorators, decoratorsById } from '../blocks/decorators';
import { duplicateDefinitionKeys, entryName, entrySummary } from '../blocks/definitionEntries';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import { primaryPromiseType } from '../blocks/resolveBlockShape';
import { type BlockDescriptor, type BlockParameter, type BlockValueSource, usesClassRefs } from '../blocks/types';
import { sourceBaseType } from '../canvas/dataChains';
import { buildClassNameOptions } from '../components/properties/classOptions';
import { isBindable } from '../components/properties/dataBinding';
import type { RootState } from '../store';
import {
  BINDING_TARGET_PREFIX,
  blockParamChanged,
  blockValueSourceChanged,
  classRefAdded,
  classRefChanged,
  classRefRemoved,
  conditionClassNameChanged,
  conditionEnabled,
  conditionModeChanged,
  conditionRemoved,
  decoratorAdded,
  decoratorMoved,
  decoratorParamChanged,
  decoratorRemoved,
  entryAdded,
  entryMoved,
  entryRemoved,
  inventoryAttributeNameChanged,
  inventoryEnabled,
  inventoryRemoved,
  paramBound,
  paramUnbound
} from '../store/canvasSlice';
import type { BlockInstance, Condition, DecoratorInstance, DefinitionEntry, EditableSubject } from '../store/canvasSlice/types';
import type { PolicyFile } from '../store/filesSlice/types';
import { inOneStep } from '../store/history';
import { asRecord, checkedParams, paramValue, parameterView } from './params';
import { type CanvasEnv, type Input, type Tool, ToolError, canvasOf, optionalStr, str } from './shared';

/** Define Variable / Define Class entries, transformer chains and data-fed parameters (src/main/mcpTools/definitions.ts names them). */

const DEFINE_VARIABLE = 'define-variable';
const conditionText = (condition?: Condition) => (condition?.className.trim() ? `${condition.mode} ${condition.className.trim()}` : undefined);
const fill = (summary: string, params: Record<string, string>) => summary.replace(/\{\{(\w+)\}\}/g, (_, name: string) => params[name] ?? '');
// Value sources and decorators carry a `summary` line (blocks/README.md) their TS types don't declare.
const summaryOf = (item: { label: string } | undefined, params: Record<string, string>) => {
  const summary = (item as { summary?: string } | undefined)?.summary;
  return summary ? fill(summary, params) : item?.label;
};
const typeName = (type: string) => (type === 'slist' ? 'list' : type);

function descriptorOf(blockType: string): BlockDescriptor {
  const descriptor = blockDescriptorsById.get(blockType);
  if (!descriptor) throw new ToolError(`No block type ${blockType}; list_block_types lists them`);
  return descriptor;
}

function blockOf(state: RootState, blockId: string): BlockInstance {
  const block = state.canvas.find(item => item.instanceId === blockId);
  if (!block) throw new ToolError(`No block ${blockId}; get_file lists a file's blocks`);
  return block;
}

// A Define Variable / Define Class block, with its descriptor.
function definitionBlock(state: RootState, blockId: string) {
  const block = blockOf(state, blockId);
  const descriptor = descriptorOf(block.blockId);
  if (!descriptor.entries) throw new ToolError(`${block.label} is a ${descriptor.name} block, which has no entries; use update_block or bind_parameter`);
  return { block, descriptor, entries: descriptor.entries };
}

function entryOf(block: BlockInstance, entryId: string): DefinitionEntry {
  const entry = block.entries?.find(item => item.id === entryId);
  if (!entry) throw new ToolError(`${block.label} has no entry ${entryId}; list_variables / list_classes list them`);
  return entry;
}

const sourceOf = (descriptor: BlockDescriptor, valueSourceId: string | undefined) =>
  descriptor.value_sources?.find(source => source.id === valueSourceId) ?? descriptor.value_sources?.[0];

function namedSource(descriptor: BlockDescriptor, valueSourceId: string): BlockValueSource {
  const source = descriptor.value_sources?.find(candidate => candidate.id === valueSourceId);
  if (!source) {
    throw new ToolError(`${descriptor.name} has no value source ${valueSourceId}; it has ${(descriptor.value_sources ?? []).map(item => item.id).join(', ')}`);
  }
  return source;
}

// The CFEngine type a chain produces: its last step's output, else what it starts from (int included).
const resultType = (start: string, chain: DecoratorInstance[] = []) =>
  chain.reduce((type, step) => decoratorsById.get(step.decoratorId)?.output_type ?? type, start);

const CONVERT_HINT = 'Split into a list (split-list) makes a list; Join (join), Pick entry (nth) or Count (length) make a string again.';

// Why a chain doesn't type-check from `base`, if it doesn't — the UI only offers steps taking what flows in.
function chainError(base: DecoratorValueType, decoratorIds: string[]): string | undefined {
  let type = base;
  for (const [index, id] of decoratorIds.entries()) {
    const decorator = decoratorsById.get(id);
    if (!decorator) continue;
    if (decorator.input_type !== type) {
      return `${decorator.label} (step ${index + 1}) takes a ${typeName(decorator.input_type)} but gets a ${typeName(type)}. ${CONVERT_HINT}`;
    }
    type = chainOutputType(decorator);
  }
  return undefined;
}

const chainView = (chain: DecoratorInstance[] | undefined) =>
  (chain ?? []).map(step => {
    const decorator = decoratorsById.get(step.decoratorId);
    return { id: step.id, transformer: step.decoratorId, does: summaryOf(decorator, step.params), params: step.params };
  });

// ---- Parameters ----

const defaultsOf = (parameters: BlockParameter[]) => Object.fromEntries(parameters.map(parameter => [parameter.name, String(parameter.default ?? '')]));

// `blank`: what counts as empty — the compiler trims block and entry values, not a step's (a " " delimiter).
function requireFilled(parameters: BlockParameter[], params: Record<string, string>, owner: string, blank = (value: string) => !value.trim()) {
  const missing = parameters.filter(parameter => parameter.required && blank(params[parameter.name] ?? String(parameter.default ?? '')));
  if (missing.length) throw new ToolError(`${owner} needs ${missing.map(parameter => parameter.name).join(', ')}`);
}

function checkedCondition(raw: unknown): Condition | null | undefined {
  if (raw === undefined || raw === null) return raw;
  const { className, mode } = raw as { className?: unknown; mode?: unknown };
  if (typeof className !== 'string' || !className.trim() || (mode !== 'if' && mode !== 'unless')) {
    throw new ToolError('condition needs a className (a class expression) and a mode of if or unless');
  }
  return { kind: 'class', className: className.trim(), mode };
}

function checkedClassRefs(raw: unknown): { name: string; negate: boolean }[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.length) throw new ToolError('classRefs is a non-empty list of {name, negate}: an empty AND is always true');
  return raw.map((ref: unknown) => {
    const { name, negate = false } = (ref ?? {}) as { name?: unknown; negate?: unknown };
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_:]+$/.test(name)) {
      throw new ToolError('Each classRef needs a class name (letters, digits, _ and ns: for another file’s), see list_classes');
    }
    return { name, negate: negate === true };
  });
}

// ---- Names and references ----

const isVariableBlock = (descriptor: BlockDescriptor) => primaryPromiseType(descriptor) === 'vars';
const hardClassNames = () => new Set(buildClassNameOptions([], new Map(), null).map(option => option.name));

function checkedName(state: RootState, block: BlockInstance, descriptor: BlockDescriptor, raw: unknown, entryId?: string): string {
  const nameParam = descriptorEntries(descriptor).name_param;
  const parameter = (descriptor.parameters ?? []).find(item => item.name === nameParam);
  if (typeof raw !== 'string' || !raw.trim()) throw new ToolError('name is required');
  const name = parameter ? paramValue(parameter, raw.trim()) : raw.trim();
  if (!isVariableBlock(descriptor) && hardClassNames().has(name)) {
    throw new ToolError(`${name} is a CFEngine hard class; a class defined with that name would still read as the hard class. Pick another name`);
  }
  const others = state.canvas.map(instance =>
    instance.instanceId === block.instanceId && entryId ? { ...instance, entries: instance.entries?.filter(entry => entry.id !== entryId) } : instance
  );
  const probe = { ...block, instanceId: '', entries: [{ id: '', params: { [nameParam]: name } }] };
  if (duplicateDefinitionKeys([...others, probe], blockDescriptorsById, block.fileId).has(`${block.blockId}:${name}`)) {
    throw new ToolError(`This file already defines a ${descriptorEntries(descriptor).noun} named ${name}; pick another name or update that entry`);
  }
  return name;
}

function descriptorEntries(descriptor: BlockDescriptor) {
  if (!descriptor.entries) throw new ToolError(`${descriptor.name} has no entries`);
  return descriptor.entries;
}

// A list variable is a Mustache section ({{.}} per item), a scalar a triple-brace tag.
function references(kind: 'class' | 'variable', name: string, namespace: string, isList = false) {
  if (kind === 'class') {
    return { sameFile: name, otherFiles: `${namespace}:${name}`, mustache: `{{#classes.${namespace}:${name}}}…{{/classes.${namespace}:${name}}}` };
  }
  const path = `vars.${namespace}:vars.${name}`;
  return { sameFile: `vars.${name}`, otherFiles: `${namespace}:vars.${name}`, mustache: isList ? `{{#${path}}}{{.}}{{/${path}}}` : `{{{${path}}}}` };
}

// Every entry of the project's Define Variable (or Define Class) blocks, optionally in one file.
function definitions(state: RootState, kind: 'class' | 'variable', fileId: string | undefined) {
  const files = new Map(state.files.files.map(file => [file.id, file]));
  if (fileId && !files.has(fileId)) throw new ToolError(`No file ${fileId}; get_project_overview lists them`);
  return state.canvas.flatMap(block => {
    const descriptor = blockDescriptorsById.get(block.blockId);
    const file = files.get(block.fileId);
    if (!descriptor?.entries || !file || (fileId && block.fileId !== fileId)) return [];
    if (isVariableBlock(descriptor) !== (kind === 'variable')) return [];
    const duplicates = duplicateDefinitionKeys(state.canvas, blockDescriptorsById, block.fileId);
    return (block.entries ?? []).map(entry => definitionView(kind, file, block, descriptor, entry, duplicates));
  });
}

function definitionView(
  kind: 'class' | 'variable',
  file: PolicyFile,
  block: BlockInstance,
  descriptor: BlockDescriptor,
  entry: DefinitionEntry,
  duplicates: Set<string>
) {
  const name = entryName(descriptor, entry);
  const source = sourceOf(descriptor, entry.valueSourceId);
  const gates = [
    conditionText(file.condition) && `file: ${conditionText(file.condition)}`,
    conditionText(block.condition) && `block: ${conditionText(block.condition)}`
  ];
  const alsoGatedBy = gates.filter(Boolean);
  const { [descriptor.entries!.name_param]: _name, ...params } = entry.params;
  const type = resultType(source?.value_type ?? 'string', entry.decorators);
  return {
    fileId: file.id,
    file: file.name,
    blockId: block.instanceId,
    block: block.label,
    entryId: entry.id,
    name: name || '(unnamed)',
    valueSource: source?.id,
    value: (source as { summary?: string } | undefined)?.summary ? summaryOf(source, entry.params) : entrySummary(descriptor, entry),
    params,
    classRefs: usesClassRefs(source) ? entry.classRefs?.map(ref => ({ name: ref.name, negate: ref.negate })) : undefined,
    type: kind === 'variable' ? typeName(type) : undefined,
    transformers: kind === 'variable' && entry.decorators?.length ? chainView(entry.decorators) : undefined,
    condition: conditionText(entry.condition),
    alsoGatedBy: alsoGatedBy.length ? alsoGatedBy : undefined,
    inventoryAttribute: entry.inventory?.attributeName || undefined,
    duplicateName: name && duplicates.has(`${block.blockId}:${name}`) ? true : undefined,
    reference: name ? references(kind, name, file.namespace, type === 'slist') : undefined
  };
}

function listVariables(state: RootState, fileId: string | undefined) {
  return {
    howToReference:
      'In a parameter of a block in the same file write $(vars.<name>), from another file $(<ns>:vars.<name>); a list in $(…) repeats the promise per item. Pickers (the Variable value source, "Variable is defined") take the reference without $(). Mustache templates use the mustache form.',
    variables: definitions(state, 'variable', fileId)
  };
}

function listClasses(state: RootState, fileId: string | undefined) {
  return {
    howToReference:
      'Conditions, classRefs and class expressions use the sameFile name in the defining file and otherFiles (<ns>:name) elsewhere. A block’s outcome isn’t a class to reference: order blocks with arrows (connect) instead.',
    classes: definitions(state, 'class', fileId),
    hardClasses: {
      note: 'CFEngine’s hard classes are usable bare in any file (the compiler qualifies them); classes from masterfiles or augments too. Never define a class named like one.',
      examples: [...hardClassNames()]
    }
  };
}

// ---- Catalogs ----

function listValueSources(blockType: string) {
  const descriptor = descriptorOf(blockType);
  if (!descriptor.value_sources) throw new ToolError(`${descriptor.name} has no value sources; ${DEFINE_VARIABLE} and define-class have`);
  const variables = isVariableBlock(descriptor);
  return {
    blockType: descriptor.id,
    nameParameter: descriptor.entries?.name_param,
    valueSources: descriptor.value_sources.map(source => ({
      id: source.id,
      label: source.label,
      group: source.group,
      help: source.help,
      produces: variables ? typeName(source.value_type ?? 'string') : undefined,
      takesTransformers: variables ? sourceBaseType(source) !== undefined : undefined,
      bindable: descriptor.id === DEFINE_VARIABLE ? isComputed(source) : undefined,
      takesClassRefs: usesClassRefs(source) || undefined,
      parameters: source.parameters.map(parameterView)
    })),
    notes: variables
      ? 'Typed-in sources (literal, list, per-condition) and structured data take no transformers. bindable sources can feed another block’s parameter (bind_parameter). cases rows are [{className, mode, value}].'
      : 'combine-and / combine-or take classRefs instead of parameters.'
  };
}

const decoratorView = (decorator: Decorator) => ({
  id: decorator.id,
  label: decorator.label,
  function: decorator.badge,
  input: typeName(decorator.input_type),
  output: typeName(decorator.output_type),
  does: (decorator as { summary?: string }).summary,
  help: decorator.help,
  parameters: decorator.parameters.map(parameterView)
});

function listTransformers() {
  return {
    note: `Each transformer takes what the previous step (or the value source) produces. ${CONVERT_HINT} A list fed to a parameter that isn’t a list needs a join last.`,
    transformers: decorators.map(decoratorView)
  };
}

// ---- Entries ----

function addEntry(env: CanvasEnv, input: Input) {
  const state = env.getState();
  const { block, descriptor, entries } = definitionBlock(state, str(input, 'blockId'));
  const name = checkedName(state, block, descriptor, input.name);
  const source = input.valueSource === undefined ? descriptor.value_sources![0] : namedSource(descriptor, str(input, 'valueSource'));
  const params = { ...defaultsOf(source.parameters), ...checkedParams(source.parameters, asRecord(input.params, 'params'), source.label) };
  requireFilled(source.parameters, params, source.label);
  const classRefs = checkedClassRefs(input.classRefs);
  if (usesClassRefs(source) && !classRefs) throw new ToolError(`${source.label} needs classRefs: the classes it combines`);
  if (!usesClassRefs(source) && classRefs) throw new ToolError(`Only combine-and / combine-or take classRefs`);
  const condition = checkedCondition(input.condition);
  const inventory = inventoryOf(descriptor, input.inventoryAttribute);

  const entry: DefinitionEntry = {
    id: crypto.randomUUID(),
    valueSourceId: source.id,
    params: { ...params, [entries.name_param]: name },
    ...(classRefs && { classRefs: classRefs.map(ref => ({ id: crypto.randomUUID(), ...ref })) }),
    ...(condition && { condition }),
    ...(inventory && { inventory: { attributeName: inventory } })
  };
  // A block just added holds one blank entry: it's replaced rather than left unnamed.
  const blank = block.entries?.length === 1 && !entryName(descriptor, block.entries[0]) ? block.entries[0] : undefined;
  env.openFile(block.fileId);
  inOneStep(env.dispatch, () => {
    env.dispatch(entryAdded({ instanceId: block.instanceId, entry }));
    if (blank) env.dispatch(entryRemoved({ instanceId: block.instanceId, entryId: blank.id }));
  });
  const kind = isVariableBlock(descriptor) ? 'variable' : 'class';
  return { entryId: entry.id, name, reference: references(kind, name, fileNamespace(state, block), source.value_type === 'slist') };
}

const fileNamespace = (state: RootState, block: BlockInstance) => state.files.files.find(file => file.id === block.fileId)?.namespace ?? '';

function inventoryOf(descriptor: BlockDescriptor, raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return raw;
  if (!isVariableBlock(descriptor)) throw new ToolError('Only variables carry an inventory attribute');
  if (typeof raw !== 'string' || !raw.trim()) throw new ToolError('inventoryAttribute is the attribute name to show in Mission Portal, or null to remove it');
  return raw.trim();
}

// Whether the entry's chain is dropped by switching to `source`: one that can't be transformed drops it
// (the compiler would still apply it), one that can must fit it.
function dropsChain(entry: DefinitionEntry, source: BlockValueSource): boolean {
  const chain = entry.decorators ?? [];
  const base = sourceBaseType(source);
  if (!chain.length) return false;
  if (!base) return true;
  const error = chainError(
    base,
    chain.map(step => step.decoratorId)
  );
  if (error) throw new ToolError(`The transformers don’t fit ${source.label}’s ${typeName(base)}: ${error}`);
  return false;
}

type EntryRef = { entryId: string; instanceId: string };

function switchSource(env: CanvasEnv, ref: EntryRef, entry: DefinitionEntry, source: BlockValueSource, dropChain: boolean) {
  env.dispatch(blockValueSourceChanged({ ...ref, valueSourceId: source.id }));
  // Defaults for the new source's parameters the entry hasn't had yet.
  for (const [paramName, value] of Object.entries(defaultsOf(source.parameters))) {
    if (entry.params[paramName] === undefined) env.dispatch(blockParamChanged({ ...ref, paramName, value }));
  }
  if (dropChain) for (const step of entry.decorators ?? []) env.dispatch(decoratorRemoved({ ...ref, decoratorInstanceId: step.id }));
}

function replaceClassRefs(env: CanvasEnv, ref: EntryRef, entry: DefinitionEntry, classRefs: { name: string; negate: boolean }[]) {
  for (const old of entry.classRefs ?? []) env.dispatch(classRefRemoved({ ...ref, classRefId: old.id }));
  for (const item of classRefs) {
    const added = env.dispatch(classRefAdded(ref.instanceId, ref.entryId));
    env.dispatch(classRefChanged({ ...ref, classRefId: added.payload.classRef.id, ...item }));
  }
}

function setCondition(env: CanvasEnv, ref: EntryRef, entry: DefinitionEntry, condition: Condition | null) {
  if (condition === null) {
    env.dispatch(conditionRemoved(ref));
    return;
  }
  if (!entry.condition) env.dispatch(conditionEnabled(ref));
  env.dispatch(conditionModeChanged({ ...ref, mode: condition.mode }));
  env.dispatch(conditionClassNameChanged({ ...ref, className: condition.className }));
}

function setInventory(env: CanvasEnv, ref: EntryRef, entry: DefinitionEntry, attributeName: string | null) {
  if (attributeName === null) {
    env.dispatch(inventoryRemoved(ref));
    return;
  }
  if (!entry.inventory) env.dispatch(inventoryEnabled(ref));
  env.dispatch(inventoryAttributeNameChanged({ ...ref, attributeName }));
}

function updateEntry(env: CanvasEnv, input: Input) {
  const state = env.getState();
  const { block, descriptor, entries } = definitionBlock(state, str(input, 'blockId'));
  const entry = entryOf(block, str(input, 'entryId'));
  const ref = { instanceId: block.instanceId, entryId: entry.id };
  const name = input.name === undefined ? undefined : checkedName(state, block, descriptor, input.name, entry.id);
  const sourceChanged = input.valueSource !== undefined && input.valueSource !== entry.valueSourceId;
  const source = input.valueSource === undefined ? sourceOf(descriptor, entry.valueSourceId)! : namedSource(descriptor, str(input, 'valueSource'));
  const params = checkedParams(source.parameters, asRecord(input.params, 'params'), source.label);
  if (sourceChanged || input.params !== undefined) requireFilled(source.parameters, { ...entry.params, ...params }, source.label);
  const classRefs = checkedClassRefs(input.classRefs);
  if (classRefs && !usesClassRefs(source)) throw new ToolError('Only combine-and / combine-or take classRefs');
  if (sourceChanged && usesClassRefs(source) && !classRefs && !entry.classRefs?.some(item => item.name)) {
    throw new ToolError(`${source.label} needs classRefs: the classes it combines`);
  }
  const condition = checkedCondition(input.condition);
  const inventory = inventoryOf(descriptor, input.inventoryAttribute);
  const dropChain = sourceChanged && dropsChain(entry, source);

  env.openFile(block.fileId);
  inOneStep(env.dispatch, () => {
    if (name !== undefined) env.dispatch(blockParamChanged({ ...ref, paramName: entries.name_param, value: name }));
    if (sourceChanged) switchSource(env, ref, entry, source, dropChain);
    for (const [paramName, value] of Object.entries(params)) env.dispatch(blockParamChanged({ ...ref, paramName, value }));
    if (classRefs) replaceClassRefs(env, ref, entry, classRefs);
    if (condition !== undefined) setCondition(env, ref, entry, condition);
    if (inventory !== undefined) setInventory(env, ref, entry, inventory);
  });
  return { entryId: entry.id, updated: true, droppedTransformers: dropChain || undefined };
}

function removeEntry(env: CanvasEnv, input: Input) {
  const { block } = definitionBlock(env.getState(), str(input, 'blockId'));
  const entry = entryOf(block, str(input, 'entryId'));
  if ((block.entries?.length ?? 0) <= 1) throw new ToolError(`That’s ${block.label}’s only entry; remove the block instead (remove_block)`);
  env.openFile(block.fileId);
  inOneStep(env.dispatch, () => env.dispatch(entryRemoved({ instanceId: block.instanceId, entryId: entry.id })));
  return { removed: entry.id };
}

function moveEntry(env: CanvasEnv, input: Input) {
  const { block } = definitionBlock(env.getState(), str(input, 'blockId'));
  const entry = entryOf(block, str(input, 'entryId'));
  const entries = block.entries ?? [];
  const toIndex = input.toIndex;
  if (typeof toIndex !== 'number' || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= entries.length) {
    throw new ToolError(`toIndex is a position from 0 to ${entries.length - 1}`);
  }
  env.openFile(block.fileId);
  inOneStep(env.dispatch, () => env.dispatch(entryMoved({ instanceId: block.instanceId, fromIndex: entries.indexOf(entry), toIndex })));
  return { entryId: entry.id, index: toIndex };
}

// ---- Transformer chains ----

interface ChainTarget {
  base: DecoratorValueType;
  block: BlockInstance;
  ref: { entryId: string; instanceId: string };
  subject: EditableSubject;
}

// An entry's value or a data-fed parameter: what a chain transforms.
function chainTarget(state: RootState, input: Input): ChainTarget {
  const block = blockOf(state, str(input, 'blockId'));
  const entryId = optionalStr(input, 'entryId');
  const param = optionalStr(input, 'param');
  if (entryId && param) throw new ToolError('Give entryId (a variable’s value) or param (a data-fed parameter), not both');
  if (param) {
    const binding = block.paramBindings?.[param];
    if (!binding) throw new ToolError(`${block.label}’s ${param} isn’t computed from data; bind_parameter it first`);
    const source = sourceOf(descriptorOf(DEFINE_VARIABLE), binding.valueSourceId);
    return {
      block,
      ref: { instanceId: block.instanceId, entryId: `${BINDING_TARGET_PREFIX}${param}` },
      subject: binding,
      base: sourceBaseType(source) ?? 'string'
    };
  }
  const descriptor = descriptorOf(block.blockId);
  if (!descriptor.entries) throw new ToolError(`${block.label} isn’t a Define Variable block: give param, a parameter computed from data`);
  if (!entryId) throw new ToolError('entryId is required: which variable of the block to transform');
  const entry = entryOf(block, entryId);
  const source = sourceOf(descriptor, entry.valueSourceId);
  const base = isVariableBlock(descriptor) ? sourceBaseType(source) : undefined;
  if (!base) {
    throw new ToolError(
      isVariableBlock(descriptor)
        ? `${source?.label} values take no transformers (typed-in values and structured data); switch the entry to a computed value source (list_value_sources)`
        : 'Classes take no transformers'
    );
  }
  return { block, ref: { instanceId: block.instanceId, entryId: entry.id }, subject: entry, base };
}

function transformerOf(id: string): Decorator {
  const decorator = decoratorsById.get(id);
  if (!decorator) throw new ToolError(`No transformer ${id}; list_transformers lists them`);
  return decorator;
}

function stepOf(target: ChainTarget, transformerId: string) {
  const chain = target.subject.decorators ?? [];
  const index = chain.findIndex(step => step.id === transformerId);
  if (index === -1) throw new ToolError(`No transformer step ${transformerId} there; its chain is ${JSON.stringify(chainView(chain))}`);
  return { chain, index, step: chain[index] };
}

function checkedPosition(raw: unknown, length: number): number {
  if (raw === undefined) return length;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > length) throw new ToolError(`position is from 0 to ${length}`);
  return raw;
}

function chainAnswer(env: CanvasEnv, target: ChainTarget, extra: Record<string, unknown>) {
  const subject = findSubjectIn(env.getState(), target.ref);
  const chain = subject?.decorators ?? [];
  return { ...extra, chain: chainView(chain), result: typeName(resultType(target.base, chain)) };
}

function findSubjectIn(state: RootState, { instanceId, entryId }: ChainTarget['ref']): EditableSubject | undefined {
  const block = state.canvas.find(item => item.instanceId === instanceId);
  if (entryId.startsWith(BINDING_TARGET_PREFIX)) return block?.paramBindings?.[entryId.slice(BINDING_TARGET_PREFIX.length)];
  return block?.entries?.find(entry => entry.id === entryId);
}

function addTransformer(env: CanvasEnv, input: Input) {
  const target = chainTarget(env.getState(), input);
  const decorator = transformerOf(str(input, 'transformer'));
  const params = { ...defaultsOf(decorator.parameters), ...checkedParams(decorator.parameters, asRecord(input.params, 'params'), decorator.label) };
  requireFilled(decorator.parameters, params, decorator.label, value => !value);
  const chain = target.subject.decorators ?? [];
  const position = checkedPosition(input.position, chain.length);
  const ids = chain.map(step => step.decoratorId);
  ids.splice(position, 0, decorator.id);
  const error = chainError(target.base, ids);
  if (error) throw new ToolError(error);

  let id = '';
  env.openFile(target.block.fileId);
  inOneStep(env.dispatch, () => {
    const added = env.dispatch(decoratorAdded(target.ref.instanceId, decorator.id, target.ref.entryId));
    id = added.payload.decoratorInstance.id;
    for (const [paramName, value] of Object.entries(params)) {
      env.dispatch(decoratorParamChanged({ ...target.ref, decoratorInstanceId: id, paramName, value }));
    }
    if (position < chain.length) env.dispatch(decoratorMoved({ ...target.ref, fromIndex: chain.length, toIndex: position }));
  });
  return chainAnswer(env, target, { transformerId: id });
}

function updateTransformer(env: CanvasEnv, input: Input) {
  const target = chainTarget(env.getState(), input);
  const { chain, index, step } = stepOf(target, str(input, 'transformerId'));
  const decorator = transformerOf(step.decoratorId);
  const params = checkedParams(decorator.parameters, asRecord(input.params, 'params'), decorator.label);
  requireFilled(decorator.parameters, { ...step.params, ...params }, decorator.label, value => !value);
  const position = input.position === undefined ? index : checkedPosition(input.position, chain.length - 1);
  if (position !== index) {
    const ids = chain.map(item => item.decoratorId);
    ids.splice(index, 1);
    ids.splice(position, 0, step.decoratorId);
    const error = chainError(target.base, ids);
    if (error) throw new ToolError(`Moving it there breaks the chain: ${error}`);
  }
  env.openFile(target.block.fileId);
  inOneStep(env.dispatch, () => {
    for (const [paramName, value] of Object.entries(params)) {
      env.dispatch(decoratorParamChanged({ ...target.ref, decoratorInstanceId: step.id, paramName, value }));
    }
    if (position !== index) env.dispatch(decoratorMoved({ ...target.ref, fromIndex: index, toIndex: position }));
  });
  return chainAnswer(env, target, { transformerId: step.id });
}

function removeTransformer(env: CanvasEnv, input: Input) {
  const target = chainTarget(env.getState(), input);
  const { chain, index, step } = stepOf(target, str(input, 'transformerId'));
  const ids = chain.map(item => item.decoratorId);
  ids.splice(index, 1);
  const error = chainError(target.base, ids);
  if (error) throw new ToolError(`Removing it alone breaks the chain: ${error} Remove or replace the steps after it too`);
  env.openFile(target.block.fileId);
  inOneStep(env.dispatch, () => env.dispatch(decoratorRemoved({ ...target.ref, decoratorInstanceId: step.id })));
  return chainAnswer(env, target, { removed: step.id });
}

// ---- Data-fed parameters ----

const isComputed = (source: BlockValueSource) => !source.literal && source.value_type !== 'data';

function bindParameter(env: CanvasEnv, input: Input) {
  const block = blockOf(env.getState(), str(input, 'blockId'));
  const descriptor = descriptorOf(block.blockId);
  if (descriptor.entries) throw new ToolError(`${descriptor.name} entries are edited with update_entry, not bound`);
  const param = str(input, 'param');
  const parameter = (descriptor.parameters ?? []).find(item => item.name === param);
  if (!parameter) throw new ToolError(`${descriptor.name} has no parameter ${param}; get_block_type lists them`);
  if (!isBindable(parameter))
    throw new ToolError(`${param} can’t be computed from data: only free-text parameters can (not options, numbers or variable pickers)`);
  const source = namedSource(descriptorOf(DEFINE_VARIABLE), str(input, 'valueSource'));
  if (!isComputed(source)) throw new ToolError(`${source.label} is typed in, not computed; type the value into the parameter instead (update_block)`);
  const existing = block.paramBindings?.[param];
  const params = checkedParams(source.parameters, asRecord(input.params, 'params'), source.label);
  const base = sourceBaseType(source) ?? 'string';
  const chain = existing?.decorators ?? [];
  if (existing && existing.valueSourceId !== source.id) {
    const error = chainError(
      base,
      chain.map(step => step.decoratorId)
    );
    if (error) throw new ToolError(`Its transformers don’t fit ${source.label}: ${error}`);
  }
  const merged = { ...defaultsOf(source.parameters), ...(existing?.valueSourceId === source.id ? existing.params : {}), ...params };
  requireFilled(source.parameters, merged, source.label);
  const ref = { instanceId: block.instanceId, entryId: `${BINDING_TARGET_PREFIX}${param}` };
  env.openFile(block.fileId);
  inOneStep(env.dispatch, () => {
    if (!existing) env.dispatch(paramBound({ instanceId: block.instanceId, param, binding: { valueSourceId: source.id, params: merged, decorators: [] } }));
    else {
      env.dispatch(blockValueSourceChanged({ ...ref, valueSourceId: source.id }));
      for (const [paramName, value] of Object.entries(merged)) env.dispatch(blockParamChanged({ ...ref, paramName, value }));
    }
  });
  const result = resultType(base, chain);
  return {
    blockId: block.instanceId,
    param,
    valueSource: source.id,
    chain: chainView(chain),
    result: typeName(result),
    note:
      result === 'slist' && !parameter.allow_list
        ? `This produces a list, and ${param} takes one value: add a join transformer last (add_transformer with param), or the promise repeats per item`
        : undefined
  };
}

function unbindParameter(env: CanvasEnv, input: Input) {
  const block = blockOf(env.getState(), str(input, 'blockId'));
  const param = str(input, 'param');
  if (!block.paramBindings?.[param]) throw new ToolError(`${block.label}’s ${param} isn’t computed from data`);
  env.openFile(block.fileId);
  inOneStep(env.dispatch, () => env.dispatch(paramUnbound({ instanceId: block.instanceId, param })));
  return { blockId: block.instanceId, param, value: block.params[param] ?? '' };
}

function listBindings(state: RootState, fileId: string | undefined) {
  const variable = descriptorOf(DEFINE_VARIABLE);
  return state.canvas
    .filter(block => (!fileId || block.fileId === fileId) && Object.keys(block.paramBindings ?? {}).length)
    .flatMap(block =>
      Object.entries(block.paramBindings ?? {}).map(([param, binding]) => {
        const source = sourceOf(variable, binding.valueSourceId);
        return {
          fileId: block.fileId,
          blockId: block.instanceId,
          block: block.label,
          param,
          valueSource: binding.valueSourceId,
          value: summaryOf(source, binding.params),
          params: binding.params,
          chain: chainView(binding.decorators),
          result: typeName(resultType(source?.value_type ?? 'string', binding.decorators))
        };
      })
    );
}

export const DEFINITION_TOOLS: Record<string, Tool> = {
  list_variables: (env, input) => listVariables(env.getState(), optionalStr(input, 'fileId')),
  list_classes: (env, input) => listClasses(env.getState(), optionalStr(input, 'fileId')),
  list_bindings: (env, input) => listBindings(env.getState(), optionalStr(input, 'fileId')),
  list_value_sources: (_env, input) => listValueSources(str(input, 'blockType')),
  list_transformers: () => listTransformers(),
  add_entry: (env, input) => addEntry(canvasOf(env), input),
  update_entry: (env, input) => updateEntry(canvasOf(env), input),
  remove_entry: (env, input) => removeEntry(canvasOf(env), input),
  move_entry: (env, input) => moveEntry(canvasOf(env), input),
  add_transformer: (env, input) => addTransformer(canvasOf(env), input),
  update_transformer: (env, input) => updateTransformer(canvasOf(env), input),
  remove_transformer: (env, input) => removeTransformer(canvasOf(env), input),
  bind_parameter: (env, input) => bindParameter(canvasOf(env), input),
  unbind_parameter: (env, input) => unbindParameter(canvasOf(env), input)
};
