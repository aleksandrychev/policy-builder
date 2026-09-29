import type { BlockDescriptor, BlockParameter, BlockStep } from './types';

/**
 * Resolves a descriptor's effective parameters/steps for a given value
 * source selection. Plain blocks (no value_sources) just return their own
 * steps/parameters unchanged; variant blocks merge the shared parameters
 * with the selected variant's own. Falls back to the first variant when
 * `valueSourceId` doesn't match one (e.g. not chosen yet).
 */
export function resolveBlockShape(descriptor: BlockDescriptor, valueSourceId: string | undefined): { parameters: BlockParameter[]; steps: BlockStep[] } {
  if (!descriptor.value_sources) {
    return { parameters: descriptor.parameters ?? [], steps: descriptor.steps ?? [] };
  }
  const selected = descriptor.value_sources.find(source => source.id === valueSourceId) ?? descriptor.value_sources[0];
  return { parameters: [...(descriptor.parameters ?? []), ...selected.parameters], steps: selected.steps };
}

export function primaryPromiseType(descriptor: BlockDescriptor): string | undefined {
  if (descriptor.steps) return descriptor.steps[0]?.promise_type;
  return descriptor.value_sources?.[0]?.steps[0]?.promise_type;
}
