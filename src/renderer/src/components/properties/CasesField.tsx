import { useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { Autocomplete, Box, Button, IconButton, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';

import { type CaseRow, parseCases, serializeCases } from '../../blocks/cases';
import type { BlockParameter } from '../../blocks/types';
import type { TemplateToken } from '../editor/templateTokens';
import { type NewClassDefinition, NewClassModal } from './NewClassModal';
import { type ClassNameOption, classAutocompleteSlotProps, renderClassOption, renderClassOptionGroup } from './classOptions';
import { filterClassReferenceChars } from './inputFilters';
import { autocompleteSx, inputSx } from './styles';

export interface CasesFieldProps {
  classNameOptions: ClassNameOption[];
  label: string;
  onChange: (value: string) => void;
  // Adds a Define Class block; the row then uses its name.
  onCreateClass?: (definition: NewClassDefinition) => void;
  parameter: BlockParameter;
  templateTokens: TemplateToken[];
  value: string;
}

/** Condition → value rows, the first that holds wins; each condition picked like a block's Condition. */
export function CasesField({ classNameOptions, label, onChange, onCreateClass, parameter, templateTokens, value }: CasesFieldProps) {
  const rows = parseCases(value);
  const [creatingFor, setCreatingFor] = useState<number | null>(null);
  const update = (next: CaseRow[]) => onChange(serializeCases(next));
  const change = (index: number, patch: Partial<CaseRow>) => update(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  return (
    <Box>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.muted', mb: 0.75 }}>{label}</Typography>
      <Stack spacing={1}>
        {rows.map((row, index) => (
          <Paper key={index} variant="outlined" sx={{ p: 1 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start' }}>
              <TextField
                select
                size="small"
                value={row.mode}
                onChange={event => change(index, { mode: event.target.value as CaseRow['mode'] })}
                sx={{ ...inputSx, width: 104, flexShrink: 0 }}
                slotProps={{ htmlInput: { 'aria-label': 'Mode' } }}
              >
                <MenuItem value="if">If</MenuItem>
                <MenuItem value="unless">Unless</MenuItem>
              </TextField>
              <Autocomplete<ClassNameOption, false, false, true>
                freeSolo
                size="small"
                fullWidth
                options={classNameOptions}
                groupBy={option => option.group}
                getOptionLabel={option => (typeof option === 'string' ? option : option.name)}
                isOptionEqualToValue={(option, current) => typeof current !== 'string' && option.name === current.name}
                value={row.className}
                onChange={(_event, picked) =>
                  change(index, { className: filterClassReferenceChars(typeof picked === 'string' ? picked : (picked?.name ?? '')) })
                }
                onInputChange={(_event, typed, reason) => {
                  if (reason === 'input' || reason === 'clear') change(index, { className: filterClassReferenceChars(typed) });
                }}
                renderInput={params => <TextField {...params} placeholder="Class, e.g. debian" sx={autocompleteSx} />}
                renderGroup={renderClassOptionGroup}
                renderOption={renderClassOption}
                slotProps={classAutocompleteSlotProps}
              />
              <IconButton
                size="small"
                aria-label="Remove row"
                title="Remove row"
                onClick={() => update(rows.filter((_row, at) => at !== index))}
                sx={{ mt: 0.5 }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Stack>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 1 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Value"
                value={row.value}
                onChange={event => change(index, { value: event.target.value })}
                sx={inputSx}
                slotProps={{ htmlInput: { 'aria-label': 'Value', style: { fontFamily: 'monospace' } } }}
              />
              {onCreateClass && (
                <Button size="small" onClick={() => setCreatingFor(index)} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                  New class
                </Button>
              )}
            </Stack>
          </Paper>
        ))}
      </Stack>
      <Button size="small" startIcon={<AddIcon />} onClick={() => update([...rows, { className: '', mode: 'if', value: '' }])} sx={{ mt: 0.5 }}>
        Add condition
      </Button>
      {parameter.help && <Typography sx={{ fontSize: 11, color: 'text.muted' }}>{parameter.help}</Typography>}
      {onCreateClass && (
        <NewClassModal
          open={creatingFor !== null}
          classNameOptions={classNameOptions}
          templateTokens={templateTokens}
          onClose={() => setCreatingFor(null)}
          onCreate={definition => {
            onCreateClass(definition);
            if (creatingFor !== null) change(creatingFor, { className: definition.className });
            setCreatingFor(null);
          }}
        />
      )}
    </Box>
  );
}
