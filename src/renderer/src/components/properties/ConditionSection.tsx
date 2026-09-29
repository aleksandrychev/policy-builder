import { type ReactNode, useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { Autocomplete, Box, Button, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';

import { relationToFileCondition } from '../../canvas/fileCondition';
import type { Condition } from '../../store/canvasSlice/types';
import type { TemplateToken } from '../editor/templateTokens';
import { CollapsibleSectionTitle } from './CollapsibleSectionTitle';
import { NewClassModal } from './NewClassModal';
import type { NewClassDefinition } from './NewClassModal';
import { type ClassNameOption, classAutocompleteSlotProps, renderClassOption, renderClassOptionGroup } from './classOptions';
import { filterClassReferenceChars } from './inputFilters';
import { autocompleteSx, inputSx } from './styles';

export interface ConditionCallbacks {
  onClassNameChange: (className: string) => void;
  // Absent where a new class can't help (the file condition: it can't be defined inside the file it gates).
  onCreateClass?: (definition: NewClassDefinition) => void;
  onEnable: () => void;
  onModeChange: (mode: 'if' | 'unless') => void;
  onRemove: () => void;
}

export interface ConditionSlot extends ConditionCallbacks {
  condition: Condition | undefined;
  // React key — a slot is either the block's own condition or an entry's.
  id: string;
  notice?: ReactNode;
  scope: string;
  title?: string;
}

// A block condition that repeats the file's is redundant; the opposite one never runs.
export function FileConditionNotice({ condition, fileCondition, onRemove }: { condition?: Condition; fileCondition?: Condition; onRemove: () => void }) {
  const relation = relationToFileCondition(condition, fileCondition);
  if (!relation) return null;
  const same = relation === 'same';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 0.5, pl: 2.5 }}>
      <Typography sx={{ flex: 1, fontSize: 12, color: same ? 'text.muted' : 'warning.main' }}>
        {same ? 'Already required by the file’s condition.' : 'The file’s condition is the opposite, so this never runs.'}
      </Typography>
      <Button size="small" onClick={onRemove} sx={{ textTransform: 'none', flexShrink: 0 }}>
        Remove
      </Button>
    </Box>
  );
}

// Gates whether this block instance's promise(s) evaluate at all — separate
// from Define Class (which defines a reusable named class) and shown for
// every block type, not just Define Class. See Condition in canvasSlice/types.ts.
export function ConditionSection({
  condition,
  classNameOptions,
  templateTokens,
  scope = 'this block',
  title = 'Condition',
  helperText = 'Or click “New class” to create one. To run after another block, draw an arrow on the canvas.',
  notice,
  onEnable,
  onRemove,
  onModeChange,
  onClassNameChange,
  onCreateClass
}: ConditionCallbacks & {
  classNameOptions: ClassNameOption[];
  condition: Condition | undefined;
  helperText?: string;
  // Shown above the fields, e.g. how this condition relates to the file's.
  notice?: ReactNode;
  // What the condition gates, for the help texts — "this block", "this
  // variable", "every variable in this block".
  scope?: string;
  templateTokens: TemplateToken[];
  title?: string;
}) {
  const [creatingClass, setCreatingClass] = useState(false);
  const [expanded, setExpanded] = useState(Boolean(condition));
  const description = `Gates whether ${scope} evaluates at all.`;

  if (!condition) {
    return (
      <Box>
        <CollapsibleSectionTitle title={`${title} (0)`} expanded={expanded} onToggle={() => setExpanded(current => !current)} />
        {expanded ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', pl: 2.5 }}>
            <Typography sx={{ fontSize: 12, color: 'text.muted', mt: 0.5, mb: 1 }}>No condition set yet — {scope} will evaluate unconditionally.</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={onEnable}>
              Add condition
            </Button>
          </Box>
        ) : (
          <Typography sx={{ fontSize: 11, color: 'text.muted', pl: 2.5 }}>{description}</Typography>
        )}
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <CollapsibleSectionTitle title={`${title} (1)`} expanded={expanded} onToggle={() => setExpanded(current => !current)} />
        <IconButton size="small" aria-label={`Remove ${title.toLowerCase()}`} onClick={onRemove}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      {!expanded && <Typography sx={{ fontSize: 11, color: 'text.muted', pl: 2.5 }}>{description}</Typography>}
      {notice}
      {expanded && (
        <Stack spacing={1}>
          <TextField
            select
            label="Mode"
            value={condition.mode}
            onChange={event => onModeChange(event.target.value as 'if' | 'unless')}
            fullWidth
            size="small"
            sx={inputSx}
          >
            <MenuItem value="if">Run only if</MenuItem>
            <MenuItem value="unless">Skip if</MenuItem>
          </TextField>

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted' }}>Trigger</Typography>
              {onCreateClass && (
                <Button size="small" startIcon={<AddIcon sx={{ fontSize: 14 }} />} onClick={() => setCreatingClass(true)}>
                  New class
                </Button>
              )}
            </Box>
            <Autocomplete<ClassNameOption, false, false, true>
              freeSolo
              size="small"
              fullWidth
              options={classNameOptions}
              groupBy={option => option.group}
              getOptionLabel={option => (typeof option === 'string' ? option : option.name)}
              isOptionEqualToValue={(option, val) => typeof val !== 'string' && option.name === val.name}
              value={condition.className}
              onChange={(_event, newValue) => onClassNameChange(filterClassReferenceChars(typeof newValue === 'string' ? newValue : (newValue?.name ?? '')))}
              onInputChange={(_event, newValue, reason) => {
                if (reason === 'input' || reason === 'clear') onClassNameChange(filterClassReferenceChars(newValue));
              }}
              renderInput={params => <TextField {...params} placeholder="Search class names…" helperText={helperText} sx={autocompleteSx} />}
              renderGroup={renderClassOptionGroup}
              renderOption={renderClassOption}
              slotProps={classAutocompleteSlotProps}
            />
          </Box>
        </Stack>
      )}

      {onCreateClass && (
        <NewClassModal
          open={creatingClass}
          classNameOptions={classNameOptions}
          templateTokens={templateTokens}
          onClose={() => setCreatingClass(false)}
          onCreate={onCreateClass}
        />
      )}
    </Box>
  );
}
