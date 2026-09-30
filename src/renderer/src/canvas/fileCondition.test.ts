import type { Condition } from '../store/canvasSlice/types';
import { describeFileCondition, relationToFileCondition } from './fileCondition';

const condition = (mode: Condition['mode'], className: string): Condition => ({ kind: 'class', mode, className });

describe('relationToFileCondition', () => {
  it('spots the same condition as the file’s', () => {
    expect(relationToFileCondition(condition('if', 'linux'), condition('if', 'linux'))).toBe('same');
    expect(relationToFileCondition(condition('unless', 'linux'), condition('unless', 'linux'))).toBe('same');
  });

  it('spots the opposite condition', () => {
    expect(relationToFileCondition(condition('if', 'linux'), condition('unless', 'linux'))).toBe('contradicts');
    expect(relationToFileCondition(condition('unless', 'linux'), condition('if', 'linux'))).toBe('contradicts');
  });

  it('has nothing to say about other classes, missing or pending conditions', () => {
    expect(relationToFileCondition(condition('if', 'linux'), condition('if', 'windows'))).toBeUndefined();
    expect(relationToFileCondition(undefined, condition('if', 'linux'))).toBeUndefined();
    expect(relationToFileCondition(condition('if', 'linux'), undefined)).toBeUndefined();
    expect(relationToFileCondition(condition('if', ''), condition('if', ''))).toBeUndefined();
  });
});

describe('describeFileCondition', () => {
  it('reads as plain language', () => {
    expect(describeFileCondition(condition('if', 'linux'))).toBe('runs only if linux');
    expect(describeFileCondition(condition('unless', 'windows'))).toBe('skipped if windows');
  });

  it('is undefined until a class is picked', () => {
    expect(describeFileCondition(undefined)).toBeUndefined();
    expect(describeFileCondition(condition('if', ''))).toBeUndefined();
  });
});
