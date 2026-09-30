import decoratorsFile from '@blocks/lib/decorators.json';

import type { BlockParameter, Expression, Template } from './types';

// A value flowing through a decorator chain is either a scalar string or a
// list of strings (CFEngine's slist) — decorators can cross between the two
// (e.g. "Split into list" is string -> slist, "Join" is slist -> string).
export type DecoratorValueType = 'slist' | 'string';

/**
 * A value-transforming CFEngine function chained onto a Define Variable value
 * source, e.g. string_head(regex_replace(readfile(...), ...), 9). Mirrors
 * blocks/schemas/decorator.v1.json; data lives in blocks/lib/decorators.json,
 * shared with the Python compiler.
 *
 * Either `expression` wraps the incoming value ({"previous": "value"}), or
 * `fallback` swaps in a value when the incoming one is undefined or equals
 * `trigger`. `input_type`/`output_type` gate which decorators the UI offers
 * next; an "int" output (length) is a string to later steps.
 */
export interface Decorator {
  badge?: string;
  expression?: Expression;
  fallback?: { trigger: Template; value: Template };
  help?: string;
  id: string;
  input_type: DecoratorValueType;
  label: string;
  output_type: DecoratorValueType | 'int';
  parameters: BlockParameter[];
}

export interface DecoratorsFile {
  decorators: Decorator[];
  schema_version: 1;
}

const file = decoratorsFile as unknown as DecoratorsFile;
if (file.schema_version !== 1) console.error(`blocks/lib/decorators.json: unsupported schema_version ${String(file.schema_version)}`);

export const decorators: Decorator[] = file.decorators;

export const decoratorsById = new Map(decorators.map(decorator => [decorator.id, decorator]));

// What a decorator hands the next step: an int counts as a string.
export const chainOutputType = (decorator: Decorator): DecoratorValueType => (decorator.output_type === 'slist' ? 'slist' : 'string');

// `baseType` is what the value source produces before any decorator runs, so
// the first decorator offered matches what's actually flowing in.
export function currentChainType(chain: { decoratorId: string }[], baseType: DecoratorValueType = 'string'): DecoratorValueType {
  let type = baseType;
  for (const entry of chain) {
    const decorator = decoratorsById.get(entry.decoratorId);
    if (decorator) type = chainOutputType(decorator);
  }
  return type;
}
