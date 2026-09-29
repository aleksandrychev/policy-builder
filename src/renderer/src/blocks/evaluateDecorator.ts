import type { Decorator } from './decorators';

export type DecoratorValue = string | string[];

/**
 * Approximates what a decorator's CFEngine function would produce, for the
 * Properties panel's transform tester — evaluated in JavaScript, not real
 * CFEngine. Notable approximations:
 * - regex_replace/grep/filter use JS RegExp, not CFEngine's PCRE; the "U"
 *   (ungreedy) and "x" (extended) sed/Perl-style option flags aren't
 *   emulated (JS has no equivalent).
 * - grep/filter anchor the pattern to the whole entry, and split-list merges
 *   the remainder into the last piece — both as CFEngine does (checked with cf-promises).
 * - Patterns with nested quantifiers are refused (see hasNestedQuantifier).
 * - sort()'s IP/MAC methods fall back to lexical sorting; only lex/int/real
 *   are implemented.
 * - A result CFEngine leaves undefined (nth out of range, ...) throws
 *   UndefinedValueError; runDecoratorChain carries that on to later steps.
 */
function asString(value: DecoratorValue): string {
  if (Array.isArray(value)) throw new Error('Expected a string here, but the chain produced a list.');
  return value;
}

function asList(value: DecoratorValue): string[] {
  if (!Array.isArray(value)) throw new Error('Expected a list here, but the chain produced a string.');
  return value;
}

export const PATTERN_TOO_COMPLEX = 'Pattern too complex to preview';

// The function call fails, leaving the variable undefined.
export class UndefinedValueError extends Error {
  constructor(reason: string) {
    super(`undefined (${reason})`);
    this.name = 'UndefinedValueError';
  }
}

const isInteger = (value: string | undefined) => /^\s*-?\d+\s*$/.test(value ?? '');

// A quantified group that itself contains a quantifier — (a+)+, (a*)*, (\w+\s?)+ —
// is the classic catastrophic-backtracking shape; previews run in render, so refuse it.
function hasNestedQuantifier(pattern: string): boolean {
  const groupHasQuantifier: boolean[] = [false];
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '\\') {
      index += 1;
    } else if (inClass) {
      inClass = char !== ']';
    } else if (char === '[') {
      inClass = true;
    } else if (char === '(') {
      groupHasQuantifier.push(false);
    } else if (char === ')' && groupHasQuantifier.length > 1) {
      const inner = groupHasQuantifier.pop() ?? false;
      if (inner && /[+*{]/.test(pattern[index + 1] ?? '')) return true;
      groupHasQuantifier[groupHasQuantifier.length - 1] ||= inner;
    } else if (/[+*{]/.test(char)) {
      groupHasQuantifier[groupHasQuantifier.length - 1] = true;
    }
  }
  return false;
}

function compilePattern(pattern: string, flags = ''): RegExp {
  if (hasNestedQuantifier(pattern)) throw new Error(PATTERN_TOO_COMPLEX);
  return new RegExp(pattern, flags);
}

// CFEngine's grep()/filter() match the whole entry, not a substring.
function compileAnchored(pattern: string): RegExp {
  return compilePattern(`^(?:${pattern})$`);
}

// string_split(): the remainder (delimiters included) stays in the last piece; a max below 1 fails.
function splitString(input: string, delimiter: string, maxPieces: number): string[] {
  if (!(maxPieces >= 1)) throw new UndefinedValueError('max pieces must be at least 1');
  const regex = compilePattern(delimiter, 'g');
  const pieces: string[] = [];
  let start = 0;
  let match: RegExpExecArray | null;
  while (pieces.length < maxPieces - 1 && (match = regex.exec(input))) {
    if (match[0] === '') {
      regex.lastIndex += 1;
      continue;
    }
    pieces.push(input.slice(start, match.index));
    start = match.index + match[0].length;
  }
  pieces.push(input.slice(start));
  return pieces;
}

function applyRegexReplace(input: string, pattern: string, replacement: string, options: string): string {
  let flags = '';
  if (options.includes('g')) flags += 'g';
  if (options.includes('m')) flags += 'm';
  if (options.includes('s')) flags += 's';
  if (options.includes('i')) flags += 'i';

  // CFEngine takes \1..\9 backreferences as well as $1, and $0 / \0 for the whole match; JS spells that $&.
  const jsReplacement = replacement.replace(/\\(\d)/g, '$$$1').replace(/\$0/g, '$$&');
  return input.replace(compilePattern(pattern, flags), jsReplacement);
}

// Only %s (with an optional width, %5s / %-5s) and %% — not full printf.
// Its one argument is the incoming value; a second %s has nothing to take.
function applyFormat(input: string, formatString: string): string {
  let substituted = false;
  return formatString.replace(/%(-?)(\d*)s|%%/g, (match, left: string | undefined, width: string | undefined) => {
    if (match === '%%') return '%';
    if (substituted) throw new UndefinedValueError('more %s than arguments');
    substituted = true;
    const size = Number(width) || 0;
    return left ? input.padEnd(size) : input.padStart(size);
  });
}

// lex is byte order (A-Z before a-z), not locale order.
const byteOrder = (a: string, b: string) => (a < b ? -1 : Number(a > b));

function applySort(list: string[], method: string): string[] {
  const sorted = [...list];
  if (method === 'int' || method === 'real') {
    // Non-numbers first (byte order among themselves), then numbers ascending.
    const isNumber = (value: string) => value.trim() !== '' && Number.isFinite(Number(value));
    sorted.sort((a, b) => Number(isNumber(a)) - Number(isNumber(b)) || (isNumber(a) ? Number(a) - Number(b) : byteOrder(a, b)));
  } else {
    sorted.sort(byteOrder);
  }
  return sorted;
}

// Negative n drops that many characters from the other end.
function stringHead(input: string, n: number): string {
  return n < 0 ? input.slice(0, Math.max(0, input.length + n)) : input.slice(0, n);
}

function stringTail(input: string, n: number): string {
  if (n < 0) return input.slice(-n);
  return n === 0 ? '' : input.slice(-n);
}

function nth(list: string[], index: string | undefined): string {
  if (!isInteger(index)) throw new UndefinedValueError('index is not a whole number');
  const value = list.at(Number(index));
  if (value === undefined) throw new UndefinedValueError('index out of range');
  return value;
}

function applyFilter(list: string[], params: Record<string, string>): string[] {
  const isRegex = params.is_regex !== 'false';
  const invert = params.invert === 'true';
  const maxResults = isInteger(params.max_results) ? Math.max(0, Number(params.max_results)) : Infinity;
  const regex = isRegex ? compileAnchored(params.pattern ?? '') : null;
  const matches = (entry: string) => (regex ? regex.test(entry) : entry === params.pattern);
  return list.filter(entry => (invert ? !matches(entry) : matches(entry))).slice(0, maxResults);
}

const substitute = (template: string, params: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => params[name] ?? '');

// A `fallback` decorator: its value when the input is undefined or equals the trigger.
export function applyFallback(decorator: Decorator, params: Record<string, string>, input: DecoratorValue | undefined): DecoratorValue | undefined {
  if (!decorator.fallback) return undefined;
  const fallback = substitute(decorator.fallback.value, params);
  if (input === undefined) return fallback;
  return asString(input) === substitute(decorator.fallback.trigger, params) ? fallback : input;
}

export function evaluateDecorator(decorator: Decorator, params: Record<string, string>, input: DecoratorValue): DecoratorValue {
  switch (decorator.id) {
    case 'regex-replace':
      return applyRegexReplace(asString(input), params.pattern ?? '', params.replacement ?? '', params.options ?? '');
    case 'string-head':
      return stringHead(asString(input), Math.trunc(Number(params.length)) || 0);
    case 'string-tail':
      return stringTail(asString(input), Math.trunc(Number(params.length)) || 0);
    case 'string-trim':
      return asString(input).trim();
    case 'string-downcase':
      return asString(input).toLowerCase();
    case 'string-upcase':
      return asString(input).toUpperCase();
    case 'string-reverse':
      return [...asString(input)].reverse().join('');
    case 'string-replace':
      return params.find
        ? asString(input)
            .split(params.find)
            .join(params.replacement ?? '')
        : input;
    case 'format':
      return applyFormat(asString(input), params.format_string ?? '%s');
    case 'lastnode':
      // The separator is a regex: lastnode("a.b.c", ".") is "".
      return (
        asString(input)
          .split(compilePattern(params.separator || '/'))
          .at(-1) ?? ''
      );
    case 'split-list':
      return splitString(asString(input), params.delimiter ?? '\\n', Number(params.max_pieces));
    case 'grep': {
      const regex = compileAnchored(params.pattern ?? '');
      return asList(input).filter(entry => regex.test(entry));
    }
    case 'filter':
      return applyFilter(asList(input), params);
    case 'maplist': {
      const pattern = params.pattern ?? '$(this)';
      return asList(input).map(entry => pattern.replaceAll('$(this)', entry));
    }
    case 'sort':
      return applySort(asList(input), params.method ?? 'lex');
    case 'unique':
      return [...new Set(asList(input))];
    case 'join':
      return asList(input).join(params.glue ?? '');
    case 'nth':
      return nth(asList(input), params.index);
    case 'length':
      return String(asList(input).length);
    default:
      return applyFallback(decorator, params, input) ?? input;
  }
}
