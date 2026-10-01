import type { HTMLAttributes, ReactNode } from 'react';

import { Box, Typography } from '@mui/material';

import { entryName } from '../../blocks/definitionEntries';
import { blockDescriptorsById } from '../../blocks/loadBlocks';
import { primaryPromiseType } from '../../blocks/resolveBlockShape';
import { describeFileCondition } from '../../canvas/fileCondition';
import type { BlockInstance } from '../../store/canvasSlice/types';
import type { PolicyFile } from '../../store/filesSlice/types';
import { hardClasses } from '../editor/hardClasses';
import { specialVariables } from '../editor/specialVariables';
import type { TemplateToken } from '../editor/templateTokens';

// Other blocks across the project that define a class or variable the user
// might reference from a template. The policy is in the default namespace:
// a class (defined in a common bundle) is one name for the whole project,
// and a variable lives in its file's `<bundle>_vars` bundle, so every
// reference names that bundle — blocks compile to bundles of their own.
// Mustache paths follow datastate(): "vars.<bundle>_vars.<name>" /
// "classes.<name>".
function definitionToken(promiseType: string | undefined, definedName: string, bundle: string, label: string, group: string): TemplateToken | undefined {
  if (promiseType === 'classes') {
    return { name: definedName, mustachePath: `classes.${definedName}`, label, group, kind: 'class' };
  }
  if (promiseType === 'vars') {
    return { name: `${bundle}_vars.${definedName}`, mustachePath: `vars.${bundle}_vars.${definedName}`, label, group, kind: 'variable' };
  }
  return undefined;
}

// A gated file's definitions only exist on hosts where that file runs.
function otherFileGroup(file: PolicyFile): string {
  const gate = describeFileCondition(file.condition);
  return `Defined in ${file.name}${gate ? ` · only where it ${gate}` : ''}`;
}

// Every entry of a multi-entry block is its own token; `excludeEntryId` drops
// the entry currently being edited, so it isn't offered as a reference to itself.
function projectDefinedTokens(
  instances: BlockInstance[],
  filesById: Map<string, PolicyFile>,
  currentFileId: string | null,
  excludeEntryId?: string
): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  for (const instance of instances) {
    const descriptor = blockDescriptorsById.get(instance.blockId);
    const definingFile = filesById.get(instance.fileId);
    if (!descriptor?.entries || !definingFile) continue;
    const promiseType = primaryPromiseType(descriptor);
    const sameFile = instance.fileId === currentFileId;
    const group = sameFile ? 'Defined in this file' : otherFileGroup(definingFile);

    for (const entry of instance.entries ?? []) {
      const definedName = entryName(descriptor, entry);
      if (!definedName || entry.id === excludeEntryId) continue;
      const token = definitionToken(promiseType, definedName, definingFile.bundle, instance.label, group);
      if (token) tokens.push(token);
    }
  }
  return tokens;
}

// The full token list a TemplateEditorDialog offers for autocomplete —
// shared by the main "text" parameter editor and NewClassModal's, so a
// custom expression gets the same class/variable/hard-class insertion help
// wherever it's authored.
export function buildTemplateTokens(
  instances: BlockInstance[],
  filesById: Map<string, PolicyFile>,
  currentFileId: string | null,
  excludeEntryId?: string
): TemplateToken[] {
  return [
    ...projectDefinedTokens(instances, filesById, currentFileId, excludeEntryId),
    ...specialVariables.map(variable => ({
      name: variable.name,
      mustachePath: `vars.${variable.name}`,
      label: variable.description,
      group: 'CFEngine special variables',
      kind: 'variable' as const
    })),
    ...hardClasses.map(hardClass => ({
      name: hardClass.name,
      mustachePath: `classes.${hardClass.name}`,
      label: hardClass.description,
      group: 'CFEngine hard classes',
      kind: 'class' as const
    }))
  ];
}

export interface ClassNameOption {
  group: string;
  label: string;
  name: string;
}

// Classes defined in this file first, then classes defined in other files
// (grouped per file), then hard classes last — MUI's Autocomplete groupBy
// requires options to already be contiguous by group (it doesn't sort them
// itself), so the order built here is also the order they render in.
export function buildClassNameOptions(
  instances: BlockInstance[],
  filesById: Map<string, PolicyFile>,
  currentFileId: string | null,
  excludeEntryId?: string
): ClassNameOption[] {
  const classTokens = projectDefinedTokens(instances, filesById, currentFileId, excludeEntryId).filter(token => token.kind === 'class');
  const sameFileTokens = classTokens.filter(token => token.group === 'Defined in this file');
  const otherFileTokens = classTokens.filter(token => token.group !== 'Defined in this file').sort((a, b) => (a.group ?? '').localeCompare(b.group ?? ''));
  return [
    ...[...sameFileTokens, ...otherFileTokens].map(token => ({ name: token.name, label: token.label ?? token.name, group: token.group ?? '' })),
    ...hardClasses.map(hardClass => ({ name: hardClass.name, label: hardClass.description ?? hardClass.name, group: 'Hard classes' }))
  ];
}

// Reuses the same token set the text-editor dialog offers (project-defined
// variables plus CFEngine special variables) for any param declaring
// `references: 'variable'` — e.g. Define Class's "Variable is defined"
// check, which names an existing variable rather than defining a new one.
export function buildVariableNameOptions(templateTokens: TemplateToken[]): ClassNameOption[] {
  return templateTokens
    .filter(token => token.kind === 'variable')
    .map(token => ({ name: token.name, label: token.label ?? token.name, group: token.group ?? '' }));
}

export function renderClassOptionGroup(params: { children?: ReactNode; group: string; key: number }) {
  return (
    <li key={params.key}>
      <Box sx={{ px: 1.5, pt: 1, pb: 0.25 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted' }}>{params.group}</Typography>
      </Box>
      <ul style={{ padding: 0 }}>{params.children}</ul>
    </li>
  );
}

// MUI's own `.MuiAutocomplete-listbox .MuiAutocomplete-option` rule sets
// `align-items: center` with higher specificity than a plain sx class, which
// centers these two-line (name + description) options instead of left-
// aligning them — `!important` here is what it takes to actually win.
export function renderClassOption(props: HTMLAttributes<HTMLLIElement>, option: ClassNameOption) {
  return (
    <Box
      component="li"
      {...props}
      key={`${option.group}|${option.name}`}
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start !important', textAlign: 'left' }}
    >
      <Typography sx={{ fontSize: 13 }}>{option.name}</Typography>
      {option.label !== option.name && <Typography sx={{ fontSize: 11, color: 'text.muted' }}>{option.label}</Typography>}
    </Box>
  );
}

// The popper's Paper defaults to the theme's `background.paper` (a light
// grey), which reads as a different, dingier surface than the rest of the
// panel's white fields — forcing it to match here rather than in the theme.
export const classAutocompleteSlotProps = { paper: { sx: { bgcolor: 'background.input' } } };
