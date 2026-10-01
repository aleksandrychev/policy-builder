// Mirrors blocks/schemas/block-descriptor.v1.json and common.v1.json.
import type { BlockOutcome } from '../store/edgesSlice/types';

// A plain string is a {{param}} template compiled to one quoted CFEngine string.
export type Template = string;

export interface CallExpression {
  args?: Expression[];
  call: string;
}

export interface BodyExpression {
  args?: Expression[];
  body: string;
  lib?: 'builder' | 'stdlib';
}

export interface ListExpression {
  list: Expression[];
}

export interface ListParamExpression {
  list_param: string;
}

// The entry's picked classes (Define Class's AND/OR combinations).
export interface ClassRefsExpression {
  class_refs: true;
}

export interface ClassExpressionExpression {
  class_expression: Template;
}

export interface BundleExpression {
  args?: Expression[];
  bundle: Template;
}

export interface VariableExpression {
  as: 'list' | 'name' | 'scalar';
  variable: Template;
}

// Decorators only: the incoming value.
export interface PreviousExpression {
  previous: 'value';
}

// Attributes only: left out when the parameter is empty.
export interface IfSetExpression {
  if_set: string;
  value: Expression;
}

// Attributes only: the parameter's text as its own file next to the policy (templates).
export interface TemplateFileExpression {
  template_file: string;
}

export type Expression =
  | Template
  | CallExpression
  | BodyExpression
  | ListExpression
  | ListParamExpression
  | ClassRefsExpression
  | ClassExpressionExpression
  | BundleExpression
  | VariableExpression
  | PreviousExpression
  | IfSetExpression
  | TemplateFileExpression;

export interface BlockStep {
  attributes?: Record<string, Expression>;
  promise_type: 'vars' | 'classes' | 'users' | 'files' | 'packages' | 'methods' | 'processes' | 'services' | 'commands' | 'storage' | 'reports';
  promiser: Template;
}

export interface LabelledOption {
  help?: string;
  label: string;
  value: string;
}

// Plain strings are value and label at once.
export type ParameterOption = LabelledOption | string;

export interface BlockParameter {
  allow_list?: boolean;
  allowed_chars?: string;
  default?: boolean | number | string;
  help?: string;
  integer?: boolean;
  label?: string;
  minimum?: number;
  mustache?: boolean;
  name: string;
  options?: ParameterOption[];
  path?: 'absolute';
  references?: 'variable';
  required: boolean;
  type: 'boolean' | 'number' | 'string' | 'text';
}

export type ValueType = 'data' | 'slist' | 'string';

// A variant of a block whose compiled promise depends on how the value is
// produced — see Define Variable's "Value source" selector.
export interface BlockValueSource {
  badge?: string;
  group?: string;
  help?: string;
  id: string;
  label: string;
  // Typed in (literal, list, JSON): no data chain, no decorators.
  literal?: boolean;
  parameters: BlockParameter[];
  steps: BlockStep[];
  value_type?: ValueType;
}

// See block-descriptor.v1.json's `entries`: one instance holds a list of
// definitions (several variables / classes) instead of exactly one.
export interface BlockEntriesConfig {
  name_param: string;
  noun: string;
  noun_plural: string;
}

// Either steps + parameters (a plain block) or value_sources is present,
// never both — enforced by the schema's oneOf, so both stay optional here.
export interface BlockDescriptor {
  // What a new arrow drawn from this block waits for (default "kept").
  arrow_default_outcome?: BlockOutcome;
  category: string;
  // own_bundle: sequenced (arrows, outcomes); file_vars: the file's shared vars bundle.
  compile_target: 'file_vars' | 'own_bundle';
  description?: string;
  entries?: BlockEntriesConfig;
  id: string;
  name: string;
  // Which step's outcome drives arrows.
  outcome_step?: number;
  parameters?: BlockParameter[];
  schema_version: 1;
  steps?: BlockStep[];
  value_source_label?: string;
  value_sources?: BlockValueSource[];
  version: number;
}

export const optionValue = (option: ParameterOption): string => (typeof option === 'string' ? option : option.value);
export const optionLabel = (option: ParameterOption): string => (typeof option === 'string' ? option : option.label);
export const optionHelp = (option: ParameterOption | undefined): string | undefined => (typeof option === 'object' ? option.help : undefined);

// The attribute ("and"/"or") taking the entry's picked classes ({class_refs}), if the source has one.
export function classRefsAttribute(source: BlockValueSource | undefined): string | undefined {
  const attributes = Object.entries(source?.steps[0]?.attributes ?? {});
  return attributes.find(([, value]) => typeof value === 'object' && 'class_refs' in value)?.[0];
}

export const usesClassRefs = (source: BlockValueSource | undefined): boolean => classRefsAttribute(source) !== undefined;
