import { type ReactNode, useMemo, useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Box, Button, Divider, IconButton, Stack, TextField, Typography } from '@mui/material';

import { currentChainType } from '../blocks/decorators';
import { duplicateDefinitionKeys, entryName } from '../blocks/definitionEntries';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import { primaryPromiseType } from '../blocks/resolveBlockShape';
import type { BlockDescriptor, BlockParameter } from '../blocks/types';
import { sourceBaseType } from '../canvas/dataChains';
import { BINDING_TARGET_PREFIX } from '../store/canvasSlice';
import type { BlockInstance, Condition, DefinitionEntry, ParamBinding } from '../store/canvasSlice/types';
import type { BlockOutcome } from '../store/edgesSlice/types';
import type { PolicyFile } from '../store/filesSlice/types';
import { ConditionSection, type ConditionSlot, FileConditionNotice } from './properties/ConditionSection';
import { EntryList } from './properties/EntryList';
import type { NewClassDefinition } from './properties/NewClassModal';
import { type IncomingArrow, RunsWhenSection } from './properties/RunsWhenSection';
import { type SubjectCallbacks, SubjectEditor } from './properties/SubjectEditor';
import { capitalize } from './properties/capitalize';
import { buildClassNameOptions, buildTemplateTokens } from './properties/classOptions';
import { BindToDataLink, BoundParameter, isBindable } from './properties/dataBinding';
import { inputSx } from './properties/styles';

export { AddDecoratorButton } from './properties/decorators';
export { FileSettingsPanel } from './properties/FileSettingsPanel';
export type { IncomingArrow } from './properties/RunsWhenSection';
export type { NewClassDefinition } from './properties/NewClassModal';

interface PropertiesPanelProps {
  allInstances: BlockInstance[];
  currentFileId: string | null;
  descriptor: BlockDescriptor | undefined;
  // Shown when no block is selected (the file's settings).
  emptyState?: ReactNode;
  files: PolicyFile[];
  // Opened from a canvas data-chain node: the entry to jump to.
  focusEntryId?: string;
  incomingArrows: IncomingArrow[];
  instance: BlockInstance | undefined;
  onArrowOutcomesChange: (edgeId: string, outcomes: BlockOutcome[]) => void;
  onArrowRemove: (edgeId: string) => void;
  onBindParam: (param: string, valueSourceId: string) => void;
  onClassRefAdd: (entryId?: string) => void;
  onClassRefChange: (classRefId: string, patch: { name?: string; negate?: boolean }, entryId?: string) => void;
  onClassRefRemove: (classRefId: string, entryId?: string) => void;
  onConditionClassNameChange: (className: string, entryId?: string) => void;
  onConditionCreateClass: (definition: NewClassDefinition, entryId?: string) => void;
  onConditionEnable: (entryId?: string) => void;
  onConditionModeChange: (mode: 'if' | 'unless', entryId?: string) => void;
  onConditionRemove: (entryId?: string) => void;
  // Run Command only: replace the action with a Define Variable reading its output.
  onConvertToData?: () => void;
  onDecoratorAdd: (decoratorId: string, entryId?: string) => void;
  onDecoratorMove: (fromIndex: number, toIndex: number, entryId?: string) => void;
  onDecoratorParamChange: (decoratorInstanceId: string, paramName: string, value: string, entryId?: string) => void;
  onDecoratorRemove: (decoratorInstanceId: string, entryId?: string) => void;
  // Returns the new entry's id, so the panel can open it straight away.
  onEntryAdd: () => string;
  onEntryMove: (fromIndex: number, toIndex: number) => void;
  onEntryRemove: (entryId: string) => void;
  onIncomingModeChange: (mode: 'all' | 'any') => void;
  onInventoryAttributeNameChange: (attributeName: string, entryId?: string) => void;
  onInventoryEnable: (entryId?: string) => void;
  onInventoryRemove: (entryId?: string) => void;
  onLabelChange: (label: string) => void;
  onParamChange: (paramName: string, value: string, entryId?: string) => void;
  onUnbindParam: (param: string) => void;
  onValueSourceChange: (valueSourceId: string, entryId?: string) => void;
  // 1-based position in this file's execution order, for sequenced blocks.
  orderNumber?: number;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { instance, descriptor, allInstances, files, currentFileId, onLabelChange } = props;
  // Which entry of a multi-entry block is open for editing; null shows the
  // entry list. The panel is remounted per selected block (see ProjectView),
  // so this never leaks from one block to another.
  const [openEntryId, setOpenEntryId] = useState<string | null>(
    props.focusEntryId && !props.focusEntryId.startsWith(BINDING_TARGET_PREFIX) ? props.focusEntryId : null
  );
  const filesById = useMemo(() => new Map(files.map(file => [file.id, file])), [files]);
  // Built once per render, not per section: each walks every block in the project.
  const classNameOptions = useMemo(() => buildClassNameOptions(allInstances, filesById, currentFileId), [allInstances, filesById, currentFileId]);
  const templateTokens = useMemo(() => buildTemplateTokens(allInstances, filesById, currentFileId), [allInstances, filesById, currentFileId]);
  const fileCondition = currentFileId ? filesById.get(currentFileId)?.condition : undefined;

  if (!instance || !descriptor) return props.emptyState ?? null;

  const subjectCallbacks = (entryId?: string): SubjectCallbacks => ({
    onParamChange: (paramName, value) => props.onParamChange(paramName, value, entryId),
    onValueSourceChange: valueSourceId => props.onValueSourceChange(valueSourceId, entryId),
    onDecoratorAdd: decoratorId => props.onDecoratorAdd(decoratorId, entryId),
    onDecoratorRemove: decoratorInstanceId => props.onDecoratorRemove(decoratorInstanceId, entryId),
    onDecoratorParamChange: (decoratorInstanceId, paramName, value) => props.onDecoratorParamChange(decoratorInstanceId, paramName, value, entryId),
    onDecoratorMove: (fromIndex, toIndex) => props.onDecoratorMove(fromIndex, toIndex, entryId),
    onClassRefAdd: () => props.onClassRefAdd(entryId),
    onClassRefRemove: classRefId => props.onClassRefRemove(classRefId, entryId),
    onClassRefChange: (classRefId, patch) => props.onClassRefChange(classRefId, patch, entryId),
    onInventoryEnable: () => props.onInventoryEnable(entryId),
    onInventoryRemove: () => props.onInventoryRemove(entryId),
    onInventoryAttributeNameChange: attributeName => props.onInventoryAttributeNameChange(attributeName, entryId)
  });

  const conditionSlot = (condition: Condition | undefined, scope: string, entryId?: string, title?: string): ConditionSlot => ({
    id: entryId ?? 'block',
    condition,
    scope,
    title,
    notice: <FileConditionNotice condition={condition} fileCondition={fileCondition} onRemove={() => props.onConditionRemove(entryId)} />,
    onEnable: () => props.onConditionEnable(entryId),
    onRemove: () => props.onConditionRemove(entryId),
    onModeChange: mode => props.onConditionModeChange(mode, entryId),
    onClassNameChange: className => props.onConditionClassNameChange(className, entryId),
    onCreateClass: definition => props.onConditionCreateClass(definition, entryId)
  });

  const labelField = (
    <TextField label="Label" value={instance.label} onChange={event => onLabelChange(event.target.value)} fullWidth size="small" sx={inputSx} />
  );
  const panelSx = { flex: 1, overflowY: 'auto', p: 2 } as const;

  // Data-fed parameters of an action block: a Define Variable value source +
  // steps, edited with the same form Define Variable uses (minus the name).
  const defineVariable = blockDescriptorsById.get('define-variable');
  const bindingDescriptor = defineVariable && { ...defineVariable, parameters: [] };
  const computedSources = (defineVariable?.value_sources ?? []).filter(source => !source.literal && source.value_type !== 'data');
  const paramSlot = (parameter: BlockParameter, field: ReactNode): ReactNode => {
    const binding: ParamBinding | undefined = instance.paramBindings?.[parameter.name];
    if (binding && bindingDescriptor) {
      const source = bindingDescriptor.value_sources?.find(candidate => candidate.id === binding.valueSourceId);
      const producesList = currentChainType(binding.decorators ?? [], sourceBaseType(source) ?? 'string') === 'slist';
      return (
        <BoundParameter parameter={parameter} producesList={producesList} onUnbind={() => props.onUnbindParam(parameter.name)}>
          <SubjectEditor
            descriptor={bindingDescriptor}
            subject={binding}
            callbacks={subjectCallbacks(`${BINDING_TARGET_PREFIX}${parameter.name}`)}
            conditions={[]}
            classNameOptions={classNameOptions}
            templateTokens={templateTokens}
            showInventory={false}
          />
        </BoundParameter>
      );
    }
    if (!isBindable(parameter, descriptor.entries?.name_param)) return field;
    // One wrapper, so the panel's spacing goes around the pair and the link hugs its field.
    return (
      <Box>
        {field}
        <BindToDataLink
          fieldLabel={parameter.label ?? parameter.name}
          sources={computedSources}
          onBind={valueSourceId => props.onBindParam(parameter.name, valueSourceId)}
        />
      </Box>
    );
  };

  if (!descriptor.entries) {
    return (
      <Stack spacing={2} sx={panelSx}>
        {labelField}
        <SubjectEditor
          descriptor={descriptor}
          subject={instance}
          callbacks={subjectCallbacks()}
          conditions={[conditionSlot(instance.condition, 'this block')]}
          classNameOptions={classNameOptions}
          templateTokens={templateTokens}
          showInventory={false}
          paramSlot={paramSlot}
        />
        {descriptor.id === 'run-command' && props.onConvertToData && (
          <Box>
            <Button size="small" variant="outlined" onClick={props.onConvertToData}>
              Use its output as data
            </Button>
            <Typography sx={{ fontSize: 11, color: 'text.muted', mt: 0.5 }}>
              Turns this into a variable holding the command&rsquo;s output (execresult), which you can then transform and feed into other blocks.
            </Typography>
          </Box>
        )}
        <Divider />
        <RunsWhenSection
          orderNumber={props.orderNumber}
          arrows={props.incomingArrows}
          mode={instance.incomingMode ?? 'all'}
          onModeChange={props.onIncomingModeChange}
          onOutcomesChange={props.onArrowOutcomesChange}
          onRemove={props.onArrowRemove}
        />
      </Stack>
    );
  }

  const { noun, noun_plural } = descriptor.entries;
  const entries = instance.entries ?? [];
  const definesVariables = primaryPromiseType(descriptor) === 'vars';
  const duplicateKeys = duplicateDefinitionKeys(
    allInstances.filter(candidate => candidate.fileId === instance.fileId),
    blockDescriptorsById
  );
  const isDuplicate = (name: string) => duplicateKeys.has(`${instance.blockId}:${name}`);

  const handleAddEntry = () => setOpenEntryId(props.onEntryAdd());

  // The same form for one entry, whichever mode shows it.
  const entryEditor = (entry: DefinitionEntry, conditions: ConditionSlot[]) => {
    const name = entryName(descriptor, entry);
    return (
      <SubjectEditor
        key={entry.id}
        descriptor={descriptor}
        subject={entry}
        callbacks={subjectCallbacks(entry.id)}
        conditions={conditions}
        classNameOptions={buildClassNameOptions(allInstances, filesById, currentFileId, entry.id)}
        templateTokens={buildTemplateTokens(allInstances, filesById, currentFileId, entry.id)}
        showInventory={definesVariables}
        nameWarning={name && isDuplicate(name) ? `Another ${noun} in this file already uses this name — they would collide in the compiled policy.` : undefined}
      />
    );
  };

  // One entry: looks exactly like a single-definition block always has. The
  // block's own condition is the one shown; an entry-level one only appears
  // if it was set while the block still had several entries.
  if (entries.length <= 1) {
    const entry = entries[0];
    return (
      <Stack spacing={2} sx={panelSx}>
        {labelField}
        {entry &&
          entryEditor(entry, [
            conditionSlot(instance.condition, 'this block'),
            ...(entry.condition ? [conditionSlot(entry.condition, `this ${noun}`, entry.id, `${capitalize(noun)} condition`)] : [])
          ])}
        <Divider />
        <Box>
          <Button size="small" startIcon={<AddIcon />} onClick={handleAddEntry}>
            Add another {noun}
          </Button>
          <Typography sx={{ fontSize: 11, color: 'text.muted', pl: 0.5 }}>
            Define several {noun_plural} in this one block instead of placing a block for each.
          </Typography>
        </Box>
      </Stack>
    );
  }

  const openIndex = entries.findIndex(entry => entry.id === openEntryId);

  if (openIndex !== -1) {
    const entry = entries[openIndex];
    return (
      <Stack spacing={2} sx={panelSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: -1 }}>
          <IconButton size="small" title={`Back to all ${noun_plural}`} onClick={() => setOpenEntryId(null)}>
            <ArrowBackIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {instance.label}
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'text.muted' }}>
              {capitalize(noun)} {openIndex + 1} of {entries.length}
            </Typography>
          </Box>
        </Box>
        {entryEditor(entry, [conditionSlot(entry.condition, `this ${noun}`, entry.id)])}
        <Divider />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Button size="small" disabled={openIndex === 0} onClick={() => setOpenEntryId(entries[openIndex - 1].id)}>
            Previous
          </Button>
          <Button
            size="small"
            color="error"
            onClick={() => {
              props.onEntryRemove(entry.id);
              setOpenEntryId(null);
            }}
          >
            Remove
          </Button>
          {/* On the last entry, "Next" would be a dead end — offer adding the next one instead. */}
          {openIndex === entries.length - 1 ? (
            <Button size="small" startIcon={<AddIcon />} onClick={handleAddEntry} title={`Add another ${noun}`} sx={{ whiteSpace: 'nowrap' }}>
              Add
            </Button>
          ) : (
            <Button size="small" onClick={() => setOpenEntryId(entries[openIndex + 1].id)}>
              Next
            </Button>
          )}
        </Box>
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={panelSx}>
      {labelField}
      <EntryList
        descriptor={descriptor}
        entries={entries}
        isDuplicate={isDuplicate}
        onOpen={setOpenEntryId}
        onAdd={handleAddEntry}
        onMove={props.onEntryMove}
        onRemove={props.onEntryRemove}
      />
      <Divider />
      <ConditionSection
        {...conditionSlot(instance.condition, `every ${noun} in this block`)}
        classNameOptions={classNameOptions}
        templateTokens={templateTokens}
      />
    </Stack>
  );
}
