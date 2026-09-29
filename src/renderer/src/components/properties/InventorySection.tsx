import { useState } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import { Box, FormControlLabel, IconButton, Stack, Switch, TextField, Typography } from '@mui/material';

import type { InventoryTag } from '../../store/canvasSlice/types';
import { CollapsibleSectionTitle } from './CollapsibleSectionTitle';
import { inputSx } from './styles';

// Tags a Define Variable instance for CFEngine Enterprise's Inventory view
// (see InventoryTag in canvasSlice/types.ts) — a no-op on Community, so this
// only renders for that one block, not every block type like Condition does.
export function InventorySection({
  inventory,
  onEnable,
  onRemove,
  onAttributeNameChange
}: {
  inventory: InventoryTag | undefined;
  onAttributeNameChange: (attributeName: string) => void;
  onEnable: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(Boolean(inventory));

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <CollapsibleSectionTitle title="Inventory" expanded={expanded} onToggle={() => setExpanded(current => !current)} />
        {inventory && (
          <IconButton size="small" aria-label="Remove inventory tag" onClick={onRemove}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>
      {!expanded && (
        <Typography sx={{ fontSize: 11, color: 'text.muted', pl: 2.5 }}>Reports this variable to CFEngine Enterprise&rsquo;s Inventory view.</Typography>
      )}
      {expanded && (
        <Stack spacing={0.5}>
          <FormControlLabel
            control={<Switch size="small" checked={Boolean(inventory)} onChange={event => (event.target.checked ? onEnable() : onRemove())} />}
            label={<Typography sx={{ fontSize: 13 }}>Report variable</Typography>}
            sx={{ mr: 0 }}
          />
          <Typography sx={{ fontSize: 11, color: 'text.muted' }}>
            Enterprise only — makes this variable&rsquo;s value available in Mission Portal&rsquo;s Inventory view. No effect on Community.
          </Typography>
          {inventory && (
            <TextField
              label="Attribute name"
              value={inventory.attributeName}
              onChange={event => onAttributeNameChange(event.target.value)}
              placeholder="e.g. Owner"
              helperText="How this shows up in Mission Portal's Inventory report."
              fullWidth
              size="small"
              sx={inputSx}
            />
          )}
        </Stack>
      )}
    </Box>
  );
}
