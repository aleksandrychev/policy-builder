import { Checkbox, Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem } from '@mui/material';

import { ALL_OUTCOMES, OUTCOMES, toggleOutcome } from '../canvas/outcomes';
import type { BlockOutcome } from '../store/edgesSlice/types';
import { stopCanvasEvents } from './stopCanvasEvents';

const checkboxSx = { p: 0, mr: 1 };

/**
 * What an arrow waits for, as checkboxes: ticking several means any of them
 * (OR). Stays open while ticking; the last ticked outcome can't be cleared.
 * Opened from the arrow's label chip and from the Properties panel.
 */
export function OutcomeMenu({
  anchorEl,
  onClose,
  outcomes,
  onChange,
  onRemove
}: {
  anchorEl: HTMLElement | null;
  onChange: (outcomes: BlockOutcome[]) => void;
  onClose: () => void;
  onRemove?: () => void;
  outcomes: BlockOutcome[];
}) {
  const all = outcomes.length === ALL_OUTCOMES.length;
  return (
    <Menu {...stopCanvasEvents} anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose} slotProps={{ paper: { sx: { maxWidth: 340 } } }}>
      <ListSubheader sx={{ lineHeight: 1.4, py: 1, fontSize: 12 }}>Run after it if it ended — tick one or more (any of them will do):</ListSubheader>
      {OUTCOMES.map(option => {
        const checked = outcomes.includes(option.outcome);
        return (
          <MenuItem key={option.outcome} disabled={checked && outcomes.length === 1} onClick={() => onChange(toggleOutcome(outcomes, option.outcome))}>
            <ListItemIcon sx={{ minWidth: 0 }}>
              <Checkbox size="small" checked={checked} sx={checkboxSx} tabIndex={-1} disableRipple />
            </ListItemIcon>
            <ListItemText
              primary={`${option.symbol} ${option.label}`}
              secondary={option.help}
              slotProps={{ primary: { sx: { color: `${option.color}.main`, fontSize: 13 } }, secondary: { sx: { fontSize: 11, whiteSpace: 'normal' } } }}
            />
          </MenuItem>
        );
      })}
      <MenuItem onClick={() => onChange(ALL_OUTCOMES)} selected={all}>
        <ListItemIcon sx={{ minWidth: 0 }}>
          <Checkbox size="small" checked={all} sx={checkboxSx} tabIndex={-1} disableRipple />
        </ListItemIcon>
        <ListItemText
          primary="→ any outcome"
          secondary="It ran — whatever the result."
          slotProps={{ primary: { sx: { color: 'info.main', fontSize: 13 } }, secondary: { sx: { fontSize: 11 } } }}
        />
      </MenuItem>
      {onRemove && <Divider />}
      {onRemove && (
        <MenuItem
          onClick={() => {
            onRemove();
            onClose();
          }}
        >
          <ListItemText primary="Remove arrow" slotProps={{ primary: { sx: { fontSize: 13 } } }} />
        </MenuItem>
      )}
    </Menu>
  );
}
