import { describeCases } from '../blocks/cases';
import { entryName, entrySummary } from '../blocks/definitionEntries';
import { resolveBlockShape } from '../blocks/resolveBlockShape';
import { type BlockDescriptor, optionLabel, optionValue } from '../blocks/types';
import type { BlockInstance, EditableSubject } from '../store/canvasSlice/types';

export interface CardRow {
  error?: boolean;
  key: string;
  label: string;
  // An entry row of a multi-entry block ("name  value") rather than a
  // "Param label: value" row.
  monospaceLabel?: boolean;
  truncate: boolean;
  value: string;
}

const MAX_ENTRY_ROWS = 4;

function paramRows(descriptor: BlockDescriptor, subject: EditableSubject, errorParam?: string): CardRow[] {
  return resolveBlockShape(descriptor, subject.valueSourceId)
    .parameters.map(parameter => {
      const rawValue = subject.params[parameter.name] ?? '';
      const option = rawValue ? parameter.options?.find(candidate => optionValue(candidate) === rawValue) : undefined;
      const value = option
        ? optionLabel(option)
        : parameter.type === 'cases'
          ? describeCases(rawValue)
          : parameter.type === 'text'
            ? rawValue.replace(/\s+/g, ' ').trim()
            : rawValue;
      return {
        key: parameter.name,
        label: parameter.label ?? parameter.name,
        value,
        truncate: parameter.type === 'text' || parameter.type === 'cases',
        error: parameter.name === errorParam
      };
    })
    .filter(row => row.value);
}

// A single-entry block reads exactly like any other block (one row per
// filled param); several entries collapse to one "name  value" row each.
// `duplicateKeys` holds `${blockId}:${name}` for names defined twice in the file.
export function cardRows(instance: BlockInstance, descriptor: BlockDescriptor | undefined, duplicateKeys: Set<string>): { hidden: number; rows: CardRow[] } {
  if (!descriptor) return { rows: [], hidden: 0 };
  if (!descriptor.entries) return { rows: paramRows(descriptor, instance), hidden: 0 };

  const entries = instance.entries ?? [];
  const isDuplicate = (name: string) => Boolean(name) && duplicateKeys.has(`${instance.blockId}:${name}`);
  if (entries.length === 1) {
    const entry = entries[0];
    return { rows: paramRows(descriptor, entry, isDuplicate(entryName(descriptor, entry)) ? descriptor.entries.name_param : undefined), hidden: 0 };
  }
  const rows = entries.slice(0, MAX_ENTRY_ROWS).map(entry => {
    const name = entryName(descriptor, entry);
    return {
      key: entry.id,
      label: name || '(unnamed)',
      value: entrySummary(descriptor, entry),
      truncate: true,
      monospaceLabel: true,
      error: isDuplicate(name)
    };
  });
  return { rows, hidden: Math.max(0, entries.length - MAX_ENTRY_ROWS) };
}
