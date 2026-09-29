import type { DecoratorInstance } from '../store/canvasSlice/types';
import { PATTERN_TOO_COMPLEX } from './evaluateDecorator';
import { runDecoratorChain } from './runDecoratorChain';

let nextId = 0;
const step = (decoratorId: string, params: Record<string, string> = {}): DecoratorInstance => ({ id: `step-${++nextId}`, decoratorId, params });

describe('runDecoratorChain', () => {
  it('feeds each step the previous output', () => {
    const results = runDecoratorChain([step('string-trim'), step('string-upcase'), step('string-head', { length: '3' })], '  hello  ', 'string');
    expect(results.map(result => result.output)).toEqual(['hello', 'HELLO', 'HEL']);
    expect(results.every(result => result.error === undefined)).toBe(true);
  });

  it('crosses between strings and lists', () => {
    const results = runDecoratorChain(
      [step('split-list', { delimiter: ',', max_pieces: '1000' }), step('sort', { method: 'lex' }), step('join', { glue: '+' })],
      'c,a,b',
      'string'
    );
    expect(results.map(result => result.output)).toEqual([['c', 'a', 'b'], ['a', 'b', 'c'], 'a+b+c']);
  });

  it('reads a list sample one item per line, dropping empty lines', () => {
    const [result] = runDecoratorChain([step('length')], 'a\n\nb\nc\n', 'slist');
    expect(result.output).toBe('3');
  });

  it('skips unknown decorators', () => {
    const results = runDecoratorChain([step('nope'), step('string-upcase')], 'a', 'string');
    expect(results).toHaveLength(1);
    expect(results[0].output).toBe('A');
  });

  it('carries an undefined value through later steps until a fallback recovers it', () => {
    const chain = [
      step('split-list', { delimiter: ',', max_pieces: '1000' }),
      step('nth', { index: '5' }),
      step('string-upcase'),
      step('default-if-empty', { trigger: '', fallback: 'none' }),
      step('string-upcase')
    ];
    const results = runDecoratorChain(chain, 'a,b', 'string');
    expect(results[0].error).toBeUndefined();
    expect(results[1].error).toMatch(/undefined/);
    expect(results[2].error).toMatch(/undefined/);
    expect(results[3].output).toBe('none');
    expect(results[3].error).toBeUndefined();
    expect(results[4].output).toBe('NONE');
    expect(results[4].error).toBeUndefined();
  });

  it('shows an invalid regex as a step error rather than throwing', () => {
    let results: ReturnType<typeof runDecoratorChain> = [];
    expect(() => {
      results = runDecoratorChain([step('regex-replace', { pattern: '(', replacement: '', options: '' }), step('string-upcase')], 'abc', 'string');
    }).not.toThrow();
    expect(results[0].error).toBeTruthy();
    expect(results[0].output).toBe('abc');
    // Not an undefined value: the next step still runs on what came before.
    expect(results[1].output).toBe('ABC');
    expect(results[1].error).toBeUndefined();
  });

  it('refuses nested quantifiers', () => {
    const [result] = runDecoratorChain([step('regex-replace', { pattern: '(a+)+$', replacement: '', options: '' })], `${'a'.repeat(40)}!`, 'string');
    expect(result.error).toBe(PATTERN_TOO_COMPLEX);
  });

  it('caps huge samples so previews stay quick', () => {
    const started = performance.now();
    const [trimmed] = runDecoratorChain([step('regex-replace', { pattern: 'a', replacement: 'bb', options: 'g' })], 'a'.repeat(1_000_000), 'string');
    const [lines] = runDecoratorChain([step('sort', { method: 'lex' })], Array.from({ length: 10_000 }, (_, i) => `line${i}`).join('\n'), 'slist');
    expect(performance.now() - started).toBeLessThan(2000);
    expect((trimmed.output as string).length).toBeLessThanOrEqual(4000);
    expect((lines.output as string[]).length).toBeLessThanOrEqual(200);
  });

  it('counts a step’s full output even above the sample’s entry cap', () => {
    const chain = [step('split-list', { delimiter: ',', max_pieces: '100000' }), step('length')];
    const results = runDecoratorChain(chain, 'a,'.repeat(1000), 'string');
    expect(results[1].output).toBe('1001');
  });
});
