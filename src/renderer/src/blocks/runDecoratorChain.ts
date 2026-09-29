import type { DecoratorInstance } from '../store/canvasSlice/types';
import { type DecoratorValueType, decoratorsById } from './decorators';
import { type DecoratorValue, UndefinedValueError, applyFallback, evaluateDecorator } from './evaluateDecorator';

export interface StepResult {
  error?: string;
  id: string;
  label: string;
  output: DecoratorValue;
}

// Preview caps: evaluation runs synchronously in render, so bound regex work.
// The entry-count cap applies to the sample only, so length() still counts a step's real output.
const MAX_SAMPLE_LENGTH = 4000;
const MAX_ENTRY_LENGTH = 500;
const MAX_LIST_ENTRIES = 200;

function capValue(value: DecoratorValue): DecoratorValue {
  if (!Array.isArray(value)) return value.slice(0, MAX_SAMPLE_LENGTH);
  return value.map(entry => entry.slice(0, MAX_ENTRY_LENGTH));
}

// Runs a transformation chain over a sample value, step by step — shared by
// the Preview dialog and the canvas's data-chain nodes. A list-typed source
// takes the sample one item per line, empty lines dropped (as readstringlist does).
// Once a step leaves the value undefined, only a fallback step recovers it.
export function runDecoratorChain(chain: DecoratorInstance[], sampleInput: string, baseType: DecoratorValueType): StepResult[] {
  const results: StepResult[] = [];
  const sample = sampleInput.slice(0, MAX_SAMPLE_LENGTH);
  const initial =
    baseType === 'slist'
      ? sample
          .split('\n')
          .filter(line => line !== '')
          .slice(0, MAX_LIST_ENTRIES)
      : sample;
  let previousOutput: DecoratorValue = capValue(initial);
  let isUndefined = false;

  for (const decoratorInstance of chain) {
    const decorator = decoratorsById.get(decoratorInstance.decoratorId);
    if (!decorator) continue;
    const step = { id: decoratorInstance.id, label: decorator.label };
    try {
      const recovered = isUndefined ? applyFallback(decorator, decoratorInstance.params, undefined) : undefined;
      if (isUndefined && recovered === undefined) throw new UndefinedValueError('an earlier step left it undefined');
      const output = capValue(recovered ?? evaluateDecorator(decorator, decoratorInstance.params, previousOutput));
      results.push({ ...step, output });
      previousOutput = output;
      isUndefined = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ ...step, output: previousOutput, error: message });
      if (error instanceof UndefinedValueError) isUndefined = true;
    }
  }

  return results;
}
