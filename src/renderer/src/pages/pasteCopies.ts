import { parseCases, serializeCases } from '../blocks/cases';
import { entryName } from '../blocks/definitionEntries';
import type { BlockDescriptor, BlockParameter } from '../blocks/types';
import type { BlockInstance, DecoratorInstance, EditableSubject } from '../store/canvasSlice/types';

// The file a block is pasted from, when that's another one. Its bare references meant that file's
// namespace, so they get qualified with it — except to what the pasted block defines itself.
export interface PasteOrigin {
  // Classes the origin file defines (Define Class), but not the pasted block.
  classes: Set<string>;
  namespace: string;
  // Variables the pasted block defines: `vars.x` to those stays local.
  ownVariables: Set<string>;
}

// `$(vars.x)` / `${vars.x}`; `vars.x` itself in a parameter naming a variable.
const VARIABLE_REFERENCE = /(\$[({])vars\.([A-Za-z0-9_]+)/g;
const VARIABLE_NAME = /^()vars\.([A-Za-z0-9_]+)/;

function qualifyVariables(text: string, origin: PasteOrigin | undefined, pattern = VARIABLE_REFERENCE): string {
  if (!origin) return text;
  return text.replace(pattern, (match, opening: string, name: string) =>
    origin.ownVariables.has(name) ? match : `${opening}${origin.namespace}:vars.${name}`
  );
}

// A class name or expression: names the origin file defines get its namespace; hard classes and
// qualified names stay as they are.
function qualifyClasses(text: string, origin: PasteOrigin | undefined): string {
  if (!origin) return text;
  return text.replace(/\$[({][^)}]*[)}]|[A-Za-z0-9_:]+/g, token =>
    token.startsWith('$') ? qualifyVariables(token, origin) : origin.classes.has(token) ? `${origin.namespace}:${token}` : token
  );
}

// Parameters compiled as a class expression (Define Class's custom expression).
function classExpressionParams(descriptor: BlockDescriptor): Set<string> {
  const names = JSON.stringify(descriptor).matchAll(/"class_expression":"\{\{(\w+)\}\}"/g);
  return new Set([...names].map(match => match[1]));
}

const allParameters = (descriptor: BlockDescriptor): BlockParameter[] => [
  ...(descriptor.parameters ?? []),
  ...(descriptor.value_sources ?? []).flatMap(source => source.parameters)
];

// A pasted subject's parameters, references into the origin file qualified with its namespace.
export function requalifyParams(
  params: Record<string, string>,
  descriptor: BlockDescriptor | undefined,
  origin: PasteOrigin | undefined
): Record<string, string> {
  if (!origin) return { ...params };
  const parameters = new Map(descriptor ? allParameters(descriptor).map(parameter => [parameter.name, parameter]) : []);
  const classExpressions = descriptor ? classExpressionParams(descriptor) : new Set<string>();
  return Object.fromEntries(
    Object.entries(params).map(([name, value]) => {
      if (parameters.get(name)?.type === 'cases') {
        const rows = parseCases(value);
        const requalified = rows.map(row => ({ ...row, className: qualifyClasses(row.className, origin), value: qualifyVariables(row.value, origin) }));
        return [name, rows.length ? serializeCases(requalified) : value];
      }
      if (classExpressions.has(name)) return [name, qualifyClasses(value, origin)];
      return [name, qualifyVariables(value, origin, parameters.get(name)?.references === 'variable' ? VARIABLE_NAME : VARIABLE_REFERENCE)];
    })
  );
}

const copyDecorators = (decorators: DecoratorInstance[] | undefined, origin: PasteOrigin | undefined) =>
  decorators?.map(step => ({
    ...step,
    id: crypto.randomUUID(),
    params: Object.fromEntries(Object.entries(step.params).map(([name, value]) => [name, qualifyVariables(value, origin)]))
  }));

// Defined names (each entry's variable_name/class_name) are only warned
// about, never enforced unique — but a same-file paste guarantees an
// immediate collision with the block it was copied from, so auto-suffixing
// just the names paste itself just created keeps that common case from
// silently defining the same class/variable twice, without trying to fix
// pre-existing collisions.
export function uniqueParamValue(candidate: string, taken: Set<string>): string {
  if (!candidate || !taken.has(candidate)) return candidate;
  let suffix = 2;
  let attempt = `${candidate}_copy`;
  while (taken.has(attempt)) {
    attempt = `${candidate}_copy${suffix}`;
    suffix += 1;
  }
  return attempt;
}

// A pasted block's data-fed parameters, with fresh step ids.
export function copyParamBindings(bindings: BlockInstance['paramBindings'], origin?: PasteOrigin): BlockInstance['paramBindings'] {
  if (!bindings) return undefined;
  return Object.fromEntries(
    Object.entries(bindings).map(([param, binding]) => [
      param,
      {
        ...binding,
        params: Object.fromEntries(Object.entries(binding.params).map(([name, value]) => [name, qualifyVariables(value, origin)])),
        decorators: copyDecorators(binding.decorators, origin)
      }
    ])
  );
}

// The reference-bearing fields of a pasted subject (the instance itself, or one of its entries),
// copied with fresh ids; from another file, its references there are qualified (see PasteOrigin).
export function copySubjectFields(
  subject: EditableSubject,
  origin?: PasteOrigin
): Pick<EditableSubject, 'classRefs' | 'condition' | 'decorators' | 'inventory'> {
  return {
    classRefs: subject.classRefs?.map(ref => ({ ...ref, id: crypto.randomUUID(), name: qualifyClasses(ref.name, origin) })),
    decorators: copyDecorators(subject.decorators, origin),
    condition: subject.condition ? { ...subject.condition, className: qualifyClasses(subject.condition.className, origin) } : undefined,
    inventory: subject.inventory ? { ...subject.inventory } : undefined
  };
}

// Every name already defined by blocks of this kind in the given (file's)
// instances — what a paste's names must not collide with.
export function definedNames(instances: BlockInstance[], blockId: string, descriptor: BlockDescriptor): Set<string> {
  const names = new Set<string>();
  for (const instance of instances) {
    if (instance.blockId !== blockId) continue;
    for (const entry of instance.entries ?? []) {
      const name = entryName(descriptor, entry);
      if (name) names.add(name);
    }
  }
  return names;
}
