import { useState } from 'react';

import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import { Box, CircularProgress, IconButton, Link, Paper, Stack, Typography, alpha, useTheme } from '@mui/material';

import type { HostRuntime, RunResult } from '../../project/testRuns';
import { PLATFORMS, type TestHost } from '../../store/testEnvironmentsSlice/types';

type Tone = 'error' | 'info' | 'muted' | 'success' | 'warning';
const STATES: Record<string, { label: string; tone: Tone }> = {
  absent: { tone: 'muted', label: 'Not created' },
  created: { tone: 'muted', label: 'Created' },
  exited: { tone: 'muted', label: 'Stopped' },
  provisioning: { tone: 'info', label: 'Setting up' },
  ready: { tone: 'success', label: 'Ready' },
  running: { tone: 'info', label: 'Running' },
  done: { tone: 'success', label: 'Converged' },
  failed: { tone: 'error', label: 'Failed' }
};

// The pill: what the host is, from its state and last run.
function statusOf(runtime: HostRuntime | undefined, result: RunResult | undefined): { label: string; tone: Tone } {
  const state = STATES[runtime?.state ?? 'absent'] ?? { tone: 'muted' as const, label: runtime?.state ?? '' };
  if (runtime?.state !== 'done' || !result) return state;
  if ((result.notKept ?? 0) > 0) return { tone: 'warning', label: 'Not kept' };
  return runtime.converged ? state : { tone: 'warning', label: 'Still repairing' };
}

export interface HostCardProps {
  host: TestHost;
  hub: { setupCode: string | null; url: string | null } | null;
  isHub: boolean;
  lastResult?: RunResult;
  onOpenSettings: () => void;
  runtime?: HostRuntime;
}

/** One test host, status first: what it runs, its state, and how to reach it. Settings are behind the gear. */
export function HostCard({ host, hub, isHub, lastResult, onOpenSettings, runtime }: HostCardProps) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const status = statusOf(runtime, lastResult);
  const color = status.tone === 'muted' ? theme.palette.text.secondary : theme.palette[status.tone].main;
  const busy = runtime?.state === 'provisioning' || runtime?.state === 'running';
  const exists = Boolean(runtime?.container) && runtime?.state !== 'absent';
  const platform = PLATFORMS.find(item => item.id === host.platform)?.label ?? host.platform;

  const copyShell = () => {
    if (!runtime?.container) return;
    void navigator.clipboard.writeText(`docker exec -it ${runtime.container} bash`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderColor: isHub ? 'primary.main' : 'divider' }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: isHub ? 'primary.main' : alpha(theme.palette.primary.main, 0.1),
            color: isHub ? 'primary.contrastText' : 'primary.main'
          }}
        >
          <DnsOutlinedIcon fontSize="small" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host.name}</Typography>
            <Typography
              sx={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.5,
                px: 0.75,
                py: 0.1,
                borderRadius: 0.5,
                bgcolor: isHub ? alpha(theme.palette.primary.main, 0.15) : 'action.hover',
                color: isHub ? 'primary.main' : 'text.secondary'
              }}
            >
              {isHub ? 'HUB' : 'CLIENT'}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', px: 1, py: 0.25, borderRadius: 4, bgcolor: alpha(color, 0.12) }}>
              {busy ? <CircularProgress size={10} thickness={6} sx={{ color }} /> : <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color }} />}
              <Typography sx={{ fontSize: 12, fontWeight: 600, color }}>{status.label}</Typography>
            </Stack>
          </Stack>
          <Typography
            sx={{ fontSize: 12, color: busy ? 'info.main' : 'text.muted', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {busy && runtime?.step ? runtime.step : [platform, runtime?.ip].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
      </Stack>
      {lastResult && !busy && (
        <Box
          sx={{ mt: 1.25 }}
          title={`${lastResult.kept ?? 0}% kept · ${lastResult.repaired ?? 0}% repaired · ${lastResult.notKept ?? 0}% not kept (run ${lastResult.run})`}
        >
          <Box sx={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', bgcolor: 'action.hover' }}>
            <Box sx={{ width: `${lastResult.kept ?? 0}%`, bgcolor: 'success.main' }} />
            <Box sx={{ width: `${lastResult.repaired ?? 0}%`, bgcolor: 'info.main' }} />
            <Box sx={{ width: `${lastResult.notKept ?? 0}%`, bgcolor: 'error.main' }} />
          </Box>
          <Typography sx={{ fontSize: 11, color: 'text.muted', mt: 0.25 }}>
            {lastResult.kept ?? '?'}% kept · {lastResult.repaired ?? '?'}% repaired · {lastResult.notKept ?? '?'}% not kept
            {lastResult.exit !== 0 && ` · cf-agent exited ${lastResult.exit}`}
          </Typography>
        </Box>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25 }}>
          {host.ports.map(port => (
            <Link
              key={port.host}
              href={`${port.container === 443 ? 'https' : 'http'}://localhost:${port.host}/`}
              target="_blank"
              rel="noreferrer"
              sx={{ fontSize: 12, fontFamily: 'monospace', color: theme.palette.mode === 'dark' ? 'primary.light' : 'primary.main' }}
            >
              localhost:{port.host}
            </Link>
          ))}
          {isHub && hub?.setupCode && (
            <Typography sx={{ fontSize: 12 }} title="Mission Portal first-login setup code">
              setup code <strong>{hub.setupCode}</strong>
            </Typography>
          )}
          {host.ports.length === 0 && !hub?.setupCode && <Typography sx={{ fontSize: 12, color: 'text.muted' }}>No published ports</Typography>}
        </Box>
        <IconButton size="small" title={copied ? 'Copied' : 'Copy a shell command (docker exec)'} disabled={!exists} onClick={copyShell}>
          <TerminalIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <IconButton size="small" title="Host settings" onClick={onOpenSettings}>
          <SettingsOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Stack>
    </Paper>
  );
}
