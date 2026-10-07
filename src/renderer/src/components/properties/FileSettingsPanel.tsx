import { Box, Divider, Stack, TextField, Typography } from '@mui/material';

import type { BlockInstance } from '../../store/canvasSlice/types';
import type { PolicyFile } from '../../store/filesSlice/types';
import { ConditionSection } from './ConditionSection';
import { buildClassNameOptions, buildTemplateTokens } from './classOptions';

// The Properties panel with nothing selected: the open file's own settings.
export function FileSettingsPanel({
  file,
  allInstances,
  files,
  onEnable,
  onRemove,
  onModeChange,
  onClassNameChange,
  onDescriptionChange
}: {
  allInstances: BlockInstance[];
  file: PolicyFile;
  files: PolicyFile[];
  onClassNameChange: (className: string) => void;
  onDescriptionChange: (description: string) => void;
  onEnable: () => void;
  onModeChange: (mode: 'if' | 'unless') => void;
  onRemove: () => void;
}) {
  const filesById = new Map(files.map(item => [item.id, item]));
  // A class defined in this file doesn't exist yet when the file's gate is checked.
  const classNameOptions = buildClassNameOptions(allInstances, filesById, file.id).filter(option => option.group !== 'Defined in this file');
  return (
    <Stack spacing={2} sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
      <Box>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted' }}>FILE</Typography>
        <Typography sx={{ fontSize: 15, fontWeight: 700 }}>{file.name}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.muted', fontFamily: 'monospace' }}>namespace: {file.namespace}</Typography>
      </Box>
      <TextField
        label="Description"
        size="small"
        multiline
        minRows={2}
        maxRows={8}
        placeholder="What this file is for"
        helperText="Shown on hovering the file's name."
        value={file.description ?? ''}
        onChange={event => onDescriptionChange(event.target.value)}
      />
      <Divider />
      <ConditionSection
        key={file.id}
        condition={file.condition}
        title="File condition"
        scope="every block in this file (variables and classes too)"
        helperText="A hard class like linux, or one defined by a file that runs earlier."
        classNameOptions={classNameOptions}
        templateTokens={buildTemplateTokens(allInstances, filesById, file.id)}
        onEnable={onEnable}
        onRemove={onRemove}
        onModeChange={onModeChange}
        onClassNameChange={onClassNameChange}
      />
      <Typography sx={{ fontSize: 12, color: 'text.muted', textAlign: 'center', pt: 2 }}>Select a block on the canvas to edit its properties.</Typography>
    </Stack>
  );
}
