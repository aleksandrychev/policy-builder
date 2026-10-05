import type { ReactNode } from 'react';

import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import StopOutlinedIcon from '@mui/icons-material/StopOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import { Box, CircularProgress, IconButton, Link, Paper, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material';

import type { HostRuntime, RunResult } from '../../project/testRuns';
import { PLATFORMS, type TestHost } from '../../store/testEnvironmentsSlice/types';

type Tone = 'error' | 'info' | 'muted' | 'success' | 'warning';
const STATES: Record<string, { label: string; tone: Tone }> = {
  absent: { tone: 'muted', label: 'Not set up' },
  created: { tone: 'muted', label: 'Created' },
  exited: { tone: 'muted', label: 'Stopped' },
  provisioning: { tone: 'info', label: 'Setting up' },
  ready: { tone: 'success', label: 'Ready' },
  running: { tone: 'info', label: 'Running' },
  done: { tone: 'success', label: 'Converged' },
  failed: { tone: 'error', label: 'Failed' }
};

// The pill: what the host is, from its state and last run.
function statusOf(runtime: HostRuntime | undefined, result: RunResult | undefined, problems: number): { label: string; tone: Tone } {
  const state = STATES[runtime?.state ?? 'absent'] ?? { tone: 'muted' as const, label: runtime?.state ?? '' };
  if (runtime?.state !== 'done' || !result) return state;
  if (problems > 0) return { tone: 'error', label: `${problems} ${problems === 1 ? 'problem' : 'problems'}` };
  if ((result.notKept ?? 0) > 0) return { tone: 'warning', label: 'Not kept' };
  return runtime.converged ? state : { tone: 'warning', label: 'Still repairing' };
}

// A footer icon; the tooltip shows on disabled ones too (hence the span).
function Action({ children, disabled, onClick, title }: { children: ReactNode; disabled?: boolean; onClick: () => void; title: string }) {
  return (
    <Tooltip title={title}>
      <span>
        <IconButton size="small" aria-label={title} disabled={disabled} onClick={onClick}>
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

export interface HostCardProps {
  // While another action runs, or Docker isn't there.
  actionsDisabled: boolean;
  host: TestHost;
  hub: { setupCode: string | null; url: string | null } | null;
  isHub: boolean;
  lastResult?: RunResult;
  onOpenSettings: () => void;
  // Run the policy on this host only.
  onRunPolicy: () => void;
  // A host with no container yet: create it, install CFEngine, bootstrap it, then run the policy on it.
  onSetUp: () => void;
  // Start / stop its container (it keeps what's installed).
  onStart: () => void;
  onStop: () => void;
  // Point the terminal at this host.
  onTerminal: () => void;
  // Errors of its last run (the pill says how many).
  problems: number;
  runtime?: HostRuntime;
}

type HostActionsProps = Pick<HostCardProps, 'onOpenSettings' | 'onRunPolicy' | 'onSetUp' | 'onStart' | 'onStop' | 'onTerminal'> & {
  absent: boolean;
  busy: boolean;
  disabled: boolean;
  stopped: boolean;
  up: boolean;
};

// Deploy & run, start / stop, terminal, settings: close together, each explained on hover.
function HostActions({ absent, busy, disabled, onOpenSettings, onRunPolicy, onSetUp, onStart, onStop, onTerminal, stopped, up }: HostActionsProps) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', flexShrink: 0 }}>
      {absent ? (
        <Action title="Set up this host (create it, install CFEngine, bootstrap to the hub), then run the policy on it" disabled={disabled} onClick={onSetUp}>
          <PlayArrowIcon sx={{ fontSize: 18 }} />
        </Action>
      ) : (
        <Action title={up ? 'Deploy & run on this host' : 'Deploy & run on this host (start it first)'} disabled={disabled || !up} onClick={onRunPolicy}>
          <PlayArrowIcon sx={{ fontSize: 18 }} />
        </Action>
      )}
      {stopped ? (
        <Action title="Start the container" disabled={disabled} onClick={onStart}>
          <PowerSettingsNewIcon sx={{ fontSize: 18 }} />
        </Action>
      ) : (
        <Action title={up ? 'Stop the container (keeps what is installed)' : 'Stop the container (not running)'} disabled={disabled || !up} onClick={onStop}>
          <StopOutlinedIcon sx={{ fontSize: 18 }} />
        </Action>
      )}
      <Action
        title={up ? 'Run a command on this host (terminal below)' : 'Run a command on this host (start it first)'}
        disabled={!up || busy}
        onClick={onTerminal}
      >
        <TerminalIcon sx={{ fontSize: 18 }} />
      </Action>
      <Action title="Host settings" onClick={onOpenSettings}>
        <SettingsOutlinedIcon sx={{ fontSize: 18 }} />
      </Action>
    </Stack>
  );
}

/** One test host, status first: what it runs, its state, and how to reach it. Settings are behind the gear. */
export function HostCard(props: HostCardProps) {
  const { actionsDisabled, host, hub, isHub, lastResult, onOpenSettings, onTerminal, problems, runtime } = props;
  const theme = useTheme();
  const status = statusOf(runtime, lastResult, problems);
  const color = status.tone === 'muted' ? theme.palette.text.secondary : theme.palette[status.tone].main;
  const busy = runtime?.state === 'provisioning' || runtime?.state === 'running';
  const exists = Boolean(runtime?.container) && runtime?.state !== 'absent';
  const stopped = exists && (runtime?.state === 'exited' || runtime?.state === 'created');
  const up = exists && !stopped;
  const label = PLATFORMS.find(item => item.id === host.platform)?.label ?? host.platform;
  const platform = host.image ? `${host.image} (${label} package)` : label;

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
            {busy && runtime?.step ? runtime.step : [platform, runtime?.ip, !exists && 'not set up yet: ▶ sets it up'].filter(Boolean).join(' · ')}
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
        <HostActions
          disabled={actionsDisabled}
          busy={busy}
          stopped={stopped}
          up={up}
          absent={!exists && !busy}
          onRunPolicy={props.onRunPolicy}
          onSetUp={props.onSetUp}
          onStart={props.onStart}
          onStop={props.onStop}
          onTerminal={onTerminal}
          onOpenSettings={onOpenSettings}
        />
      </Stack>
    </Paper>
  );
}
