import type { BlockInstance } from '../store/canvasSlice/types';
import { blockDescriptorsById } from './loadBlocks';

/**
 * The CFEngine Build module a block's promise type comes from. "promise-type-{{promise_type}}"
 * (Custom Promise) names it from the picked type: docker_compose → promise-type-docker-compose.
 */
export function requiredModule(block: Pick<BlockInstance, 'blockId' | 'params'>): string | undefined {
  const template = blockDescriptorsById.get(block.blockId)?.requires_module;
  const name = template?.replace(/\{\{(\w+)\}\}/g, (_match, param: string) => (block.params[param] ?? '').trim().replace(/_/g, '-'));
  return name && !name.endsWith('-') ? name : undefined;
}
