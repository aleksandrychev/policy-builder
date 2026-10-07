import { useState } from 'react';

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';

import type { GitStatus } from '../../../../preload/api';
import { type Failure, type SshTarget, forgetSshTarget, saveSshTarget, sshTargetOf } from '../../project/deployRuns';
import { type HubHandle, HubSettings } from './hub';
import { FailureAlert } from './shared';

// Where shipping goes: one per project.
export type Target = 'git' | 'hub' | 'ssh';
export const TARGET_LABELS: Record<Target, string> = { git: 'Git repository', ssh: 'Hub over SSH', hub: 'Enterprise hub' };
export const TARGET_TITLES: Record<Target, string> = { git: 'Git repository', ssh: 'Hub over SSH', hub: 'Enterprise hub' };

const REMOTE_URL = /^(?:(?:https?|ssh|git|file):\/\/\S+|[\w.-]+@[\w.-]+:\S+|\/\S+)$/;
const SSH_HOST = /^(?:[\w.-]+@)?[\w][\w.-]*$/;

export function RemoteSettings({ git, onSaved, path }: { git: GitStatus | null; onSaved: (status: GitStatus) => void; path: string }) {
  const [remote, setRemote] = useState(git?.remote ?? '');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setFailure(null);
    const result = await window.api!.gitSetRemote(path, remote.trim());
    setBusy(false);
    if (result.ok) onSaved(result.status);
    else setFailure(result);
  };
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          label="Remote (origin)"
          size="small"
          placeholder="git@github.com:org/policy.git"
          value={remote}
          onChange={event => setRemote(event.target.value)}
          helperText="Pushing uses your own git credentials (SSH agent or credential helper); the app stores none."
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 } } }}
        />
        <Button
          variant="contained"
          size="small"
          disabled={busy || !REMOTE_URL.test(remote.trim()) || remote.trim() === git?.remote}
          onClick={() => void save()}
        >
          {git?.remote ? 'Change' : 'Set'}
        </Button>
      </Stack>
      <FailureAlert failure={failure} />
    </Stack>
  );
}

export function SshSettings({ onSaved, path }: { onSaved: () => void; path: string }) {
  const saved = sshTargetOf(path);
  const [host, setHost] = useState(saved?.host ?? '');
  const [port, setPort] = useState(saved?.port ? String(saved.port) : '');
  const [key, setKey] = useState(saved?.key ?? '');
  const target: SshTarget = { host: host.trim(), port: port ? Number(port) : null, key: key || null };
  const valid = SSH_HOST.test(target.host) && (port === '' || (Number(port) > 0 && Number(port) < 65536));
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1}>
        <TextField
          label="Hub"
          size="small"
          placeholder="root@hub.example.com"
          value={host}
          onChange={event => setHost(event.target.value)}
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 } } }}
        />
        <TextField
          label="Port"
          size="small"
          placeholder="22"
          value={port}
          onChange={event => setPort(event.target.value.replace(/\D/g, '').slice(0, 5))}
          sx={{ width: 90 }}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField
          label="Private key"
          size="small"
          value={key}
          placeholder="Default: your ssh agent and ~/.ssh/config"
          sx={{ flex: 1 }}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { readOnly: true, style: { fontFamily: 'monospace', fontSize: 13 } } }}
        />
        <Button size="small" variant="outlined" onClick={() => void window.api?.pickSshKey().then(picked => picked && setKey(picked))}>
          Choose…
        </Button>
        {key && (
          <Button size="small" onClick={() => setKey('')}>
            Use default
          </Button>
        )}
      </Stack>
      <Typography sx={{ fontSize: 12, color: 'text.muted' }}>
        Deploying runs cf-remote deploy: it copies the built policy set over SSH, makes it /var/cfengine/masterfiles and runs the agent there. Without a user it
        tries the usual ones (ubuntu, centos, root…); the login needs root or passwordless sudo. A hub that deploys from git replaces it on its next update.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        {saved && (
          <Button
            size="small"
            color="error"
            onClick={() => {
              forgetSshTarget(path);
              onSaved();
            }}
          >
            Forget
          </Button>
        )}
        <Button
          variant="contained"
          size="small"
          disabled={!valid}
          onClick={() => {
            saveSshTarget(path, target);
            onSaved();
          }}
        >
          Save
        </Button>
      </Stack>
    </Stack>
  );
}

/** The chosen target's settings: the git remote, the SSH host and key, or the hub's login and source. */
export function TargetSettings({
  busy,
  git,
  hub,
  onClose,
  onGitStatus,
  path,
  target
}: {
  busy: boolean;
  git: GitStatus | null;
  hub: HubHandle;
  onClose: () => void;
  onGitStatus: (status: GitStatus) => void;
  path: string;
  target: Target;
}) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{TARGET_TITLES[target]}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {target === 'git' && <RemoteSettings path={path} git={git} onSaved={status => (onGitStatus(status), onClose())} />}
          {target === 'ssh' && <SshSettings path={path} onSaved={onClose} />}
          {target === 'hub' && (
            <>
              <HubSettings busy={busy} git={git} hub={hub} />
              {!git?.remote && (
                <Typography sx={{ fontSize: 12, color: 'text.muted' }}>The hub pulls from a git repository: set this project’s remote too.</Typography>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
