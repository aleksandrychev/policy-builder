import type { ReactNode } from 'react';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Alert, Box, CircularProgress, LinearProgress, Link, Stack, Typography } from '@mui/material';

import type { BuildProblem } from '../../../../preload/api';
import type { Failure, Stage } from '../../project/deployRuns';
import type { ProjectChange } from '../../project/projectChanges';

export type Tone = 'error' | 'muted' | 'success' | 'warning';
export type BlockAt = (problem: BuildProblem) => { fileId: string; id: string; label: string } | null;

export const ago = (time: number) => {
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
};

export const short = (hash: string | null | undefined) => (hash ? hash.slice(0, 7) : '?');

export function StatusIcon({ size = 18, tone }: { size?: number; tone: Tone }) {
  if (tone === 'success') return <CheckCircleIcon color="success" sx={{ fontSize: size }} />;
  if (tone === 'error') return <ErrorIcon color="error" sx={{ fontSize: size }} />;
  if (tone === 'warning') return <WarningAmberIcon color="warning" sx={{ fontSize: size }} />;
  return <RemoveCircleOutlineIcon sx={{ fontSize: size, color: 'text.disabled' }} />;
}

export function Line({ children, tone }: { children: ReactNode; tone: Tone }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', py: 0.25 }}>
      <Box sx={{ pt: 0.15, display: 'flex' }}>
        <StatusIcon tone={tone} size={16} />
      </Box>
      <Typography component="div" sx={{ fontSize: 13 }}>
        {children}
      </Typography>
    </Stack>
  );
}

export function FailureAlert({ action, failure }: { action?: ReactNode; failure: Failure | null }) {
  if (!failure) return null;
  return (
    <Alert severity="error" action={action}>
      {failure.message}
      {failure.details && failure.details !== failure.message && (
        <Box component="pre" sx={{ m: 0, mt: 0.5, fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>
          {failure.details}
        </Box>
      )}
    </Alert>
  );
}

export function ProblemList({
  blockAt,
  onShowBlock,
  problems
}: {
  blockAt: BlockAt;
  onShowBlock: (fileId: string, id: string) => void;
  problems: BuildProblem[];
}) {
  return (
    <Stack spacing={0.5}>
      {problems.slice(0, 20).map((problem, index) => {
        const block = blockAt(problem);
        return (
          <Typography key={index} sx={{ fontSize: 12, color: 'error.main' }}>
            {problem.message}
            <Box component="span" sx={{ color: 'text.muted', ml: 1, fontFamily: 'monospace' }}>
              {problem.file ?? '?'}:{problem.line}
            </Box>
            {block && (
              <Link component="button" sx={{ ml: 1, fontSize: 12, verticalAlign: 'baseline' }} onClick={() => onShowBlock(block.fileId, block.id)}>
                Show {block.label}
              </Link>
            )}
          </Typography>
        );
      })}
    </Stack>
  );
}

const CHANGE_STYLE = {
  added: { sign: '+', color: 'success.main' },
  changed: { sign: '~', color: 'warning.main' },
  removed: { sign: '−', color: 'error.main' }
} as const;

export function ChangeList({ changes }: { changes: ProjectChange[] }) {
  return (
    <Stack spacing={0.25}>
      {changes.slice(0, 30).map((change, index) => (
        <Typography key={index} sx={{ fontSize: 13 }}>
          <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 700, color: CHANGE_STYLE[change.kind].color, mr: 1 }}>
            {CHANGE_STYLE[change.kind].sign}
          </Box>
          {change.what}
          {change.detail && (
            <Box component="span" sx={{ color: 'text.muted' }}>
              {' '}
              · {change.detail}
            </Box>
          )}
        </Typography>
      ))}
      {changes.length > 30 && <Typography sx={{ fontSize: 12, color: 'text.muted' }}>…and {changes.length - 30} more</Typography>}
    </Stack>
  );
}

// "Step 3 of 9 · Checking with the linter", and a bar over the steps done.
export function StageProgress({ stage, stages }: { stage: string | null; stages: Stage[] }) {
  const index = Math.max(
    0,
    stages.findIndex(item => item.id === stage)
  );
  return (
    <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <CircularProgress size={12} thickness={5} />
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          Step {index + 1} of {stages.length} · {stages[index].label}…
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={(index / stages.length) * 100} />
    </Stack>
  );
}

export function Output({ text }: { text: string }) {
  return (
    <Box component="pre" sx={{ m: 0, p: 1, fontSize: 11, maxHeight: 220, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap' }}>
      {text.trim() || '(no output)'}
    </Box>
  );
}
