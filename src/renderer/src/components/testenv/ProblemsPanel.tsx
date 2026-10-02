import { useState } from 'react';

import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Box, Button, Collapse, Stack, Typography, alpha, useTheme } from '@mui/material';

import type { TestProblem } from '../../project/testRuns';
import type { TestHost } from '../../store/testEnvironmentsSlice/types';
import { hostColor } from './hostColors';

export interface ProblemsPanelProps {
  // Block / group id -> its label and file, for naming where a problem comes from.
  describe: (id: string) => { file?: string; group?: string; label: string } | null;
  hosts: TestHost[];
  onShowBlock: (fileId: string, id: string) => void;
  onShowInLog: (hostId: string, text: string) => void;
  problems: Record<string, TestProblem[]>;
}

/** What failed in the last run, per host and block, and why — above the log. Hidden when nothing did. */
export function ProblemsPanel({ describe, hosts, onShowBlock, onShowInLog, problems }: ProblemsPanelProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(true);
  const items = hosts.flatMap((host, index) => (problems[host.id] ?? []).map(problem => ({ host, index, problem })));
  if (items.length === 0) return null;
  const error = theme.palette.error.main;
  return (
    <Box sx={{ border: '1px solid', borderColor: alpha(error, 0.4), borderRadius: 1, bgcolor: alpha(error, 0.04) }}>
      <Stack direction="row" spacing={1} onClick={() => setOpen(value => !value)} sx={{ alignItems: 'center', px: 1.5, py: 0.75, cursor: 'pointer' }}>
        <ErrorOutlineIcon sx={{ fontSize: 18, color: 'error.main' }} />
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'error.main', flex: 1 }}>
          {items.length} {items.length === 1 ? 'problem' : 'problems'} in the last run
        </Typography>
        <ExpandMoreIcon sx={{ fontSize: 18, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </Stack>
      <Collapse in={open}>
        <Stack sx={{ maxHeight: 260, overflowY: 'auto', px: 1.5, pb: 1 }} spacing={1}>
          {items.map(({ host, index, problem }, at) => {
            const origin = problem.block ? describe(problem.block) : null;
            const color = hostColor(theme, index);
            return (
              <Box key={at} sx={{ borderTop: at ? '1px solid' : 'none', borderColor: 'divider', pt: at ? 1 : 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Box
                    component="span"
                    sx={{ px: 0.75, borderRadius: 0.5, fontSize: 12, fontWeight: 600, fontFamily: 'monospace', color, bgcolor: alpha(color, 0.12) }}
                  >
                    {host.name}
                  </Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                    {origin ? origin.label : problem.bundle ? `Bundle ${problem.bundle}` : 'Not traced to a block'}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.muted' }}>
                    {origin
                      ? [origin.file, origin.group && `group ${origin.group}`].filter(Boolean).join(' · ')
                      : [problem.file, problem.line && `line ${problem.line}`].filter(Boolean).join(', ')}
                  </Typography>
                  {problem.count > 1 && <Typography sx={{ fontSize: 12, color: 'text.muted' }}>×{problem.count}</Typography>}
                </Stack>
                <Typography sx={{ fontSize: 13, color: 'error.main', mt: 0.25, wordBreak: 'break-word' }}>{problem.message}</Typography>
                {problem.cause.length > 0 && (
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25, wordBreak: 'break-word' }}>Cause: {problem.cause.join(' · ')}</Typography>
                )}
                <Stack direction="row" spacing={1} sx={{ mt: 0.25 }}>
                  {problem.block && problem.fileId && (
                    <Button size="small" onClick={() => onShowBlock(problem.fileId!, problem.block!)} sx={{ textTransform: 'none', px: 0.5, minWidth: 0 }}>
                      Show block
                    </Button>
                  )}
                  <Button size="small" onClick={() => onShowInLog(host.id, problem.message)} sx={{ textTransform: 'none', px: 0.5, minWidth: 0 }}>
                    Show in log
                  </Button>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Collapse>
    </Box>
  );
}
