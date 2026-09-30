import { entryName } from '../blocks/definitionEntries';
import type { BlockDescriptor } from '../blocks/types';
import type { BlockInstance, EditableSubject } from '../store/canvasSlice/types';

// A class/variable reference (Condition.className, ClassReference.name) with
// no ":" means "defined in this same file" (see projectDefinedTokens in
// PropertiesPanel.tsx). Pasting into a different file moves the *reference*
// but not what it refers to, so an unqualified name would otherwise silently
// point at nothing in the new file — prefixing the source file's namespace
// keeps it pointing at the (unmoved) original.
function requalifyReference(name: string, sourceNamespace: string | undefined): string {
  if (!name || !sourceNamespace || name.includes(':')) return name;
  return `${sourceNamespace}:${name}`;
}

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
// one of its entries), copied with fresh ids.
export function copySubjectFields(
  subject: EditableSubject,
  sourceNamespace: string | undefined,
  crossFile: boolean
): Pick<EditableSubject, 'classRefs' | 'condition' | 'decorators' | 'inventory'> {
  const requalify = (name: string) => (crossFile ? requalifyReference(name, sourceNamespace) : name);
  return {
    classRefs: subject.classRefs?.map(ref => ({ ...ref, id: crypto.randomUUID(), name: requalify(ref.name) })),
    decorators: subject.decorators?.map(decorator => ({ ...decorator, id: crypto.randomUUID(), params: { ...decorator.params } })),
    // A 'class' condition is a namespace-scoped name, so it needs
    // requalifying across files like any other class reference. A
    // 'change-signal' condition points at a specific instanceId — that
    // doesn't change meaning across files, so it's copied through as-is.
    condition:
      subject.condition?.kind === 'class'
        ? { ...subject.condition, className: requalify(subject.condition.className) }
        : subject.condition
          ? { ...subject.condition }
          : undefined,
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
