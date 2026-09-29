import { Box, Typography } from '@mui/material';

import { BlockNodesIcon } from './icons/BlockNodesIcon';

/**
 * Shown on the canvas tab when the project has no blocks placed yet.
 */
export function EmptyCanvas() {
  return (
    <Box
      sx={{
        width: 460,
        height: 300,
        bgcolor: 'background.default',
        border: '2px dashed',
        borderColor: 'divider',
        borderRadius: '4px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        px: 4
      }}
    >
      <BlockNodesIcon size={48} />
      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.muted', mt: 2, textAlign: 'center' }}>
        Drag a block here, or click one in the palette, to get started
      </Typography>
      <Typography sx={{ fontSize: 12, color: 'text.muted', opacity: 0.6, mt: 0.5, textAlign: 'center' }}>
        Blocks will evaluate in CFEngine normal ordering
      </Typography>
    </Box>
  );
}
