import { useState } from 'react';

import { Box, Button, Divider, ListItemText, Menu, MenuItem, Typography, useTheme } from '@mui/material';

import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockGroup } from '../store/groupsSlice/types';

// Top of a block's Properties: which group it's in (open it, or leave), or a
// way to put it in one — the menu equivalent of dragging it onto a frame.
export function BlockGroupRow({
  instance,
  groups,
  onJoin,
  onLeave,
  onNewGroup,
  onOpen
}: {
  groups: BlockGroup[];
  instance: BlockInstance;
  onJoin: (groupId: string) => void;
  onLeave: () => void;
  onNewGroup: () => void;
  onOpen: (groupId: string) => void;
}) {
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const group = groups.find(candidate => candidate.id === instance.groupId);
  const others = groups.filter(candidate => candidate.id !== instance.groupId);

  return (
    <Box sx={{ px: 2, pt: 1.5, display: 'flex', alignItems: 'center', gap: 1, minHeight: 32 }}>
      {group ? (
        <>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: theme.palette[group.color].main, flexShrink: 0 }} />
          <Typography sx={{ fontSize: 12, color: 'text.muted' }}>In group</Typography>
          <Button size="small" onClick={() => onOpen(group.id)} sx={{ textTransform: 'none', fontSize: 12, fontWeight: 700, px: 0.5, minWidth: 0 }}>
            {group.name || 'Untitled group'}
          </Button>
          <Button size="small" onClick={onLeave} sx={{ textTransform: 'none', fontSize: 12, ml: 'auto' }}>
            Remove from group
          </Button>
        </>
      ) : (
        <Button size="small" onClick={event => setAnchorEl(event.currentTarget)} sx={{ textTransform: 'none', fontSize: 12, px: 0.5 }}>
          Add to group…
        </Button>
      )}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {others.map(candidate => (
          <MenuItem
            key={candidate.id}
            onClick={() => {
              onJoin(candidate.id);
              setAnchorEl(null);
            }}
          >
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: theme.palette[candidate.color].main, mr: 1 }} />
            <ListItemText primary={candidate.name || 'Untitled group'} slotProps={{ primary: { sx: { fontSize: 13 } } }} />
          </MenuItem>
        ))}
        {others.length > 0 && <Divider />}
        <MenuItem
          onClick={() => {
            onNewGroup();
            setAnchorEl(null);
          }}
        >
          <ListItemText primary="New group with this block" slotProps={{ primary: { sx: { fontSize: 13 } } }} />
        </MenuItem>
      </Menu>
    </Box>
  );
}
