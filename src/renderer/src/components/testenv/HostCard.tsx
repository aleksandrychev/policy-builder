import { useState } from 'react';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Box, Chip, IconButton, Link, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';

import type { HostRuntime, RunResult } from '../../project/testRuns';
import { PLATFORMS, type PlatformSupport, type TestHost } from '../../store/testEnvironmentsSlice/types';
import { EnvVarsField } from './EnvVarsField';
import { PortsField } from './PortsField';

const STATES: Record<string, { color: 'default' | 'error' | 'info' | 'success' | 'warning'; label: string }> = {
  absent: { color: 'default', label: 'Not created' },
  created: { color: 'default', label: 'Created' },
  exited: { color: 'default', label: 'Stopped' },
  provisioning: { color: 'info', label: 'Setting up…' },
  ready: { color: 'success', label: 'Ready' },
  running: { color: 'info', label: 'Running policy…' },
  done: { color: 'success', label: 'Done' },
  failed: { color: 'error', label: 'Failed' }
};

export interface HostCardProps {
  busy: boolean;
  canRemove: boolean;
  host: TestHost;
  hub: { setupCode: string | null; url: string | null } | null;
  isHub: boolean;
  lastResult?: RunResult;
  onChange: (changes: Partial<Pick<TestHost, 'env' | 'platform' | 'ports'>>) => void;
  onMakeHub: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  onReset: () => void;
  // Host ports other hosts publish.
  otherPorts: Set<number>;
  runtime?: HostRuntime;
  // Which platforms have packages for this edition, version and architecture (null: unknown).
  support: PlatformSupport | null;
}

/** One test host: what it is, how it's set up, and how its last run went. */
export function HostCard(props: HostCardProps) {
  const { host, runtime, isHub, busy, lastResult, hub } = props;
  const [copied, setCopied] = useState(false);
  const state = STATES[runtime?.state ?? 'absent'] ?? { color: 'default' as const, label: runtime?.state ?? '' };
  const exists = Boolean(runtime?.container) && runtime?.state !== 'absent';

  const copyShell = () => {
    if (!runtime?.container) return;
    void navigator.clipboard.writeText(`docker exec -it ${runtime.container} bash`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            value={host.name}
            disabled={busy}
            onChange={event => props.onRename(event.target.value)}
            sx={{ width: 140 }}
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
          <TextField
            select
            size="small"
            value={host.platform}
            disabled={busy}
            onChange={event => props.onChange({ platform: event.target.value })}
            sx={{ width: 210 }}
          >
            {PLATFORMS.map(platform => {
              const known = props.support?.[platform.id];
              const missing = known && !(isHub ? known.hub : known.client);
              return (
                <MenuItem key={platform.id} value={platform.id} disabled={Boolean(missing)}>
                  {platform.label}
                  {missing && (
                    <Typography component="span" sx={{ fontSize: 11, color: 'text.muted', ml: 1 }}>
                      {isHub && known.client ? 'no hub package' : 'no package'}
                    </Typography>
                  )}
                </MenuItem>
              );
            })}
          </TextField>
          <Chip
            size="small"
            label={isHub ? 'Hub' : 'Client'}
            color={isHub ? 'primary' : 'default'}
            variant={isHub ? 'filled' : 'outlined'}
            onClick={isHub || busy ? undefined : props.onMakeHub}
            title={isHub ? 'Serves the policy; the others bootstrap to it' : 'Make this the hub'}
          />
          <Box sx={{ flex: 1 }} />
          <Chip size="small" variant="outlined" color={state.color} label={state.label} />
          <IconButton size="small" title={copied ? 'Copied' : 'Copy a shell command (docker exec)'} disabled={!exists} onClick={copyShell}>
            <ContentCopyIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton size="small" title="Reset: remove the container (Start creates it fresh)" disabled={busy || !exists} onClick={props.onReset}>
            <RestartAltIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton size="small" title="Remove host" disabled={busy || !props.canRemove} onClick={props.onRemove}>
            <DeleteOutlineIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
        {lastResult && (
          <Typography sx={{ fontSize: 12, color: lastResult.exit !== 0 ? 'error.main' : (lastResult.notKept ?? 0) > 0 ? 'warning.main' : 'text.secondary' }}>
            Run {lastResult.run}: {lastResult.kept ?? '?'}% kept · {lastResult.repaired ?? '?'}% repaired · {lastResult.notKept ?? '?'}% not kept
            {runtime?.state === 'done' &&
              ((lastResult.notKept ?? 0) > 0 ? ' — some promises not kept (see the log)' : runtime.converged ? ' — converged' : ' — still repairing')}
            {lastResult.exit !== 0 && ` — cf-agent exited ${lastResult.exit}`}
          </Typography>
        )}
        {isHub && hub && (
          <Typography sx={{ fontSize: 12 }}>
            Mission Portal:{' '}
            {hub.url ? (
              <Link href={hub.url} target="_blank" rel="noreferrer">
                {hub.url}
              </Link>
            ) : (
              'publish container port 443 to open it'
            )}
            {hub.setupCode && (
              <>
                {' '}
                · first-login setup code <strong>{hub.setupCode}</strong>
              </>
            )}
          </Typography>
        )}
        <PortsField ports={host.ports} taken={props.otherPorts} disabled={busy} onChange={ports => props.onChange({ ports })} />
        <EnvVarsField label="This host's environment variables" env={host.env} onChange={env => props.onChange({ env })} />
      </Stack>
    </Paper>
  );
}
