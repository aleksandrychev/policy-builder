import { blockDescriptorsById } from '../blocks/loadBlocks';
import type { BlockOutcome } from '../store/edgesSlice/types';
import { ALL_OUTCOMES, OUTCOMES, defaultOutcomesFor, describeOutcomes, toggleOutcome } from './outcomes';

describe('describeOutcomes', () => {
  it('describes a single outcome as itself', () => {
    for (const option of OUTCOMES) expect(describeOutcomes([option.outcome])).toMatchObject({ label: option.label, color: option.color });
  });

  it('calls all three "any outcome"', () => {
    expect(describeOutcomes(['not_kept', 'kept', 'repaired']).label).toBe('any outcome');
  });

  it('ORs two outcomes in menu order', () => {
    const description = describeOutcomes(['not_kept', 'kept']);
    expect(description.label).toBe('kept or not kept');
    expect(description.color).toBe('info');
    expect(description.symbol).toBe('✓✕');
  });
});

describe('toggleOutcome', () => {
  it('adds an outcome, keeping menu order', () => {
    expect(toggleOutcome(['not_kept'], 'kept')).toEqual(['kept', 'not_kept']);
  });

  it('removes a ticked outcome', () => {
    expect(toggleOutcome(['kept', 'repaired'], 'kept')).toEqual(['repaired']);
  });

  it('never leaves an arrow with no outcome', () => {
    expect(toggleOutcome(['kept'], 'kept')).toEqual(['kept']);
  });

  it('reaches every combination from the full set', () => {
    let outcomes: BlockOutcome[] = [...ALL_OUTCOMES];
    outcomes = toggleOutcome(outcomes, 'repaired');
    expect(outcomes).toEqual(['kept', 'not_kept']);
  });
});

describe('defaultOutcomesFor', () => {
  it('waits for "kept" unless the block says otherwise', () => {
    expect(defaultOutcomesFor(undefined)).toEqual(['kept']);
    expect(defaultOutcomesFor(blockDescriptorsById.get('install-package'))).toEqual(['kept']);
    expect(defaultOutcomesFor(blockDescriptorsById.get('render-template'))).toEqual(['repaired']);
  });
});
