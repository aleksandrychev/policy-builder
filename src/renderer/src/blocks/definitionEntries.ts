import type { BlockInstance, DefinitionEntry } from '../store/canvasSlice/types';
import { describeCases } from './cases';
import { primaryPromiseType, resolveBlockShape } from './resolveBlockShape';
import { type BlockDescriptor, classRefsAttribute } from './types';

// Shared by every consumer of multi-entry blocks (see block-descriptor.v1.json's
// `entries`): the Properties panel, the canvas card, paste, and the
// reference/autocomplete builders.

export function newDefinitionEntry(descriptor: BlockDescriptor, overrides: Partial<Omit<DefinitionEntry, 'id'>> = {}): DefinitionEntry {
  const valueSourceId = overrides.valueSourceId ?? descriptor.value_sources?.[0]?.id;
  const defaults = Object.fromEntries(
    resolveBlockShape(descriptor, valueSourceId).parameters.map(parameter => [parameter.name, String(parameter.default ?? '')])
  );
  return { ...overrides, id: crypto.randomUUID(), valueSourceId, params: { ...defaults, ...overrides.params } };
}

export function entryName(descriptor: BlockDescriptor, entry: DefinitionEntry): string {
  return descriptor.entries ? (entry.params[descriptor.entries.name_param] ?? '').trim() : '';
}

// One short line describing what an entry's value is — the first filled
// param of its active value source, or the source itself when it has none
// ("Always true") or keeps its data outside params (class combinations).
export function entrySummary(descriptor: BlockDescriptor, entry: DefinitionEntry): string {
  const source = descriptor.value_sources?.find(candidate => candidate.id === entry.valueSourceId) ?? descriptor.value_sources?.[0];
  const combination = classRefsAttribute(source);
  if (entry.classRefs?.length && combination) {
    const glue = ` ${combination.toUpperCase()} `;
    return entry.classRefs.map(ref => `${ref.negate ? 'NOT ' : ''}${ref.name || '?'}`).join(glue);
  }
  const nameParam = descriptor.entries?.name_param;
  for (const parameter of source?.parameters ?? []) {
    if (parameter.name === nameParam) continue;
    const raw = entry.params[parameter.name] ?? '';
    const value = (parameter.type === 'cases' ? describeCases(raw) : raw).replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return source?.label ?? '';
}

// Names defined twice, as `${blockId}:${name}` keys, for one file's cards.
// Every Define Variable entry in a file lands in its `<bundle>_vars`, so
// variables collide per file; classes are project-wide names (default
// namespace), so they collide across files. A variable and a class sharing
// a name don't.
export function duplicateDefinitionKeys(allInstances: BlockInstance[], descriptorsById: Map<string, BlockDescriptor>, fileId: string | null): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const instance of allInstances) {
    const descriptor = descriptorsById.get(instance.blockId);
    if (!descriptor?.entries) continue;
    if (instance.fileId !== fileId && primaryPromiseType(descriptor) !== 'classes') continue;
    for (const entry of instance.entries ?? []) {
      const name = entryName(descriptor, entry);
      if (!name) continue;
      const key = `${instance.blockId}:${name}`;
      if (seen.has(key)) duplicates.add(key);
      else seen.add(key);
    }
  }
  return duplicates;
}
