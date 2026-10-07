import type { ReactNode } from 'react';

import { Box, ButtonBase, CircularProgress, Paper, Stack, Typography, alpha, useTheme } from '@mui/material';

import { StatusIcon, type Tone } from './shared';

export interface Check {
  // Opened below the row on click.
  detail?: ReactNode;
  id: string;
  label: string;
  running?: boolean;
  status: string;
  tone: Tone;
}

/** The checks in one row; one opens its detail below. */
export function PreflightRow({ checks, onOpen, open }: { checks: Check[]; onOpen: (id: string | null) => void; open: string | null }) {
  const theme = useTheme();
  const opened = checks.find(check => check.id === open && check.detail);
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Stack direction="row">
        {checks.map((check, index) => {
          const active = check.id === opened?.id;
          return (
            <ButtonBase
              key={check.id}
              disabled={!check.detail}
              title={`${check.label}: ${check.status}`}
              onClick={() => onOpen(active ? null : check.id)}
              sx={{
                flex: '1 1 0',
                minWidth: 0,
                justifyContent: 'flex-start',
                textAlign: 'left',
                px: 1.5,
                py: 1.25,
                gap: 1,
                alignItems: 'flex-start',
                borderLeft: index ? '1px solid' : 'none',
                borderColor: 'divider',
                bgcolor: active ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                '&:hover': check.detail ? { bgcolor: alpha(theme.palette.primary.main, 0.05) } : undefined
              }}
            >
              <Box sx={{ pt: 0.25, display: 'flex' }}>{check.running ? <CircularProgress size={16} thickness={5} /> : <StatusIcon tone={check.tone} />}</Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{check.label}</Typography>
                <Typography
                  sx={{
                    fontSize: 12,
                    color: check.tone === 'error' ? 'error.main' : check.tone === 'warning' ? 'warning.main' : 'text.muted',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {check.status}
                </Typography>
              </Box>
            </ButtonBase>
          );
        })}
      </Stack>
      {opened && <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>{opened.detail}</Box>}
    </Paper>
  );
}
