import type { Mock } from 'vitest';

import { newDefinitionEntry } from '../blocks/definitionEntries';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import { undone } from '../store/history';
import { projectCreated } from '../store/projectSlice';
import { type TestStore, addBlock, addFile, blockOf, makeStore } from '../store/test/storeTestUtils';
import { DEFINITION_TOOLS } from './definitionTools';
import type { Input, ToolEnv } from './shared';

let store: TestStore;
let env: ToolEnv;
let openFile: Mock<(fileId: string) => void>;
let fileId: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are JSON for the model
const call = (name: string, input: Input = {}) => DEFINITION_TOOLS[name](env, input) as Record<string, any>;

const defineBlock = (blockId: 'define-class' | 'define-variable', inFile = fileId) =>
  addBlock(store, inFile, { blockId, label: blockId, params: {}, entries: [newDefinitionEntry(blockDescriptorsById.get(blockId)!)] });

const entriesOf = (blockId: string) => blockOf(store, blockId)!.entries!;

beforeEach(() => {
  store = makeStore();
  store.dispatch(projectCreated({ name: 'Test' }));
  fileId = addFile(store, 'Web');
  openFile = vi.fn();
  env = {
    canvas: {
      openFile,
      selectedInstanceId: null,
      fitView: () => undefined,
      nodeHeight: () => undefined,
      sizeOf: () => ({ width: 200, height: 100 })
    },
    dispatch: store.dispatch,
    getState: store.getState,
    session: {} as ToolEnv['session']
  };
});

describe('entries', () => {
  it('fills a new block’s blank entry, in one undo step, on the open canvas', () => {
    const blockId = defineBlock('define-variable');
    const before = entriesOf(blockId);
    const answer = call('add_entry', { blockId, name: 'pkg', params: { value: 'nginx' } });
    expect(entriesOf(blockId)).toHaveLength(1);
    expect(entriesOf(blockId)[0]).toMatchObject({ id: answer.entryId, valueSourceId: 'literal', params: { variable_name: 'pkg', value: 'nginx' } });
    expect(answer.reference).toEqual({ sameFile: 'vars.pkg', otherFiles: 'web:vars.pkg', mustache: '{{{vars.web:vars.pkg}}}' });
    expect(openFile).toHaveBeenCalledWith(fileId);
    store.dispatch(undone());
    expect(entriesOf(blockId)).toBe(before);
  });

  it('adds a second entry with a condition and an inventory attribute', () => {
    const blockId = defineBlock('define-variable');
    call('add_entry', { blockId, name: 'a', params: { value: '1' } });
    call('add_entry', {
      blockId,
      name: 'b',
      params: { items: ['x', 'y'] },
      valueSource: 'list',
      condition: { className: 'debian', mode: 'if' },
      inventoryAttribute: 'B'
    });
    expect(entriesOf(blockId)[1]).toMatchObject({
      params: { variable_name: 'b', items: 'x\ny' },
      condition: { className: 'debian', mode: 'if' },
      inventory: { attributeName: 'B' }
    });
  });

  it('refuses bad names, sources and parameters', () => {
    const blockId = defineBlock('define-variable');
    call('add_entry', { blockId, name: 'pkg', params: { value: 'x' } });
    expect(() => call('add_entry', { blockId, name: 'pkg', params: { value: 'y' } })).toThrow(/already defines a variable named pkg/);
    expect(() => call('add_entry', { blockId, name: 'bad-name', params: { value: 'y' } })).toThrow(/allows only/);
    expect(() => call('add_entry', { blockId, name: 'x', valueSource: 'nope' })).toThrow(/no value source nope/);
    expect(() => call('add_entry', { blockId, name: 'x', params: { bogus: '1' } })).toThrow(/no parameter bogus/);
    expect(() => call('add_entry', { blockId, name: 'x' })).toThrow(/needs value/);
    expect(() => call('add_entry', { blockId, name: 'x', valueSource: 'command-output', params: { command: '/bin/ls', output: 'all' } })).toThrow(
      /output is one of stdout, stderr, both/
    );
    expect(() => call('add_entry', { blockId, name: 'x', valueSource: 'file-content', params: { path: 'etc/x' } })).toThrow(/absolute path/);
    expect(() => call('add_entry', { blockId: 'nope', name: 'x' })).toThrow(/No block nope/);
  });

  it('allows the same name in another file', () => {
    call('add_entry', { blockId: defineBlock('define-variable'), name: 'pkg', params: { value: 'x' } });
    const other = defineBlock('define-variable', addFile(store, 'Db'));
    expect(call('add_entry', { blockId: other, name: 'pkg', params: { value: 'y' } }).reference.otherFiles).toBe('db:vars.pkg');
  });

  it('defines classes, refusing hard class names and empty combinations', () => {
    const blockId = defineBlock('define-class');
    expect(() => call('add_entry', { blockId, name: 'linux' })).toThrow(/hard class/);
    expect(() => call('add_entry', { blockId, name: 'web', valueSource: 'combine-and' })).toThrow(/needs classRefs/);
    call('add_entry', { blockId, name: 'web', valueSource: 'combine-and', classRefs: [{ name: 'debian' }, { name: 'db:primary', negate: true }] });
    expect(entriesOf(blockId)[0].classRefs).toMatchObject([
      { name: 'debian', negate: false },
      { name: 'db:primary', negate: true }
    ]);
    expect(() => call('add_entry', { blockId, name: 'other', classRefs: [{ name: 'x' }] })).toThrow(/Only combine/);
  });

  it('updates name, source, class refs, condition and inventory in one step', () => {
    const id = defineBlock('define-class');
    const added = call('add_entry', { blockId: id, name: 'web', valueSource: 'combine-or', classRefs: [{ name: 'a' }] });
    call('update_entry', {
      blockId: id,
      entryId: added.entryId,
      name: 'www',
      classRefs: [{ name: 'b' }, { name: 'c' }],
      condition: { className: 'linux', mode: 'unless' }
    });
    expect(entriesOf(id)[0]).toMatchObject({
      params: { class_name: 'www' },
      classRefs: [{ name: 'b' }, { name: 'c' }],
      condition: { className: 'linux', mode: 'unless' }
    });
    call('update_entry', { blockId: id, entryId: added.entryId, condition: null, valueSource: 'check-file-exists', params: { path: '/etc/x' } });
    expect(entriesOf(id)[0]).toMatchObject({ valueSourceId: 'check-file-exists', condition: undefined });
    store.dispatch(undone());
    expect(entriesOf(id)[0]).toMatchObject({ valueSourceId: 'combine-or', condition: { className: 'linux' } });
    expect(() => call('update_entry', { blockId: id, entryId: added.entryId, inventoryAttribute: 'x' })).toThrow(/Only variables/);
  });

  it('removes and moves entries, keeping at least one', () => {
    const blockId = defineBlock('define-variable');
    const a = call('add_entry', { blockId, name: 'a', params: { value: '1' } }).entryId;
    const b = call('add_entry', { blockId, name: 'b', params: { value: '2' } }).entryId;
    call('move_entry', { blockId, entryId: b, toIndex: 0 });
    expect(entriesOf(blockId).map(entry => entry.id)).toEqual([b, a]);
    call('remove_entry', { blockId, entryId: a });
    expect(() => call('remove_entry', { blockId, entryId: b })).toThrow(/only entry/);
  });
});

describe('transformers', () => {
  const computed = () => {
    const blockId = defineBlock('define-variable');
    const { entryId } = call('add_entry', { blockId, name: 'out', valueSource: 'command-output', params: { command: '/bin/ls' } });
    return { blockId, entryId };
  };

  it('chains steps whose types fit, at a position', () => {
    const target = computed();
    expect(() => call('add_transformer', { ...target, transformer: 'grep', params: { pattern: 'x' } })).toThrow(/takes a list but gets a string/);
    call('add_transformer', { ...target, transformer: 'split-list', params: { delimiter: ' ' } });
    const answer = call('add_transformer', { ...target, transformer: 'length' });
    expect(answer.result).toBe('int');
    call('add_transformer', { ...target, transformer: 'sort', position: 1 });
    expect(entriesOf(target.blockId)[0].decorators!.map(step => step.decoratorId)).toEqual(['split-list', 'sort', 'length']);
    expect(call('list_variables').variables[0]).toMatchObject({ name: 'out', type: 'int', valueSource: 'command-output' });
  });

  it('updates, moves and removes steps, refusing a broken chain', () => {
    const target = computed();
    const split = call('add_transformer', { ...target, transformer: 'split-list', params: { delimiter: ',' } }).transformerId;
    const join = call('add_transformer', { ...target, transformer: 'join', params: { glue: ';' } }).transformerId;
    call('update_transformer', { ...target, transformerId: split, params: { delimiter: ':' } });
    expect(entriesOf(target.blockId)[0].decorators![0].params.delimiter).toBe(':');
    expect(() => call('update_transformer', { ...target, transformerId: join, position: 0 })).toThrow(/breaks the chain/);
    expect(() => call('remove_transformer', { ...target, transformerId: split })).toThrow(/breaks the chain/);
    call('remove_transformer', { ...target, transformerId: join });
    expect(entriesOf(target.blockId)[0].decorators).toHaveLength(1);
  });

  it('refuses typed-in values, and drops a chain on switching to one', () => {
    const target = computed();
    call('add_transformer', { ...target, transformer: 'string-trim' });
    const answer = call('update_entry', { ...target, valueSource: 'literal', params: { value: 'x' } });
    expect(answer.droppedTransformers).toBe(true);
    expect(entriesOf(target.blockId)[0].decorators).toEqual([]);
    expect(() => call('add_transformer', { ...target, transformer: 'string-trim' })).toThrow(/take no transformers/);
    expect(() => call('add_transformer', { ...target, transformer: 'nope' })).toThrow(/take no transformers|No transformer/);
  });
});

describe('data-fed parameters', () => {
  it('binds, chains and unbinds a free-text parameter', () => {
    const blockId = addBlock(store, fileId);
    expect(() => call('bind_parameter', { blockId, param: 'run_interval', valueSource: 'command-output' })).toThrow(/can’t be computed/);
    expect(() => call('bind_parameter', { blockId, param: 'message', valueSource: 'literal' })).toThrow(/typed in/);
    expect(() => call('bind_parameter', { blockId, param: 'message', valueSource: 'command-output' })).toThrow(/needs command/);
    call('bind_parameter', { blockId, param: 'message', valueSource: 'file-lines', params: { path: '/etc/hosts' } });
    call('add_transformer', { blockId, param: 'message', transformer: 'join', params: { glue: ',' } });
    expect(blockOf(store, blockId)!.paramBindings!.message).toMatchObject({ valueSourceId: 'file-lines', params: { path: '/etc/hosts', max_entries: '1000' } });
    expect(call('list_bindings')[0]).toMatchObject({ param: 'message', result: 'string', value: 'The lines of /etc/hosts' });
    // Rebinding keeps the chain if it still fits.
    expect(() => call('bind_parameter', { blockId, param: 'message', valueSource: 'file-content', params: { path: '/x' } })).toThrow(/don’t fit/);
    call('unbind_parameter', { blockId, param: 'message' });
    expect(blockOf(store, blockId)!.paramBindings).toEqual({});
  });
});

describe('listings', () => {
  it('lists variables and classes with their references, and the catalogs', () => {
    call('add_entry', { blockId: defineBlock('define-class'), name: 'web_role' });
    const classes = call('list_classes');
    expect(classes.classes[0]).toMatchObject({ name: 'web_role', valueSource: 'always-true', reference: { sameFile: 'web_role', otherFiles: 'web:web_role' } });
    expect(classes.hardClasses.examples).toContain('debian');
    expect(call('list_variables').variables).toEqual([]);
    expect(() => call('list_variables', { fileId: 'nope' })).toThrow(/No file/);
    const sources = call('list_value_sources', { blockType: 'define-variable' }).valueSources;
    expect(sources.find((source: { id: string }) => source.id === 'literal')).toMatchObject({ takesTransformers: false, bindable: false });
    expect(sources.find((source: { id: string }) => source.id === 'file-lines')).toMatchObject({ produces: 'list', takesTransformers: true, bindable: true });
    expect(call('list_transformers').transformers.find((item: { id: string }) => item.id === 'length')).toMatchObject({ input: 'list', output: 'int' });
  });
});
