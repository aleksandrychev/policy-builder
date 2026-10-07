import { decoratorsById } from './decorators';
import { type DecoratorValue, PATTERN_TOO_COMPLEX, UndefinedValueError, applyFallback, evaluateDecorator } from './evaluateDecorator';

// Expected values below were checked against real CFEngine (cf-promises 3.28 --show-vars).
const run = (decoratorId: string, params: Record<string, string>, input: DecoratorValue) => {
  const decorator = decoratorsById.get(decoratorId);
  if (!decorator) throw new Error(`no decorator ${decoratorId}`);
  return evaluateDecorator(decorator, params, input);
};

const list = ['abc', 'xbcx', 'bc', 'a'];

describe('grep / filter', () => {
  it('grep matches the whole entry, as CFEngine does', () => {
    expect(run('grep', { pattern: 'bc' }, ['abc', 'xbcx', 'bc'])).toEqual(['bc']);
  });

  it('grep anchors an alternation as a whole', () => {
    expect(run('grep', { pattern: 'a|bc' }, list)).toEqual(['bc', 'a']);
  });

  it('filter is anchored too, and can match literally or inverted', () => {
    expect(run('filter', { pattern: 'bc', is_regex: 'true', invert: 'false', max_results: '10' }, list)).toEqual(['bc']);
    expect(run('filter', { pattern: 'bc', is_regex: 'false', invert: 'false', max_results: '10' }, list)).toEqual(['bc']);
    expect(run('filter', { pattern: 'bc', is_regex: 'true', invert: 'true', max_results: '10' }, list)).toEqual(['abc', 'xbcx', 'a']);
  });

  it('filter stops at max_results; 0 keeps nothing', () => {
    expect(run('filter', { pattern: '.*', is_regex: 'true', invert: 'false', max_results: '2' }, list)).toEqual(['abc', 'xbcx']);
    expect(run('filter', { pattern: 'a.*', is_regex: 'true', invert: 'false', max_results: '0' }, list)).toEqual([]);
  });
});

describe('split-list (string_split)', () => {
  it('keeps the remainder in the last piece', () => {
    expect(run('split-list', { delimiter: ',', max_pieces: '2' }, 'a,b,c,d')).toEqual(['a', 'b,c,d']);
  });

  it('keeps empty pieces', () => {
    expect(run('split-list', { delimiter: ',', max_pieces: '10' }, 'a,,b,')).toEqual(['a', '', 'b', '']);
  });

  it('treats the delimiter as a regex', () => {
    expect(run('split-list', { delimiter: '[0-9]+', max_pieces: '10' }, 'a1b22c')).toEqual(['a', 'b', 'c']);
    expect(run('split-list', { delimiter: '.', max_pieces: '10' }, 'a.b.c')).toEqual(['', '', '', '', '', '']);
  });

  it('with one piece returns the input; below one is undefined', () => {
    expect(run('split-list', { delimiter: ',', max_pieces: '1' }, 'abc')).toEqual(['abc']);
    expect(() => run('split-list', { delimiter: ',', max_pieces: '0' }, 'abc')).toThrow(UndefinedValueError);
  });
});

describe('regex-replace', () => {
  it('takes \\N and $N backreferences', () => {
    expect(run('regex-replace', { pattern: '(\\w+) (\\w+)', replacement: '\\2 \\1', options: 'g' }, 'abc def')).toBe('def abc');
    expect(run('regex-replace', { pattern: '(\\w+) (\\w+)', replacement: '$2 $1', options: 'g' }, 'abc def')).toBe('def abc');
  });

  it('replaces only the first match without g, and honours i', () => {
    expect(run('regex-replace', { pattern: 'a', replacement: 'b', options: '' }, 'aaa')).toBe('baa');
    expect(run('regex-replace', { pattern: 'a', replacement: 'b', options: 'gi' }, 'AAA')).toBe('bbb');
  });

  // Verified with cf-promises: regex_replace("abc","b","[$0]","g") = "a[b]c".
  it('takes $0 / \\0 as the whole match', () => {
    expect(run('regex-replace', { pattern: 'b', replacement: '[$0]', options: 'g' }, 'abc')).toBe('a[b]c');
    expect(run('regex-replace', { pattern: '(b)', replacement: '[\\0]', options: 'g' }, 'abc')).toBe('a[b]c');
  });

  it('reports an invalid pattern as an error', () => {
    expect(() => run('regex-replace', { pattern: '(', replacement: '', options: '' }, 'abc')).toThrow();
  });
});

describe('lastnode', () => {
  it('takes what follows the last separator', () => {
    expect(run('lastnode', { separator: '/' }, 'a/b/c')).toBe('c');
    expect(run('lastnode', { separator: '/' }, 'abc')).toBe('abc');
  });

  it('is empty after a trailing separator', () => {
    expect(run('lastnode', { separator: '/' }, '/a/b/')).toBe('');
  });

  it('treats the separator as a regex', () => {
    expect(run('lastnode', { separator: '.' }, 'a.b.c')).toBe('');
  });
});

describe('sort', () => {
  it('lex is byte order: uppercase before lowercase', () => {
    expect(run('sort', { method: 'lex' }, ['b', 'B', 'a', 'A'])).toEqual(['A', 'B', 'a', 'b']);
  });

  it('int and real sort numerically', () => {
    expect(run('sort', { method: 'int' }, ['10', '9', '100', '1'])).toEqual(['1', '9', '10', '100']);
    expect(run('sort', { method: 'real' }, ['1.5', '1e1', '0.2', '-1'])).toEqual(['-1', '0.2', '1.5', '1e1']);
  });

  // Verified with cf-promises: non-numeric entries sort first.
  it('int puts non-numbers first, like CFEngine', () => {
    expect(run('sort', { method: 'int' }, ['b', '10', 'a', '2', '-3'])).toEqual(['a', 'b', '-3', '2', '10']);
  });

  it('does not change its input', () => {
    const input = ['b', 'a'];
    run('sort', { method: 'lex' }, input);
    expect(input).toEqual(['b', 'a']);
  });
});

describe('nth', () => {
  it('picks by index, negative from the end', () => {
    expect(run('nth', { index: '1' }, ['b', 'B', 'a', 'A'])).toBe('B');
    expect(run('nth', { index: '-1' }, ['b', 'B', 'a', 'A'])).toBe('A');
  });

  it('is undefined out of range or for a non-number', () => {
    expect(() => run('nth', { index: '10' }, ['b', 'B', 'a', 'A'])).toThrow(UndefinedValueError);
    expect(() => run('nth', { index: '-6' }, ['b', 'B', 'a', 'A'])).toThrow(UndefinedValueError);
    expect(() => run('nth', { index: 'x' }, ['a'])).toThrow(UndefinedValueError);
  });
});

describe('string_head / string_tail', () => {
  it('negative n drops from the other end', () => {
    expect(run('string-head', { length: '-2' }, 'abcdef')).toBe('abcd');
    expect(run('string-tail', { length: '-2' }, 'abcdef')).toBe('cdef');
    expect(run('string-head', { length: '-10' }, 'abcdef')).toBe('');
    expect(run('string-tail', { length: '-10' }, 'abcdef')).toBe('');
  });

  it('0 is empty; more than the length is everything', () => {
    expect(run('string-head', { length: '0' }, 'abcdef')).toBe('');
    expect(run('string-tail', { length: '0' }, 'abcdef')).toBe('');
    expect(run('string-head', { length: '10' }, 'abc')).toBe('abc');
    expect(run('string-tail', { length: '10' }, 'abc')).toBe('abc');
  });
});

describe('list functions', () => {
  it('length counts entries', () => {
    expect(run('length', {}, list)).toBe('4');
    expect(run('length', {}, [])).toBe('0');
  });

  it('join glues entries', () => {
    expect(run('join', { glue: '-' }, list)).toBe('abc-xbcx-bc-a');
    expect(run('join', { glue: ',' }, [])).toBe('');
  });

  it('an emptied parameter means its default, as the compiler reads it', () => {
    expect(run('join', { glue: '' }, ['a', 'b'])).toBe('a, b');
    expect(run('join', {}, ['a', 'b'])).toBe('a, b');
  });

  it('unique keeps first occurrences in order', () => {
    expect(run('unique', {}, ['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
    expect(run('unique', {}, ['b', 'a', 'b'])).toEqual(['b', 'a']);
  });

  it('maplist substitutes $(this)', () => {
    expect(run('maplist', { pattern: 'x_$(this)' }, list)).toEqual(['x_abc', 'x_xbcx', 'x_bc', 'x_a']);
  });
});

describe('string functions', () => {
  it('trim, reverse, replace, format', () => {
    expect(run('string-trim', {}, '  a b  ')).toBe('a b');
    expect(run('string-reverse', {}, 'abc')).toBe('cba');
    expect(run('string-replace', { find: '.', replacement: '-' }, 'a.b.c')).toBe('a-b-c');
    expect(run('format', { format_string: '[%5s]' }, 'ab')).toBe('[   ab]');
    expect(run('format', { format_string: '[%-5s]' }, 'cd')).toBe('[cd   ]');
    expect(run('format', { format_string: '100%% %s' }, 'x')).toBe('100% x');
  });

  it('refuses a list where a string is expected, and vice versa', () => {
    expect(() => run('string-upcase', {}, ['a'])).toThrow(/list/);
    expect(() => run('join', { glue: ',' }, 'a')).toThrow(/string/);
  });
});

describe('default-if-empty', () => {
  const fallback = decoratorsById.get('default-if-empty')!;

  it('swaps in the fallback when the value equals the trigger', () => {
    expect(evaluateDecorator(fallback, { trigger: '', fallback: 'none' }, '')).toBe('none');
    expect(evaluateDecorator(fallback, { trigger: 'n/a', fallback: 'none' }, 'n/a')).toBe('none');
  });

  it('passes any other value through', () => {
    expect(evaluateDecorator(fallback, { trigger: '', fallback: 'none' }, 'value')).toBe('value');
  });

  it('recovers an undefined value', () => {
    expect(applyFallback(fallback, { trigger: '', fallback: 'none' }, undefined)).toBe('none');
  });

  it('is not a fallback for other decorators', () => {
    expect(applyFallback(decoratorsById.get('string-trim')!, {}, undefined)).toBeUndefined();
  });
});

describe('pattern safety', () => {
  it.each(['(a+)+', '(a*)*', '(\\w+\\s?)+', '(?:a+)+', '((a+))+', '(a{1,3}){2,}'])('refuses the nested quantifier %s', pattern => {
    expect(() => run('regex-replace', { pattern, replacement: '', options: 'g' }, 'aaaa')).toThrow(PATTERN_TOO_COMPLEX);
    expect(() => run('grep', { pattern }, ['aaaa'])).toThrow(PATTERN_TOO_COMPLEX);
  });

  it.each(['(ab)+', '[(]+', '\\(a+\\)+', '(a|b)c+'])('allows the safe pattern %s', pattern => {
    expect(() => run('regex-replace', { pattern, replacement: '', options: 'g' }, 'aaaa')).not.toThrow();
  });
});
