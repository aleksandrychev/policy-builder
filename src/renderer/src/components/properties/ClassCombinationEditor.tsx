import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { Autocomplete, Box, Button, Checkbox, FormControlLabel, IconButton, Stack, TextField, Typography } from '@mui/material';

import type { ClassReference } from '../../store/canvasSlice/types';
import { type ClassNameOption, classAutocompleteSlotProps, renderClassOption, renderClassOptionGroup } from './classOptions';
import { filterClassReferenceChars } from './inputFilters';
import { autocompleteSx } from './styles';

function ClassRefRow({
  classRef,
  options,
  onChange,
  onRemove
}: {
  classRef: ClassReference;
  onChange: (patch: { name?: string; negate?: boolean }) => void;
  onRemove: () => void;
  options: ClassNameOption[];
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FormControlLabel
        sx={{ flexShrink: 0, mr: 0 }}
        control={<Checkbox size="small" checked={classRef.negate} onChange={event => onChange({ negate: event.target.checked })} />}
        label={<Typography sx={{ fontSize: 12, color: 'text.muted' }}>NOT</Typography>}
      />
      <Autocomplete
        freeSolo
        size="small"
        fullWidth
        options={options}
        groupBy={option => option.group}
        getOptionLabel={option => (typeof option === 'string' ? option : option.name)}
        value={classRef.name}
        onInputChange={(_event, newValue) => onChange({ name: filterClassReferenceChars(newValue) })}
        renderInput={params => <TextField {...params} placeholder="Class name" sx={autocompleteSx} />}
        renderGroup={renderClassOptionGroup}
        renderOption={renderClassOption}
        slotProps={classAutocompleteSlotProps}
      />
      <IconButton size="small" aria-label="Remove class" onClick={onRemove}>
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
}

export function ClassCombinationEditor({
  classRefs,
  options,
  onAdd,
  onChange,
  onRemove
}: {
  classRefs: ClassReference[];
  onAdd: () => void;
  onChange: (classRefId: string, patch: { name?: string; negate?: boolean }) => void;
  onRemove: (classRefId: string) => void;
  options: ClassNameOption[];
}) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted', mb: 0.5 }}>Classes in this combination ({classRefs.length})</Typography>
      <Stack spacing={1}>
        {classRefs.map(classRef => (
          <ClassRefRow
            key={classRef.id}
            classRef={classRef}
            options={options}
            onChange={patch => onChange(classRef.id, patch)}
            onRemove={() => onRemove(classRef.id)}
          />
        ))}
        <Button size="small" startIcon={<AddIcon />} onClick={onAdd} sx={{ alignSelf: 'flex-start' }}>
          Add class
        </Button>
      </Stack>
    </Box>
  );
}
