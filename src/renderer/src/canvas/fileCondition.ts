import type { Condition } from '../store/canvasSlice/types';

// How a block's own condition relates to its file's: the same one is redundant,
// the opposite one means the block can never run.
export type FileConditionRelation = 'contradicts' | 'same';

export function relationToFileCondition(condition: Condition | undefined, fileCondition: Condition | undefined): FileConditionRelation | undefined {
  if (!condition?.className || !fileCondition?.className || condition.className !== fileCondition.className) return undefined;
  return condition.mode === fileCondition.mode ? 'same' : 'contradicts';
}

// The class guard the compiler puts on each of the file's promises: `linux`, `!windows`,
// `!(debian.webserver)`; undefined until a class is picked.
export function fileGuard(condition: Condition | undefined): string | undefined {
  const expression = condition?.className?.trim();
  if (!expression) return undefined;
  if (condition?.mode === 'if') return expression;
  return /[|.&!()]/.test(expression) ? `!(${expression})` : `!${expression}`;
}

// "guarded by linux" / "guarded by !windows".
export function describeFileCondition(condition: Condition | undefined): string | undefined {
  const guard = fileGuard(condition);
  return guard && `guarded by ${guard}`;
}
