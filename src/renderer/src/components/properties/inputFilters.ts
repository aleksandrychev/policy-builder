import type { BlockParameter } from '../../blocks/types';

// Generic live-filter driven by a parameter's own `allowed_chars` (see
// block-descriptor.v1.json) rather than a hardcoded charset — lets any block
// param declare its own validation instead of PropertiesPanel special-casing
// parameter names. Filtering disallowed characters out as the user types
// keeps every value these fields ever hold guaranteed valid, rather than
// validating after the fact. A param with no `allowed_chars` is unrestricted
// — e.g. a reference to an existing name that legitimately needs '.'/':'
// (namespace/scope separators), unlike the identifier being defined.
export function filterAllowedChars(value: string, allowedChars: string | undefined): string {
  if (!allowedChars) return value;
  return value.replace(new RegExp(`[^${allowedChars}]`, 'g'), '');
}

// NewClassModal creates an ad-hoc class outside any block's parameter list,
// so it has no BlockParameter to read allowed_chars/help from — these stay
// as its own constants rather than joining the generic mechanism above.
export const IDENTIFIER_HELP_TEXT = 'Letters, numbers, and underscores only.';
export function filterIdentifierChars(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '');
}

// A *reference* to an existing class (as opposed to a name being defined)
// also needs to allow ':' — cross-file class references are namespace-
// qualified as "namespace:name" (see projectDefinedTokens in classOptions.tsx).
export function filterClassReferenceChars(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:]/g, '');
}

// path: "absolute" — a $(var) / ${var} prefix may expand to one, so it passes.
const isAbsoluteish = (path: string) => /^(\/|\$\(|\$\{)/.test(path);

export function pathError(parameter: BlockParameter, value: string): string | undefined {
  if (parameter.path !== 'absolute') return undefined;
  const values = parameter.allow_list ? value.split('\n') : [value];
  const bad = values.map(line => line.trim()).filter(line => line && !isAbsoluteish(line));
  if (bad.length === 0) return undefined;
  return parameter.allow_list ? `Not an absolute path: ${bad.join(', ')}` : 'Must be an absolute path (start with /).';
}

// Whether a number field may hold this (partial) input: integers only / no negatives below a minimum >= 0.
export function acceptsNumberInput(parameter: BlockParameter, value: string): boolean {
  const negativeAllowed = parameter.minimum === undefined || parameter.minimum < 0;
  if (!negativeAllowed && value.startsWith('-')) return false;
  return !parameter.integer || /^-?\d*$/.test(value);
}

export function numberError(parameter: BlockParameter, value: string): string | undefined {
  if (value === '' || parameter.minimum === undefined) return undefined;
  return Number(value) < parameter.minimum ? `Must be at least ${parameter.minimum}.` : undefined;
}
