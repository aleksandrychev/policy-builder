import type { BlockInstance } from '../store/canvasSlice/types';
import { duplicateDefinitionKeys } from './definitionEntries';
import { blockDescriptorsById } from './loadBlocks';

const definitions = (fileId: string, blockId: 'define-class' | 'define-variable', names: string[]): BlockInstance => {
  const nameParam = blockId === 'define-class' ? 'class_name' : 'variable_name';
  return {
    blockId,
    fileId,
    instanceId: `${fileId}-${blockId}`,
    label: blockId,
    params: {},
    entries: names.map((name, index) => ({ id: `${fileId}-${index}`, params: { [nameParam]: name } }))
  };
};

describe('duplicateDefinitionKeys', () => {
  it('keeps classes per file: each file is its own namespace', () => {
    const all = [definitions('a', 'define-class', ['web_role']), definitions('b', 'define-class', ['web_role'])];

    expect(duplicateDefinitionKeys(all, blockDescriptorsById, 'a').size).toBe(0);
    expect(duplicateDefinitionKeys([definitions('a', 'define-class', ['web_role', 'web_role'])], blockDescriptorsById, 'a')).toEqual(
      new Set(['define-class:web_role'])
    );
  });

  it('keeps variables per file: each file has its own vars bundle', () => {
    const all = [definitions('a', 'define-variable', ['port']), definitions('b', 'define-variable', ['port'])];

    expect(duplicateDefinitionKeys(all, blockDescriptorsById, 'a').size).toBe(0);
    expect(duplicateDefinitionKeys([definitions('a', 'define-variable', ['port', 'port'])], blockDescriptorsById, 'a')).toEqual(
      new Set(['define-variable:port'])
    );
  });
});
