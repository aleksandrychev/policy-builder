import { type ReactNode, useState } from 'react';

import { Box, Button, ListItemText, ListSubheader, Menu, MenuItem, Stack, Typography } from '@mui/material';

import type { BlockParameter } from '../../blocks/types';

// `nameParam`: the descriptor's entries.name_param — a defined name, never computed.
export function isBindable(parameter: BlockParameter, nameParam?: string): boolean {
  return (parameter.type === 'string' || parameter.type === 'text') && !parameter.options && !parameter.references && parameter.name !== nameParam;
}

// "Compute from data…": picks the value source a parameter's data chain starts from.
// The alternative to typing a parameter's value, worded to name that
// parameter so it reads as part of the field above it.
export function BindToDataLink({
  fieldLabel,
  sources,
  onBind
}: {
  fieldLabel: string;
  onBind: (valueSourceId: string) => void;
  sources: { badge?: string; id: string; label: string }[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
      <Typography sx={{ fontSize: 12, color: 'text.muted' }}>or</Typography>
      <Button
        size="small"
        onClick={event => setAnchor(event.currentTarget)}
        sx={{ fontSize: 12, px: 0.5, py: 0, minWidth: 0, textTransform: 'none', textAlign: 'left', justifyContent: 'flex-start' }}
      >
        {/* One span: the button is a flex box, which would put each text piece in its own column. */}
        <span>
          ⇢ compute <strong>{fieldLabel}</strong> from data…
        </span>
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <ListSubheader sx={{ lineHeight: '32px', fontSize: 12 }}>Compute {fieldLabel} from:</ListSubheader>
        {sources.map(source => (
          <MenuItem
            key={source.id}
            onClick={() => {
              onBind(source.id);
              setAnchor(null);
            }}
          >
            <ListItemText primary={source.label} secondary={source.badge} slotProps={{ secondary: { sx: { fontFamily: 'monospace', fontSize: 11 } } }} />
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

// A parameter fed by a data chain: its source + steps editor, and the way back.
export function BoundParameter({
  parameter,
  producesList,
  onUnbind,
  children
}: {
  children: ReactNode;
  onUnbind: () => void;
  parameter: BlockParameter;
  producesList: boolean;
}) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'info.main', borderRadius: '4px', p: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'info.main' }}>{parameter.label ?? parameter.name} — from data</Typography>
        <Button size="small" onClick={onUnbind} sx={{ fontSize: 12 }}>
          Type it instead
        </Button>
      </Box>
      <Stack spacing={2}>{children}</Stack>
      {producesList && !parameter.allow_list && (
        <Typography sx={{ fontSize: 11, color: 'warning.main', mt: 1 }}>
          This produces a list — add “Join into a string” as the last step to use it here.
        </Typography>
      )}
    </Box>
  );
}
