import { resolveBlockShape } from './resolveBlockShape';
import type { BlockDescriptor } from './types';

/** A new block's parameters: each one's default, or empty. */
export function initialParams(descriptor: BlockDescriptor): Record<string, string> {
  const { parameters } = resolveBlockShape(descriptor, undefined);
  return Object.fromEntries(parameters.map(parameter => [parameter.name, String(parameter.default ?? '')]));
}
