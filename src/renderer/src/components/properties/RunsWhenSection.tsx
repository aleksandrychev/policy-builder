import { useState } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import { Box, Button, IconButton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

import { describeOutcomes } from '../../canvas/outcomes';
import type { BlockOutcome } from '../../store/edgesSlice/types';
import { OutcomeMenu } from '../OutcomeMenu';

// An arrow into the selected block, as the "Runs when" section lists it.
export interface IncomingArrow {
  edgeId: string;
  outcomes: BlockOutcome[];
  sourceLabel: string;
  sourceOrder?: number;
}

// An incoming arrow's outcomes as a coloured button, opening the same
// checkbox menu as the arrow's label on the canvas.
function ArrowOutcomesButton({ outcomes, onChange }: { onChange: (outcomes: BlockOutcome[]) => void; outcomes: BlockOutcome[] }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const info = describeOutcomes(outcomes);
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        color={info.color}
        onClick={event => setAnchorEl(event.currentTarget)}
        sx={{ textTransform: 'none', fontSize: 12, py: 0.25, flexShrink: 0, maxWidth: 170 }}
      >
        {info.symbol} {info.label}
      </Button>
      <OutcomeMenu anchorEl={anchorEl} onClose={() => setAnchorEl(null)} outcomes={outcomes} onChange={onChange} />
    </>
  );
}

// When this block runs: its place in the file's execution order and the
// arrows gating it. Arrows are drawn on the canvas (from another block's
// output dot); this is where they're read and tweaked.
export function RunsWhenSection({
  orderNumber,
  arrows,
  mode,
  onModeChange,
  onOutcomesChange,
  onRemove
}: {
  arrows: IncomingArrow[];
  mode: 'all' | 'any';
  onModeChange: (mode: 'all' | 'any') => void;
  onOutcomesChange: (edgeId: string, outcomes: BlockOutcome[]) => void;
  onRemove: (edgeId: string) => void;
  orderNumber?: number;
}) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted', mb: 0.5 }}>
        Runs when{orderNumber !== undefined ? ` · #${orderNumber} in this file` : ''}
      </Typography>
      {arrows.length === 0 ? (
        <Typography sx={{ fontSize: 12, color: 'text.muted' }}>
          Always, in canvas order (top to bottom, then left to right). To make it wait for another block, drag from the dot at the bottom of that block onto
          this one, then pick what it waits for on the arrow.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {arrows.length > 1 && (
            <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_event, value) => value && onModeChange(value)} fullWidth>
              <ToggleButton value="all" sx={{ fontSize: 12, textTransform: 'none', py: 0.25 }}>
                All of these
              </ToggleButton>
              <ToggleButton value="any" sx={{ fontSize: 12, textTransform: 'none', py: 0.25 }}>
                Any of these
              </ToggleButton>
            </ToggleButtonGroup>
          )}
          {arrows.map(arrow => (
            <Box key={arrow.edgeId}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontSize: 12, color: 'text.primary', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  after <strong>{arrow.sourceLabel}</strong>
                  {arrow.sourceOrder !== undefined ? ` (#${arrow.sourceOrder})` : ''}
                </Typography>
                <ArrowOutcomesButton outcomes={arrow.outcomes} onChange={outcomes => onOutcomesChange(arrow.edgeId, outcomes)} />
                <IconButton size="small" title="Remove arrow" onClick={() => onRemove(arrow.edgeId)}>
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
              <Typography sx={{ fontSize: 11, color: 'text.muted', mt: 0.25 }}>{describeOutcomes(arrow.outcomes).help}</Typography>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
