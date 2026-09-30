import { useState } from 'react';

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';

import { blockDescriptorsById } from '../../blocks/loadBlocks';
import { type BlockParameter, usesClassRefs } from '../../blocks/types';
import type { ClassReference } from '../../store/canvasSlice/types';
import { TemplateEditorDialog } from '../dialogs/TemplateEditorDialog';
import type { TemplateToken } from '../editor/templateTokens';
import { ClassCombinationEditor } from './ClassCombinationEditor';
import type { ClassNameOption } from './classOptions';
import { IDENTIFIER_HELP_TEXT, filterIdentifierChars } from './inputFilters';
import { ParameterField } from './paramFields';
import { inputSx } from './styles';
import { VALUE_SOURCE_ICONS, valueSourceMenuItems } from './valueSources';

// What the "+ New class" modal hands back — enough to add a real Define
// Class instance (see blocks/define-class.json's own shape) and then point
// the condition being edited at the class name it was given.
export interface NewClassDefinition {
  className: string;
  classRefs: ClassReference[];
  params: Record<string, string>;
  valueSourceId: string;
}

// Everything a condition might need to express — "always true", a function
// check, a combined AND/OR of other classes, a raw custom expression — is
// already exactly Define Class's own Always/Combine/Check/Custom value
// sources, so a block's Condition doesn't get a second, smaller predicate
// picker of its own; it always references a real class, either an existing
// one (hard class, or one defined elsewhere in the project) or one created
// on the spot through this modal, which reuses Define Class's own pieces
// (ParameterField, valueSourceMenuItems, ClassCombinationEditor) rather than
// re-deriving a parallel form.
export function NewClassModal({
  open,
  classNameOptions,
  templateTokens,
  onClose,
  onCreate
}: {
  classNameOptions: ClassNameOption[];
  onClose: () => void;
  onCreate: (definition: NewClassDefinition) => void;
  open: boolean;
  templateTokens: TemplateToken[];
}) {
  const defineClassDescriptor = blockDescriptorsById.get('define-class');
  const valueSources = defineClassDescriptor?.value_sources ?? [];
  const [className, setClassName] = useState('');
  const [valueSourceId, setValueSourceId] = useState(valueSources[0]?.id ?? '');
  const [params, setParams] = useState<Record<string, string>>({});
  const [classRefs, setClassRefs] = useState<ClassReference[]>([]);
  const [editingParam, setEditingParam] = useState<BlockParameter | null>(null);

  const selectedSource = valueSources.find(source => source.id === valueSourceId);
  const isClassCombination = usesClassRefs(selectedSource);
  const paramValue = (parameter: BlockParameter) => params[parameter.name] ?? String(parameter.default ?? '');

  const reset = () => {
    setClassName('');
    setValueSourceId(valueSources[0]?.id ?? '');
    setParams({});
    setClassRefs([]);
  };

  const handleClose = () => {
    onClose();
    reset();
  };

  const trimmedName = className.trim();

  const handleCreate = () => {
    if (!trimmedName) return;
    onCreate({ className: trimmedName, valueSourceId, params, classRefs });
    handleClose();
  };

  return (
    // A stray click outside keeps the form; Esc and Cancel still close it.
    <Dialog open={open} onClose={(_event, reason) => reason !== 'backdropClick' && handleClose()} fullWidth maxWidth="xs">
      <DialogTitle>New class</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Class name"
            value={className}
            onChange={event => setClassName(filterIdentifierChars(event.target.value))}
            helperText={IDENTIFIER_HELP_TEXT}
            fullWidth
            size="small"
            autoFocus
            sx={inputSx}
          />

          <TextField
            select
            label="Condition type"
            value={valueSourceId}
            onChange={event => {
              setValueSourceId(event.target.value);
              setParams({});
              setClassRefs([]);
            }}
            fullWidth
            size="small"
            sx={inputSx}
            slotProps={{
              select: {
                renderValue: value => {
                  const source = valueSources.find(candidate => candidate.id === value);
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
            {valueSourceMenuItems(valueSources)}
          </TextField>

          {selectedSource?.help && <Typography sx={{ fontSize: 12, color: 'text.muted', mt: -1 }}>{selectedSource.help}</Typography>}

          {isClassCombination ? (
            <ClassCombinationEditor
              classRefs={classRefs}
              options={classNameOptions}
              onAdd={() => setClassRefs(current => [...current, { id: crypto.randomUUID(), name: '', negate: false }])}
              onChange={(classRefId, patch) => setClassRefs(current => current.map(ref => (ref.id === classRefId ? { ...ref, ...patch } : ref)))}
              onRemove={classRefId => setClassRefs(current => current.filter(ref => ref.id !== classRefId))}
            />
          ) : (
            selectedSource?.parameters.map(parameter => (
              <ParameterField
                key={parameter.name}
                parameter={parameter}
                value={paramValue(parameter)}
                onChange={value => setParams(current => ({ ...current, [parameter.name]: value }))}
                onOpenEditor={() => setEditingParam(parameter)}
                templateTokens={templateTokens}
              />
            ))
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" disabled={!trimmedName} onClick={handleCreate}>
          Create
        </Button>
      </DialogActions>

      {editingParam && (
        <TemplateEditorDialog
          open
          title={editingParam.label ?? editingParam.name}
          value={paramValue(editingParam)}
          variables={templateTokens}
          mustache={editingParam.mustache === true}
          onClose={() => setEditingParam(null)}
          onSave={value => setParams(current => ({ ...current, [editingParam.name]: value }))}
        />
      )}
    </Dialog>
  );
}
