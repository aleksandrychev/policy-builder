import { Box, Button, ButtonBase, Stack, TextField, Typography, useTheme } from '@mui/material';

import type { BlockInstance } from '../store/canvasSlice/types';
import { type BlockGroup, GROUP_COLORS, type GroupColor } from '../store/groupsSlice/types';

const inputSx = { '& .MuiInputBase-root': { bgcolor: 'background.input' } };

// Properties panel content for a selected group: name, colour, members, and
// the ways out (ungroup keeps the blocks; delete takes them too).
export function GroupPanel({
  group,
  members,
  orderOf,
  autoFocusName,
  onRename,
  onColorChange,
  onSelectMember,
  onUngroup,
  onDeleteWithBlocks,
  onFit
}: {
  autoFocusName: boolean;
  group: BlockGroup;
  members: BlockInstance[];
  onColorChange: (color: GroupColor) => void;
  onDeleteWithBlocks: () => void;
  // Returns a dragged-out frame to hugging its blocks (offered only then).
  onFit: () => void;
  onRename: (name: string) => void;
  onSelectMember: (instanceId: string) => void;
  onUngroup: () => void;
  orderOf: (instanceId: string) => number | undefined;
}) {
  const theme = useTheme();
  return (
    <Stack spacing={2} sx={{ p: 2, overflowY: 'auto' }}>
      <TextField
        label="Group name"
        size="small"
        value={group.name}
        autoFocus={autoFocusName}
        onFocus={event => autoFocusName && event.target.select()}
        onChange={event => onRename(event.target.value)}
        sx={inputSx}
      />
      <Box>
        <Typography sx={{ fontSize: 12, color: 'text.muted', mb: 0.75 }}>Colour</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {GROUP_COLORS.map(color => (
            <ButtonBase
              key={color}
              title={color}
              onClick={() => onColorChange(color)}
              sx={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                bgcolor: theme.palette[color].main,
                outline: group.color === color ? `2px solid ${theme.palette.text.primary}` : 'none',
                outlineOffset: 2
              }}
            />
          ))}
        </Box>
      </Box>
      <Box>
        <Typography sx={{ fontSize: 12, color: 'text.muted', mb: 0.5 }}>
          {members.length} {members.length === 1 ? 'block' : 'blocks'} — drag a block onto the frame to add it, or out of it to remove it
        </Typography>
        {members.map(member => (
          <Button
            key={member.instanceId}
            size="small"
            onClick={() => onSelectMember(member.instanceId)}
            sx={{ display: 'flex', justifyContent: 'flex-start', width: '100%', textTransform: 'none', color: 'text.primary', fontSize: 13 }}
          >
            {orderOf(member.instanceId) !== undefined && (
              <Box component="span" sx={{ color: 'text.muted', mr: 1, fontFamily: 'monospace' }}>
                #{orderOf(member.instanceId)}
              </Box>
            )}
            {member.label}
          </Button>
        ))}
      </Box>
      <Typography sx={{ fontSize: 12, color: 'text.muted' }}>
        A group is visual: it doesn’t change what runs or in which order. Move it by its title bar; drag its edges to make room.
      </Typography>
      {group.rect && (
        <Box>
          <Button size="small" onClick={onFit} sx={{ textTransform: 'none', px: 0.5 }}>
            Fit frame to its blocks
          </Button>
        </Box>
      )}
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" size="small" onClick={onUngroup}>
          Ungroup
        </Button>
        <Button color="error" size="small" onClick={onDeleteWithBlocks}>
          Delete group and blocks…
        </Button>
      </Stack>
    </Stack>
  );
}
