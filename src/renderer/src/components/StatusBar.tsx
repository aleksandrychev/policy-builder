import type { ReactNode } from 'react';

import { Box } from '@mui/material';

interface StatusBarProps {
  left: ReactNode;
  right?: ReactNode;
}

/**
 * Thin status footer shared across screens (home, canvas, etc.) — each
 * screen supplies its own left/right content.
 */
export function StatusBar({ left, right }: StatusBarProps) {
  return (
    <Box
      component="footer"
      sx={{
        height: 28,
        borderTop: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        flexShrink: 0
      }}
    >
      {left}
      {right}
    </Box>
  );
}
