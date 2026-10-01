import { describe, expect, it } from 'vitest';

import { blockDescriptors, groupBlocksByCategory } from './loadBlocks';

describe('loadBlocks', () => {
  it('loads all built-in block descriptors', () => {
    expect(blockDescriptors.length).toBe(29);
    expect(blockDescriptors.every(block => block.id && block.category && ((block.steps?.length ?? 0) > 0 || (block.value_sources?.length ?? 0) > 0))).toBe(
      true
    );
  });

  it('groups blocks by category', () => {
    const groups = groupBlocksByCategory(blockDescriptors);
    expect(
      groups
        .get('Packages')
        ?.map(b => b.name)
        .sort()
    ).toEqual(['Install Package', 'Remove Package']);
  });
});
