import type { BlockInstance } from '../store/canvasSlice/types';
import { blockDescriptorsById } from './loadBlocks';

/** The CFEngine Build module a block's promise type comes from, e.g. Git Checkout's promise-type-git. */
export const requiredModule = (block: Pick<BlockInstance, 'blockId'>): string | undefined => blockDescriptorsById.get(block.blockId)?.requires_module;
