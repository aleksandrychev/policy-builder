import { entryName } from '../blocks/definitionEntries';
import type { BlockDescriptor } from '../blocks/types';
import type { BlockInstance, EditableSubject } from '../store/canvasSlice/types';

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
export function copyParamBindings(bindings: BlockInstance['paramBindings']): BlockInstance['paramBindings'] {
  if (!bindings) return undefined;
  return Object.fromEntries(
    Object.entries(bindings).map(([param, binding]) => [
      param,
      {
        ...binding,
        params: { ...binding.params },
        decorators: binding.decorators?.map(step => ({ ...step, id: crypto.randomUUID(), params: { ...step.params } }))
      }
    ])
  );
}

// The reference-bearing fields of a pasted subject (the instance itself, or
// one of its entries), copied with fresh ids. References need no rewriting
// across files: class names are project-wide, variables name their file's
// `<bundle>_vars`.
export function copySubjectFields(subject: EditableSubject): Pick<EditableSubject, 'classRefs' | 'condition' | 'decorators' | 'inventory'> {
  return {
    classRefs: subject.classRefs?.map(ref => ({ ...ref, id: crypto.randomUUID() })),
    decorators: subject.decorators?.map(decorator => ({ ...decorator, id: crypto.randomUUID(), params: { ...decorator.params } })),
    condition: subject.condition ? { ...subject.condition } : undefined,
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
