import type { ReactNode } from 'react';

import { Autocomplete, Box, Checkbox, FormControlLabel, InputAdornment, MenuItem, TextField, Typography } from '@mui/material';

import { type BlockParameter, optionHelp, optionLabel, optionValue } from '../../blocks/types';
import type { TemplateToken } from '../editor/templateTokens';
import { buildVariableNameOptions, classAutocompleteSlotProps, renderClassOption, renderClassOptionGroup } from './classOptions';
import { acceptsNumberInput, filterAllowedChars, numberError, pathError } from './inputFilters';
import { autocompleteSx, inputSx } from './styles';

interface FieldProps {
  // Validation message, shown instead of the help text.
  error?: string;
  label: string;
  onChange: (value: string) => void;
  onOpenEditor?: () => void;
  parameter: BlockParameter;
  templateTokens?: TemplateToken[];
  value: string;
  // The entry name of a variable-defining block: shown with a "$" prefix.
  variableName?: boolean;
}

interface FieldFactory {
  matches: (parameter: BlockParameter) => boolean;
  render: (props: FieldProps) => ReactNode;
}

function renderVariableReferenceField({ parameter, value, onChange, templateTokens, label, error }: FieldProps) {
  const options = buildVariableNameOptions(templateTokens ?? []);
  return (
    <Autocomplete
      freeSolo
      size="small"
      fullWidth
      options={options}
      groupBy={option => option.group}
      getOptionLabel={option => (typeof option === 'string' ? option : option.name)}
      value={value}
      onInputChange={(_event, newValue) => onChange(newValue)}
      renderInput={params => <TextField {...params} label={label} error={Boolean(error)} helperText={error ?? parameter.help} sx={autocompleteSx} />}
      renderGroup={renderClassOptionGroup}
      renderOption={renderClassOption}
      slotProps={classAutocompleteSlotProps}
    />
  );
}

function renderVariableNameField({ parameter, value, onChange, label }: FieldProps) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={event => onChange(filterAllowedChars(event.target.value, parameter.allowed_chars))}
      helperText={parameter.help}
      fullWidth
      size="small"
      slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> } }}
      sx={inputSx}
    />
  );
}

function renderOptionsField({ parameter, value, onChange, label }: FieldProps) {
  const options = parameter.options ?? [];
  const selected = options.find(option => optionValue(option) === value);
  // An option whose value is "" (e.g. "Every agent run") must still show its label.
  const hasEmptyOption = options.some(option => optionValue(option) === '');
  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={event => onChange(event.target.value)}
      helperText={optionHelp(selected) ?? parameter.help}
      fullWidth
      size="small"
      sx={inputSx}
      slotProps={{
        select: { displayEmpty: hasEmptyOption, renderValue: current => (selected ? optionLabel(selected) : String(current)) },
        inputLabel: hasEmptyOption ? { shrink: true } : undefined
      }}
    >
      {options.map(option => (
        <MenuItem key={optionValue(option)} value={optionValue(option)}>
          {optionLabel(option)}
        </MenuItem>
      ))}
    </TextField>
  );
}

function renderBooleanField({ parameter, value, onChange, label }: FieldProps) {
  return (
    <Box>
      <FormControlLabel control={<Checkbox checked={value === 'true'} onChange={event => onChange(String(event.target.checked))} />} label={label} />
      {parameter.help && <Typography sx={{ fontSize: 11, color: 'text.muted', pl: 4 }}>{parameter.help}</Typography>}
    </Box>
  );
}

function renderTextField({ parameter, value, onOpenEditor, label, error }: FieldProps) {
  return (
    <TextField
      label={label}
      value={value}
      error={Boolean(error)}
      helperText={error ?? (parameter.help ? `${parameter.help} Click to edit.` : 'Click to edit.')}
      fullWidth
      multiline
      minRows={3}
      maxRows={3}
      size="small"
      onClick={onOpenEditor}
      slotProps={{
        htmlInput: { style: { fontFamily: 'monospace', cursor: 'pointer' }, readOnly: true }
      }}
      sx={inputSx}
    />
  );
}

function renderPlainField({ parameter, value, onChange, label, error }: FieldProps) {
  const isNumber = parameter.type === 'number';
  // Integers use a text input: a number input reports "12." as "", hiding the stray dot.
  const numberInput = parameter.integer ? { inputMode: 'numeric' as const } : { min: parameter.minimum, step: 'any' };
  const handleChange = (next: string) => {
    if (isNumber && !acceptsNumberInput(parameter, next)) return;
    onChange(filterAllowedChars(next, parameter.allowed_chars));
  };
  return (
    <TextField
      label={label}
      type={isNumber && !parameter.integer ? 'number' : 'text'}
      value={value}
      onChange={event => handleChange(event.target.value)}
      error={Boolean(error)}
      helperText={error ?? parameter.help}
      fullWidth
      size="small"
      sx={inputSx}
      slotProps={isNumber ? { htmlInput: numberInput } : undefined}
    />
  );
}

// Checked in order, first match wins; anything unmatched is a plain text/number field.
const FIELD_FACTORIES: FieldFactory[] = [
  { matches: parameter => parameter.references === 'variable', render: renderVariableReferenceField },
  { matches: parameter => Boolean(parameter.options), render: renderOptionsField },
  { matches: parameter => parameter.type === 'boolean', render: renderBooleanField },
  { matches: parameter => parameter.type === 'text', render: renderTextField }
];

export function ParameterField(props: Omit<FieldProps, 'error' | 'label'>) {
  const { parameter, value } = props;
  const error = pathError(parameter, value) ?? (parameter.type === 'number' ? numberError(parameter, value) : undefined);
  const fieldProps = { ...props, error, label: parameter.label ?? parameter.name };
  if (props.variableName) return renderVariableNameField(fieldProps);
  const factory = FIELD_FACTORIES.find(candidate => candidate.matches(parameter));
  return (factory?.render ?? renderPlainField)(fieldProps);
}
