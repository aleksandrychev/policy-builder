import { blockDescriptorsById } from '../blocks/loadBlocks';
import type { BlockValueSource } from '../blocks/types';
import type { BlockInstance, DefinitionEntry, ParamBinding } from '../store/canvasSlice/types';
import { DATA_NODE_PREFIX, DATA_NODE_WIDTH, dataFootprint, deriveDataChains, sourceBaseType } from './dataChains';

const step = (id: string, decoratorId = 'string-trim') => ({ id, decoratorId, params: {} });

const entry = (id: string, valueSourceId: string, overrides: Partial<DefinitionEntry> = {}): DefinitionEntry => ({
  id,
  valueSourceId,
  params: { variable_name: `var_${id}` },
  ...overrides
});

const defineVariable = (instanceId: string, entries: DefinitionEntry[], position = { x: 800, y: 400 }): BlockInstance => ({
  blockId: 'define-variable',
  entries,
  fileId: 'f1',
  instanceId,
  label: 'Define Variable',
  params: {},
  position
});

const withBindings = (instanceId: string, paramBindings: Record<string, ParamBinding>, position = { x: 800, y: 400 }): BlockInstance => ({
  blockId: 'install-package',
  fileId: 'f1',
  instanceId,
  label: 'Install',
  paramBindings,
  params: {},
  position
});

const unmeasured = () => undefined;
const derive = (instances: BlockInstance[], stored = {}, nodeHeight: (id: string) => number | undefined = unmeasured) =>
  deriveDataChains(instances, 'f1', stored, nodeHeight, blockDescriptorsById);

const sourceById = (id: string) => blockDescriptorsById.get('define-variable')!.value_sources!.find(source => source.id === id)!;

describe('deriveDataChains', () => {
  it('draws a chain for each computed entry, and none for typed-in ones', () => {
    const instance = defineVariable('dv', [
      entry('lit', 'literal'),
      entry('list', 'list'),
      entry('json', 'structured-data-literal'),
      entry('cmd', 'command-output'),
      entry('file', 'file-lines')
    ]);
    const chains = derive([instance]);
    expect(chains.map(chain => chain.owner)).toEqual([
      { instanceId: 'dv', entryId: 'cmd' },
      { instanceId: 'dv', entryId: 'file' }
    ]);
    expect(chains.map(chain => chain.targetLabel)).toEqual(['var_cmd', 'var_file']);
    expect(chains.every(chain => chain.targetKind === 'variable' && chain.targetId === 'dv')).toBe(true);
  });

  it('draws no chain for a literal entry even if it carries steps', () => {
    expect(derive([defineVariable('dv', [entry('lit', 'literal', { decorators: [step('s1')] })])])).toEqual([]);
  });

  it('draws one node per chain, listing its steps and sample', () => {
    const steps = [step('s1'), step('s2', 'string-upcase')];
    const [chain] = derive([defineVariable('dv', [entry('cmd', 'command-output', { decorators: steps, sampleInput: 'hello' })])]);
    expect(chain.steps).toEqual(steps);
    expect(chain.sampleInput).toBe('hello');
    expect(chain.source.id).toBe('command-output');
    expect(chain.nodeId).toBe(`${DATA_NODE_PREFIX}${chain.key}`);
  });

  it('draws a chain for every data-fed parameter, labelled with the parameter', () => {
    const chains = derive([withBindings('pkg', { package_name: { valueSourceId: 'file-content', params: { path: '/x' } } })]);
    expect(chains).toHaveLength(1);
    expect(chains[0].targetKind).toBe('parameter');
    expect(chains[0].targetLabel).toBe(blockDescriptorsById.get('install-package')!.parameters!.find(p => p.name === 'package_name')!.label);
    expect(chains[0].sourceParams).toEqual({ path: '/x' });
    expect(chains[0].owner.instanceId).toBe('pkg');
  });

  it('gives chains distinct keys', () => {
    const chains = derive([
      defineVariable('dv', [entry('a', 'command-output'), entry('b', 'command-output')]),
      withBindings('pkg', { package_name: { valueSourceId: 'file-content', params: {} } })
    ]);
    expect(new Set(chains.map(chain => chain.key)).size).toBe(3);
  });

  it('stacks a block’s chains in a column to its left, the first level with it', () => {
    const [first, second, third] = derive([
      defineVariable('dv', [entry('a', 'command-output'), entry('b', 'command-output', { decorators: [step('s1'), step('s2')] }), entry('c', 'command-output')])
    ]);
    expect(first.position.y).toBe(400);
    expect(first.position.x + DATA_NODE_WIDTH).toBeLessThan(800);
    expect(second.position.x).toBe(first.position.x);
    expect(third.position.x).toBe(first.position.x);
    expect(second.position.y).toBeGreaterThan(first.position.y);
    // Steps make a node taller, pushing the next one further down.
    expect(third.position.y - second.position.y).toBeGreaterThan(second.position.y - first.position.y);
  });

  it('stacks by measured heights once known', () => {
    const instance = defineVariable('dv', [entry('a', 'command-output'), entry('b', 'command-output')]);
    const [, second] = derive([instance], {}, () => 500);
    const [, estimated] = derive([instance]);
    expect(second.position.y).toBeGreaterThan(estimated.position.y);
    expect(second.position.y).toBeGreaterThanOrEqual(900);
  });

  it('keeps a stored (dragged) position', () => {
    const instance = defineVariable('dv', [entry('a', 'command-output')]);
    const [chain] = derive([instance]);
    const [moved] = derive([instance], { [chain.key]: { x: 1, y: 2 } });
    expect(moved.position).toEqual({ x: 1, y: 2 });
  });

  it('has nothing to derive without the Define Variable descriptor', () => {
    const instance = defineVariable('dv', [entry('a', 'command-output')]);
    expect(deriveDataChains([instance], 'f1', {}, unmeasured, new Map())).toEqual([]);
  });
});

describe('dataFootprint', () => {
  const footprint = (instance: BlockInstance, nodeHeight: (id: string) => number | undefined = unmeasured) =>
    dataFootprint(instance, 'f1', nodeHeight, blockDescriptorsById);

  it('is empty for a block with no chains', () => {
    expect(footprint(defineVariable('dv', [entry('lit', 'literal')]))).toEqual({ height: 0, left: 0 });
    expect(footprint({ ...withBindings('pkg', {}), paramBindings: undefined })).toEqual({ height: 0, left: 0 });
  });

  it('reserves the chain column left of the block, as tall as the stack', () => {
    const one = footprint(defineVariable('dv', [entry('a', 'command-output')]));
    const two = footprint(defineVariable('dv', [entry('a', 'command-output'), entry('b', 'command-output')]));
    expect(one.left).toBeGreaterThan(DATA_NODE_WIDTH);
    expect(two.left).toBe(one.left);
    expect(two.height).toBeGreaterThan(2 * one.height);
  });

  it('matches where the chains are drawn', () => {
    const instance = defineVariable('dv', [entry('a', 'command-output'), entry('b', 'command-output')], { x: 800, y: 0 });
    const chains = derive([instance], {}, () => 96);
    const { height, left } = footprint(instance, () => 96);
    expect(chains[0].position.x).toBe(800 - left);
    expect(chains.at(-1)!.position.y + 96).toBe(height);
  });
});

describe('sourceBaseType', () => {
  it('follows the source’s value_type', () => {
    expect(sourceBaseType(sourceById('command-output'))).toBe('string');
    expect(sourceBaseType(sourceById('file-lines'))).toBe('slist');
  });

  it('is undefined for structured data, typed-in values and no source', () => {
    expect(sourceBaseType(sourceById('structured-data-json'))).toBeUndefined();
    expect(sourceBaseType(sourceById('literal'))).toBeUndefined();
    expect(sourceBaseType(sourceById('list'))).toBeUndefined();
    expect(sourceBaseType(undefined)).toBeUndefined();
  });

  it('reads value_type rather than the source id', () => {
    const custom = { id: 'whatever', label: 'x', value_type: 'slist', parameters: [], steps: [] } as unknown as BlockValueSource;
    expect(sourceBaseType(custom)).toBe('slist');
    expect(derive([defineVariable('dv', [entry('a', 'file-lines')])])[0].baseType).toBe('slist');
  });
});
