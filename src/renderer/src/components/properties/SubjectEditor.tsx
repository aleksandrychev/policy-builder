import { Fragment, type ReactNode, useState } from 'react';

import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Box, Button, Divider, Stack, TextField, Typography } from '@mui/material';

import { currentChainType } from '../../blocks/decorators';
import { primaryPromiseType } from '../../blocks/resolveBlockShape';
import { type BlockDescriptor, type BlockParameter, usesClassRefs } from '../../blocks/types';
import { sourceBaseType as chainBaseType } from '../../canvas/dataChains';
import type { EditableSubject } from '../../store/canvasSlice/types';
import { TemplateEditorDialog } from '../dialogs/TemplateEditorDialog';
import { TestTransformsDialog } from '../dialogs/TestTransformsDialog';
import type { TemplateToken } from '../editor/templateTokens';
import { ClassCombinationEditor } from './ClassCombinationEditor';
import { CollapsibleSectionTitle } from './CollapsibleSectionTitle';
import { ConditionSection, type ConditionSlot } from './ConditionSection';
import { InventorySection } from './InventorySection';
import type { NewClassDefinition } from './NewClassModal';
import type { ClassNameOption } from './classOptions';
import { AddDecoratorButton, DecoratorRow } from './decorators';
import { ParameterField } from './paramFields';
import { inputSx } from './styles';
import { VALUE_SOURCE_ICONS, valueSourceMenuItems } from './valueSources';

// Everything the form edits on one EditableSubject (a plain block instance,
// or one entry of a multi-entry block). PropertiesPanelProps' versions take
// a trailing `entryId` — omitted means "the instance itself"; SubjectEditor
// only ever sees these, already bound to the right target.
export interface SubjectCallbacks {
  onClassRefAdd: () => void;
  onClassRefChange: (classRefId: string, patch: { name?: string; negate?: boolean }) => void;
  onClassRefRemove: (classRefId: string) => void;
  // Adds a Define Class block (a Per condition row's "New class").
  onCreateClass?: (definition: NewClassDefinition) => void;
  onDecoratorAdd: (decoratorId: string) => void;
  onDecoratorMove: (fromIndex: number, toIndex: number) => void;
  onDecoratorParamChange: (decoratorInstanceId: string, paramName: string, value: string) => void;
  onDecoratorRemove: (decoratorInstanceId: string) => void;
  onInventoryAttributeNameChange: (attributeName: string) => void;
  onInventoryEnable: () => void;
  onInventoryRemove: () => void;
  onParamChange: (paramName: string, value: string) => void;
  onValueSourceChange: (valueSourceId: string) => void;
}

// The form for one EditableSubject: a plain block instance, or one entry of a
// multi-entry block (Define Variable / Define Class). Owns its dialog and
// section-expanded state, so callers key it per subject.
export function SubjectEditor({
  descriptor,
  subject,
  callbacks,
  conditions,
  classNameOptions,
  templateTokens,
  showInventory,
  nameWarning,
  paramSlot
}: {
  callbacks: SubjectCallbacks;
  classNameOptions: ClassNameOption[];
  conditions: ConditionSlot[];
  descriptor: BlockDescriptor;
  nameWarning?: string;
  // Lets a caller wrap or replace a top-level parameter's field (data binding).
  paramSlot?: (parameter: BlockParameter, field: ReactNode) => ReactNode;
  showInventory: boolean;
  subject: EditableSubject;
  templateTokens: TemplateToken[];
}) {
  const [editingParam, setEditingParam] = useState<BlockParameter | null>(null);
  const [testingTransforms, setTestingTransforms] = useState(false);
  const [transformsExpanded, setTransformsExpanded] = useState(() => (subject.decorators?.length ?? 0) > 0);

  const paramValue = (parameter: BlockParameter) => subject.params[parameter.name] ?? String(parameter.default ?? '');
  const selectedValueSource = descriptor.value_sources?.find(source => source.id === subject.valueSourceId) ?? descriptor.value_sources?.[0];
  // Decorators wrap a string or slist expression; the source's value_type is
  // what the chain starts from (none for data or typed-in values).
  const sourceBaseType = chainBaseType(selectedValueSource);
  const isDecoratable = sourceBaseType !== undefined;
  const subjectDecorators = subject.decorators ?? [];
  const chainType = currentChainType(subjectDecorators, sourceBaseType ?? 'string');
  const isClassCombination = usesClassRefs(selectedValueSource);
  const definesVariables = primaryPromiseType(descriptor) === 'vars';

  return (
    <>
      {(descriptor.parameters ?? []).map(parameter => {
        const field = (
          <ParameterField
            parameter={parameter}
            variableName={definesVariables && parameter.name === descriptor.entries?.name_param}
            value={paramValue(parameter)}
            onChange={value => callbacks.onParamChange(parameter.name, value)}
            onOpenEditor={() => setEditingParam(parameter)}
            templateTokens={templateTokens}
          />
        );
        return <Fragment key={parameter.name}>{paramSlot ? paramSlot(parameter, field) : field}</Fragment>;
      })}

      {nameWarning && <Typography sx={{ fontSize: 12, color: 'error.main', mt: -1 }}>{nameWarning}</Typography>}

      {descriptor.value_sources && (
        <TextField
          select
          label={descriptor.value_source_label ?? 'Value source'}
          value={selectedValueSource?.id ?? ''}
          onChange={event => callbacks.onValueSourceChange(event.target.value)}
          fullWidth
          size="small"
          sx={inputSx}
          slotProps={{
            select: {
              renderValue: value => {
                const source = descriptor.value_sources?.find(candidate => candidate.id === value);
                const Icon = source ? VALUE_SOURCE_ICONS[source.id] : undefined;
                return (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {Icon && <Icon sx={{ fontSize: 18, color: 'primary.main' }} />}
                    {source?.label}
                  </Box>
                );
              }
            }
          }}
        >
          {valueSourceMenuItems(descriptor.value_sources)}
        </TextField>
      )}

      {selectedValueSource?.help && <Typography sx={{ fontSize: 12, color: 'text.muted', mt: -1 }}>{selectedValueSource.help}</Typography>}

      {isClassCombination ? (
        <ClassCombinationEditor
          classRefs={subject.classRefs ?? []}
          options={classNameOptions}
          onAdd={callbacks.onClassRefAdd}
          onChange={callbacks.onClassRefChange}
          onRemove={callbacks.onClassRefRemove}
        />
      ) : (
        selectedValueSource?.parameters.map(parameter => (
          <ParameterField
            key={parameter.name}
            parameter={parameter}
            value={paramValue(parameter)}
            onChange={value => callbacks.onParamChange(parameter.name, value)}
            onOpenEditor={() => setEditingParam(parameter)}
            templateTokens={templateTokens}
            classNameOptions={classNameOptions}
            onCreateClass={callbacks.onCreateClass}
          />
        ))
      )}

      {isDecoratable && <Divider />}

      {isDecoratable && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <CollapsibleSectionTitle
              title={`Data transformation (${subjectDecorators.length})`}
              expanded={transformsExpanded}
              onToggle={() => setTransformsExpanded(current => !current)}
            />
            <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: 'text.muted' }}>Result: {chainType === 'slist' ? 'list' : 'string'}</Typography>
          </Box>
          {!transformsExpanded && (
            <Typography sx={{ fontSize: 11, color: 'text.muted', pl: 2.5 }}>Chains functions to transform the value before it&rsquo;s used.</Typography>
          )}
          {transformsExpanded && (
            <Stack spacing={1}>
              {subjectDecorators.map((decoratorInstance, index) => (
                <DecoratorRow
                  key={decoratorInstance.id}
                  decoratorInstance={decoratorInstance}
                  index={index}
                  count={subjectDecorators.length}
                  onParamChange={(paramName, value) => callbacks.onDecoratorParamChange(decoratorInstance.id, paramName, value)}
                  onRemove={() => callbacks.onDecoratorRemove(decoratorInstance.id)}
                  onMoveUp={() => callbacks.onDecoratorMove(index, index - 1)}
                  onMoveDown={() => callbacks.onDecoratorMove(index, index + 1)}
                />
              ))}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <AddDecoratorButton chainType={chainType} onAdd={callbacks.onDecoratorAdd} />
                {subjectDecorators.length > 0 && (
                  <Button size="small" startIcon={<PlayArrowIcon />} onClick={() => setTestingTransforms(true)}>
                    Preview
                  </Button>
                )}
              </Box>
            </Stack>
          )}
        </Box>
      )}

      {isDecoratable && <Divider />}

      {conditions.map(slot => (
        <ConditionSection
          key={slot.id}
          condition={slot.condition}
          scope={slot.scope}
          title={slot.title}
          notice={slot.notice}
          classNameOptions={classNameOptions}
          templateTokens={templateTokens}
          onEnable={slot.onEnable}
          onRemove={slot.onRemove}
          onModeChange={slot.onModeChange}
          onClassNameChange={slot.onClassNameChange}
          onCreateClass={slot.onCreateClass}
        />
      ))}

      {showInventory && (
        <>
          <Divider />
          <InventorySection
            inventory={subject.inventory}
            onEnable={callbacks.onInventoryEnable}
            onRemove={callbacks.onInventoryRemove}
            onAttributeNameChange={callbacks.onInventoryAttributeNameChange}
          />
        </>
      )}

      {testingTransforms && (
        <TestTransformsDialog open baseType={sourceBaseType ?? 'string'} decoratorChain={subjectDecorators} onClose={() => setTestingTransforms(false)} />
      )}

      {editingParam && (
        <TemplateEditorDialog
          open
          title={editingParam.label ?? editingParam.name}
          value={paramValue(editingParam)}
          variables={templateTokens}
          mustache={editingParam.mustache === true}
          help={editingParam.help}
          onClose={() => setEditingParam(null)}
          onSave={value => callbacks.onParamChange(editingParam.name, value)}
        />
      )}
    </>
  );
}
