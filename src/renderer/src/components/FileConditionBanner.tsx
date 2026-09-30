import CloseIcon from '@mui/icons-material/Close';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import { Box, ButtonBase, IconButton, Typography } from '@mui/material';

import type { Condition } from '../store/canvasSlice/types';

// Pinned over the canvas (it doesn't pan or zoom): the whole file is gated.
// Click it to edit the condition in the Properties panel.
export function FileConditionBanner({ condition, onOpen, onRemove }: { condition: Condition; onOpen: () => void; onRemove: () => void }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        bgcolor: 'background.default',
        border: '1px dashed',
        borderColor: condition.className ? 'text.muted' : 'warning.main',
        borderRadius: '18px',
        boxShadow: 2,
        pr: 0.5
      }}
    >
      <ButtonBase
        onClick={onOpen}
        title="Edit the file condition"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1.5, pr: 1, py: 0.75, borderRadius: '18px' }}
      >
        <FilterAltOutlinedIcon sx={{ fontSize: 18, color: 'text.muted' }} />
        <Typography sx={{ fontSize: 13, color: 'text.muted', whiteSpace: 'nowrap' }}>
          {condition.mode === 'if' ? 'Whole file runs only if' : 'Whole file is skipped if'}
        </Typography>
        <Typography
          sx={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap', color: condition.className ? 'text.primary' : 'warning.main' }}
        >
          {condition.className || 'class not chosen yet'}
        </Typography>
      </ButtonBase>
      <IconButton size="small" title="Remove the file condition" onClick={onRemove} sx={{ p: 0.25 }}>
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
}
