import { type CaseRow, serializeCases } from '../blocks/cases';
import { type BlockParameter, optionValue } from '../blocks/types';
import { acceptsNumberInput, numberError, pathError } from '../components/properties/inputFilters';
import { ToolError } from './shared';

/** A parameter's value checked as the Properties form checks it, for every tool that sets one. */

export type RawParams = Record<string, unknown>;

export function asRecord(value: unknown, key: string): RawParams | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ToolError(`${key} must be an object of name → value`);
  return value as RawParams;
}

function caseRows(value: unknown, name: string): string {
  let rows: unknown = value;
  if (typeof value === 'string') {
    try {
      rows = JSON.parse(value || '[]');
    } catch {
      throw new ToolError(`${name} must be a list of {className, mode, value} rows`);
    }
  }
  if (!Array.isArray(rows)) throw new ToolError(`${name} must be a list of {className, mode, value} rows`);
  return serializeCases(
    rows.map((row: unknown): CaseRow => {
      const { className, mode = 'if', value: rowValue } = (row ?? {}) as Record<string, unknown>;
      if (typeof className !== 'string' || typeof rowValue !== 'string' || (mode !== 'if' && mode !== 'unless')) {
        throw new ToolError(`Each ${name} row needs className and value strings, and a mode of if or unless`);
      }
      return { className, mode, value: rowValue };
    })
  );
}

function asText(parameter: BlockParameter, raw: unknown): string {
  if (Array.isArray(raw) && parameter.allow_list) return raw.join('\n');
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (typeof raw !== 'string') throw new ToolError(`${parameter.name} must be a string`);
  return raw;
}

function numberProblem(parameter: BlockParameter, value: string): string | undefined {
  if (!/^-?\d+(\.\d+)?$/.test(value) || !acceptsNumberInput(parameter, value)) return parameter.integer ? 'must be a whole number' : 'must be a number';
  return numberError(parameter, value);
}

// What the Properties form would refuse in a value, if anything.
export function valueProblem(parameter: BlockParameter, value: string): string | undefined {
  if (parameter.type === 'boolean' && value !== 'true' && value !== 'false') return 'is true or false';
  if (parameter.type === 'number' && value !== '') return numberProblem(parameter, value);
  const allowed = parameter.options?.map(optionValue);
  if (allowed && value !== '' && !allowed.includes(value)) return `is one of ${allowed.join(', ')}`;
  if (parameter.allowed_chars && !new RegExp(`^[${parameter.allowed_chars}]*$`).test(value)) {
    return `allows only ${parameter.allowed_chars} (${parameter.help ?? 'letters, numbers and underscores'})`;
  }
  const pathProblem = pathError(parameter, value);
  return pathProblem && `is invalid: ${pathProblem}`;
}

// One parameter's value as stored (a string).
export function paramValue(parameter: BlockParameter, raw: unknown): string {
  if (parameter.type === 'cases') return caseRows(raw, parameter.name);
  const value = asText(parameter, raw);
  const problem = valueProblem(parameter, value);
  if (problem) throw new ToolError(`${parameter.name} ${problem}`);
  return value;
}

export function checkedParams(parameters: BlockParameter[], raw: RawParams | undefined, owner: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    const parameter = parameters.find(item => item.name === name);
    if (!parameter) {
      const known = parameters.map(item => item.name);
      throw new ToolError(`${owner} has no parameter ${name}; ${known.length ? `it takes ${known.join(', ')}` : 'it takes none'}`);
    }
    params[name] = paramValue(parameter, value);
  }
  return params;
}

export const parameterView = (parameter: BlockParameter) => ({
  name: parameter.name,
  label: parameter.label,
  type: parameter.type,
  required: parameter.required,
  default: parameter.default,
  options: parameter.options?.map(optionValue),
  allowedChars: parameter.allowed_chars,
  absolutePath: parameter.path === 'absolute' || undefined,
  referencesVariable: parameter.references === 'variable' || undefined,
  // A "cases" parameter's value: a JSON list of rows.
  format:
    parameter.type === 'cases'
      ? 'JSON list of {"className": "debian", "mode": "if" | "unless", "value": "…"}; the first row whose condition holds wins'
      : undefined,
  help: parameter.help
});
