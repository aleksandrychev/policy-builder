import type { BlockInstance } from '../store/canvasSlice/types';
import type { PolicyFile } from '../store/filesSlice/types';
import type { ModuleInputField, ModuleInputQuestion } from './catalog';

/**
 * The input a project stored as a cfbs module asks for (cfbs.json `provides.<module>.input`): one
 * question per Module Input block entry, in file and canvas order. Answers become def.json
 * variables `cfbs:<bundle>.<variable>`, which the block's own variable reads (or its default).
 */

export const MODULE_INPUT_BLOCK = 'module-input';
const NAMESPACE = 'cfbs';
// cfbs validate's rule for variables (and bundles): letters and underscores.
const INPUT_NAME = /^[a-z_]+$/;
const FIELD_KEY = /^[a-z_][a-z0-9_]*$/;
const ANOTHER = 'Add another?';

export type ModuleInputKind = 'list' | 'table' | 'text';
const KINDS: Record<string, ModuleInputKind> = { 'input-text': 'text', 'input-list': 'list', 'input-table': 'table' };

export interface ModuleInput {
  entryId: string;
  fileId: string;
  instanceId: string;
  kind: ModuleInputKind;
  // What cfbs validate (or `cfbs input`) would refuse, worded for the author: such inputs aren't published.
  problems: string[];
  question: ModuleInputQuestion;
}

/** The bundle a module's answers go in: its name, as cfbs's bundle rule allows ("cis-level1" → "cis_level_"). */
export const inputBundle = (moduleName: string) => moduleName.toLowerCase().replace(/[^a-z_]/g, '_') || 'module';

export const inputVariable = (moduleName: string, variable: string) => `${NAMESPACE}:${inputBundle(moduleName)}.${variable}`;

// "site_root" → "Site root".
const labelOf = (key: string) => (key.charAt(0).toUpperCase() + key.slice(1)).replace(/_+/g, ' ').trim();

/** A table's fields: one per line, `key: question` with an optional ` = default`. */
export function tableFields(text: string): ModuleInputField[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [head, ...rest] = line.split(':');
      const [question, ...defaults] = rest.join(':').split('=');
      const key = head.trim();
      const value = defaults.join('=').trim();
      return { key, type: 'string', label: labelOf(key), question: question.trim(), ...(value ? { default: value } : {}) };
    });
}

function questionOf(kind: ModuleInputKind, params: Record<string, string>): ModuleInputQuestion {
  const variable = params.variable_name ?? '';
  const label = params.input_label?.trim() ?? '';
  const question = params.question?.trim() ?? '';
  if (kind === 'text') return { type: 'string', variable, label, question, ...(params.default?.trim() ? { default: params.default } : {}) };
  const subtype = kind === 'list' ? { type: 'string', label, question } : tableFields(params.fields ?? 'name: Name?');
  return { type: 'list', variable, label, question, while: params.while?.trim() || ANOTHER, subtype };
}

function problemsOf(input: ModuleInputQuestion, kind: ModuleInputKind, earlier: Set<string>): string[] {
  const problems: string[] = [];
  const variable = input.variable ?? '';
  if (!INPUT_NAME.test(variable)) problems.push('The variable name takes lowercase letters and _ only.');
  else if (earlier.has(variable)) problems.push(`Another input is already named ${variable}.`);
  if (!input.label) problems.push('It needs a label.');
  if (!input.question) problems.push('It needs a question.');
  if (kind === 'table') {
    const fields = Array.isArray(input.subtype) ? input.subtype : [];
    const keys = fields.map(field => field.key ?? '');
    if (!fields.length) problems.push('A table needs at least one field.');
    else if (!keys.every(key => FIELD_KEY.test(key))) problems.push('Field keys take lowercase letters, digits and _, starting with a letter.');
    else if (new Set(keys).size !== keys.length) problems.push('Two fields share a key.');
    if (fields.some(field => !field.question)) problems.push('Every field needs a question (key: question).');
  }
  return problems;
}

/** The project's module inputs: its Module Input blocks' entries, in file order, then canvas order. */
export function moduleInputs(canvas: BlockInstance[], files: PolicyFile[]): ModuleInput[] {
  const taken = new Set<string>();
  return files.flatMap(file =>
    canvas
      .filter(block => block.fileId === file.id && block.blockId === MODULE_INPUT_BLOCK)
      .flatMap(block =>
        (block.entries ?? []).map(entry => {
          const kind = KINDS[entry.valueSourceId ?? ''] ?? 'text';
          const question = questionOf(kind, entry.params);
          const problems = problemsOf(question, kind, taken);
          taken.add(question.variable ?? '');
          return { entryId: entry.id, fileId: file.id, instanceId: block.instanceId, kind, problems, question };
        })
      )
  );
}

/** cfbs.json's `input`: the questions cfbs accepts, with the module's namespace and bundle. */
export function cfbsInput(inputs: ModuleInput[], moduleName: string): Record<string, unknown>[] {
  const bundle = inputBundle(moduleName);
  return inputs
    .filter(input => input.problems.length === 0)
    .map(({ question: { default: value, label, question, subtype, type, variable, while: another } }) => ({
      type,
      variable,
      namespace: NAMESPACE,
      bundle,
      label,
      question,
      ...(type === 'list' ? { while: another, subtype } : value ? { default: value } : {})
    }));
}
