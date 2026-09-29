import type { Condition } from '../store/canvasSlice/types';

// How a block's own condition relates to its file's: the same one is redundant,
// the opposite one means the block can never run.
export type FileConditionRelation = 'contradicts' | 'same';

export function relationToFileCondition(condition: Condition | undefined, fileCondition: Condition | undefined): FileConditionRelation | undefined {
  if (!condition?.className || !fileCondition?.className || condition.className !== fileCondition.className) return undefined;
  return condition.mode === fileCondition.mode ? 'same' : 'contradicts';
}

// "runs only if linux" / "skipped if windows"; undefined until a class is picked.
export function describeFileCondition(condition: Condition | undefined): string | undefined {
  if (!condition?.className) return undefined;
  return `${condition.mode === 'if' ? 'runs only if' : 'skipped if'} ${condition.className}`;
}
