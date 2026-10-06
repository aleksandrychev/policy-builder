import { useEffect, useState } from 'react';

import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';

import type { GitStatus, HubProbe, HubState, SavedHub } from '../../../../preload/api';
import type { Failure, HubDeploy } from '../../project/deployRuns';
import { FailureAlert, Line, Output } from './shared';

// git@host:a/b.git, https://host/a/b(.git), git://host/a/b.git: compared without scheme, user and .git.
export const sameRepo = (a: string, b: string) => {
  const norm = (url: string) =>
    url
      .trim()
      .replace(/^[a-z+]+:\/\//, '')
      .replace(/^[^@/]+@/, '')
      .replace(':', '/')
      .replace(/\/+$/, '')
      .replace(/\.git$/, '')
      .toLowerCase();
  return Boolean(a && b) && norm(a) === norm(b);
};

export const isSsh = (url: string) => /^(ssh:\/\/|[\w.-]+@[\w.-]+:)/.test(url.trim());

// git@host:owner/repo.git → https://host/owner/repo.git (for a public repository the hub then needs no key).
export function httpsOf(url: string): string | null {
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(url.trim());
  const ssh = /^ssh:\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+)$/.exec(url.trim());
  const [, host, repoPath] = scp ?? ssh ?? [];
  return host ? `https://${host}/${repoPath.replace(/^\/+/, '')}` : null;
}

// The hub deploys exactly this project: its repository and branch, built with cfbs.
export const deploysProject = (state: HubState | null, git: GitStatus | null) =>
  Boolean(state?.vcs && state.vcs.type === 'GIT_CFBS' && git?.remote && sameRepo(state.vcs.url, git.remote) && state.vcs.refspec === git.branch);

// Why the hub doesn't deploy this project, in words (null when it does).
export function whyNotProject(state: HubState, git: GitStatus | null): string | null {
  const vcs = state.vcs;
  if (!vcs) return 'The hub isn’t set up to deploy from git.';
  if (!git?.remote)
    return `The hub deploys ${vcs.url || '(none)'} @ ${vcs.refspec}, but this project has no remote to compare with (set it under Git repository).`;
  if (!sameRepo(vcs.url, git.remote)) return `The hub deploys ${vcs.url || '(none)'}, not this project’s ${git.remote}.`;
  if (vcs.refspec !== git.branch) return `The hub deploys branch “${vcs.refspec}”, this project is on “${git.branch ?? '?'}”.`;
  if (vcs.type !== 'GIT_CFBS') return `The hub deploys this repository as ${vcs.type}, not GIT_CFBS (built with cfbs on the hub).`;
  return null;
}

// It can't pull an SSH URL without a deploy key (unknown host key; GitHub refuses keyless SSH).
export const cannotPull = (state: HubState | null) => Boolean(state?.vcs && isSsh(state.vcs.url) && !state.vcs.hasKey);

/** The project's Enterprise hub: saved logins, the one chosen for this project, and its state. */
export function useHub(path: string | null) {
  const storageKey = `cfpb.deploy.hub:${path}`;
  const [hubs, setHubs] = useState<SavedHub[] | null>(null);
  const [url, setUrl] = useState<string | null>(() => localStorage.getItem(storageKey));
  const [state, setState] = useState<HubState | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const hub = hubs?.find(item => item.url === url) ?? null;

  useEffect(() => {
    let current = true;
    void window.api?.hubList().then(list => current && setHubs(list));
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!hub) return;
    let current = true;
    void window.api?.hubState(hub.url).then(result => {
      if (!current) return;
      if (result.ok) setState(result.state);
      else setFailure(result);
    });
    return () => {
      current = false;
    };
  }, [hub]);

  const choose = (next: string | null) => {
    setUrl(next);
    setState(null);
    setFailure(null);
    if (next) localStorage.setItem(storageKey, next);
    else localStorage.removeItem(storageKey);
  };

  return {
    hub,
    state,
    failure,
    loaded: hubs !== null,
    setState,
    connected: (saved: SavedHub, connected: HubState) => {
      setHubs([...(hubs ?? []).filter(item => item.url !== saved.url), saved]);
      choose(saved.url);
      setState(connected);
    },
    forget: async () => {
      if (!hub) return;
      await window.api!.hubForget(hub.url);
      setHubs((hubs ?? []).filter(item => item.url !== hub.url));
      choose(null);
    },
    other: () => choose(null),
    refresh: async () => {
      if (!hub) return;
      const result = await window.api!.hubState(hub.url);
      if (result.ok) setState(result.state);
      else setFailure(result);
    }
  };
}

export type HubHandle = ReturnType<typeof useHub>;

export const hubLabel = (state: HubState) =>
  `${state.info.hostname} · Enterprise ${state.info.version}${state.hosts !== null ? ` · ${state.hosts} ${state.hosts === 1 ? 'host' : 'hosts'}` : ''}`;

// Log in: URL, user, password; a self-signed certificate is shown to accept by fingerprint first.
export function ConnectForm({ onConnected }: { onConnected: (hub: SavedHub, state: HubState) => void }) {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [probe, setProbe] = useState<HubProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const connect = async (accepted: string | null) => {
    setBusy(true);
    setFailure(null);
    try {
      if (accepted === null) {
        const checked = await window.api!.hubProbe(url);
        if (!checked.ok) return setFailure(checked);
        if (!checked.probe.trusted) return setProbe(checked.probe);
      }
      const result = await window.api!.hubConnect({ url, username, password, fingerprint: accepted });
      if (!result.ok) return setFailure(result);
      onConnected(result.hub, result.state);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      <TextField
        label="Hub (Mission Portal) URL"
        size="small"
        placeholder="https://hub.example.com"
        value={url}
        onChange={event => {
          setUrl(event.target.value);
          setProbe(null);
        }}
      />
      <Stack direction="row" spacing={1}>
        <TextField label="Username" size="small" value={username} onChange={event => setUsername(event.target.value)} sx={{ flex: 1 }} />
        <TextField label="Password" size="small" type="password" value={password} onChange={event => setPassword(event.target.value)} sx={{ flex: 1 }} />
        <Button variant="contained" size="small" disabled={busy || !url.trim() || !username || !password} onClick={() => void connect(null)}>
          {busy ? 'Connecting…' : 'Connect'}
        </Button>
      </Stack>
      {probe && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" disabled={busy} onClick={() => void connect(probe.fingerprint)}>
              Trust and connect
            </Button>
          }
        >
          This computer doesn’t trust the hub’s certificate (self-signed{probe.subject ? `, “${probe.subject}”` : ''}, valid until {probe.validTo}). Trust it
          only if this fingerprint is the hub’s:
          <Box component="div" sx={{ fontFamily: 'monospace', fontSize: 11, mt: 0.5, wordBreak: 'break-all' }}>
            SHA-256 {probe.fingerprint}
          </Box>
        </Alert>
      )}
      <FailureAlert failure={failure} />
      <Typography sx={{ fontSize: 11, color: 'text.muted' }}>
        The password is kept encrypted in your system keychain. The user needs the VCS settings, CMDB and “run agent” permissions (admin has them).
      </Typography>
    </Stack>
  );
}

// Points the hub at this project's repository: GIT_CFBS, so the hub builds it with cfbs itself.
export function VcsForm({
  busy,
  git,
  onSave,
  state
}: {
  busy: boolean;
  git: GitStatus | null;
  onSave: (settings: Parameters<NonNullable<Window['api']>['hubConfigureVcs']>[1]) => void;
  state: HubState;
}) {
  const vcs = state.vcs;
  const [repository, setRepository] = useState(vcs?.type === 'GIT_CFBS' && vcs.url ? vcs.url : (git?.remote ?? ''));
  const [branch, setBranch] = useState(vcs?.type === 'GIT_CFBS' && vcs.refspec ? vcs.refspec : (git?.branch ?? 'main'));
  const [subdirectory, setSubdirectory] = useState(vcs?.subdirectory ?? '');
  const [access, setAccess] = useState<'key' | 'none' | 'token'>(vcs?.hasKey ? 'key' : vcs?.username ? 'token' : 'none');
  const [gitUsername, setGitUsername] = useState(vcs?.username ?? '');
  const [token, setToken] = useState('');
  const [keyFile, setKeyFile] = useState('');
  const replaces = vcs && !(vcs.type === 'GIT_CFBS' && sameRepo(vcs.url, repository));
  const sshWithoutKey = access !== 'key' && isSsh(repository);
  const https = httpsOf(repository);
  const notProjectBranch = git?.branch && branch.trim() && branch.trim() !== git.branch;
  return (
    <Stack spacing={1.25}>
      <TextField
        label="Repository the hub pulls"
        size="small"
        value={repository}
        onChange={event => setRepository(event.target.value)}
        helperText="As the hub reaches it: usually the project's origin"
        slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 } } }}
      />
      <Stack direction="row" spacing={1}>
        <TextField
          label="Branch"
          size="small"
          value={branch}
          onChange={event => setBranch(event.target.value)}
          helperText={notProjectBranch ? `The project is on ${git?.branch}` : ' '}
          sx={{ flex: 1 }}
        />
        <TextField
          label="Subdirectory"
          size="small"
          placeholder="(root)"
          value={subdirectory}
          onChange={event => setSubdirectory(event.target.value)}
          helperText=" "
          sx={{ flex: 1 }}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField select label="Access" size="small" value={access} onChange={event => setAccess(event.target.value as typeof access)} sx={{ width: 220 }}>
          <MenuItem value="none">Public repository</MenuItem>
          <MenuItem value="token">Username + token</MenuItem>
          <MenuItem value="key">Deploy key (private key)</MenuItem>
        </TextField>
        {access === 'token' && (
          <>
            <TextField label="Git username" size="small" value={gitUsername} onChange={event => setGitUsername(event.target.value)} sx={{ flex: 1 }} />
            <TextField label="Token" size="small" type="password" value={token} onChange={event => setToken(event.target.value)} sx={{ flex: 1 }} />
          </>
        )}
        {access === 'key' && (
          <>
            <TextField
              label="Key file"
              size="small"
              value={keyFile}
              placeholder={vcs?.hasKey ? 'A key is set: choose one to replace it' : 'The private half of a deploy key on the repository'}
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { readOnly: true, style: { fontFamily: 'monospace', fontSize: 12 } } }}
            />
            <Button size="small" variant="outlined" onClick={() => void window.api?.pickSshKey().then(picked => picked && setKeyFile(picked))}>
              Choose…
            </Button>
          </>
        )}
      </Stack>
      {sshWithoutKey && (
        <Alert
          severity="warning"
          action={
            https ? (
              <Button color="inherit" size="small" onClick={() => setRepository(https)}>
                Use https
              </Button>
            ) : undefined
          }
        >
          An SSH URL needs a deploy key: the hub can’t pull it otherwise. For a public repository use its https URL{https ? ` (${https})` : ''}.
        </Alert>
      )}
      {replaces && (
        <Typography sx={{ fontSize: 12, color: 'warning.main' }}>
          Replaces the hub’s current source ({vcs!.type} {vcs!.url || '(none)'} @ {vcs!.refspec}).
        </Typography>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          size="small"
          disabled={
            busy || !repository.trim() || !branch.trim() || (access === 'key' && !keyFile && !vcs?.hasKey) || (access === 'token' && (!gitUsername || !token))
          }
          onClick={() =>
            onSave({
              gitServer: repository.trim(),
              gitRefspec: branch.trim(),
              projectSubdirectory: subdirectory.trim(),
              ...(access === 'token' ? { gitUsername, gitPassword: token } : {}),
              ...(access === 'key' && keyFile ? { gitPrivateKeyFile: keyFile } : {})
            })
          }
        >
          Save to the hub
        </Button>
      </Box>
    </Stack>
  );
}

// How a hub deploy ended, in plain words, with the hub's agent output.
export function HubOutcome({ hub }: { hub: HubDeploy }) {
  if (hub.phase === 'failed') return <FailureAlert failure={hub.failure} />;
  if (hub.phase !== 'done') return null;
  return (
    <Stack spacing={1}>
      {hub.deployed === 'yes' && (
        <Alert severity="success">The hub pulled, built and deployed the repository. Its hosts get the new policy on their next run (within ~5 minutes).</Alert>
      )}
      {hub.deployed === 'unknown' && (
        <Alert severity="warning">
          The hub ran its agent, but its output (cut at 4 KB) doesn’t say how the deploy went. The commit the hub runs shows the result once it reports, within
          ~5 minutes.
        </Alert>
      )}
      {hub.deployed === 'no' && (
        <Alert severity="error">
          The hub couldn’t deploy. Its reason is in the hub’s /var/cfengine/outputs/dc-scripts.log; usually:
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            <li>an SSH repository URL without a deploy key (use the https URL, or a deploy key);</li>
            <li>a private repository without a token or key, or one the hub can’t reach;</li>
            <li>a branch that doesn’t exist, or cfbs build / cf-promises failing on the hub.</li>
          </Box>
        </Alert>
      )}
      <Output text={hub.output} />
    </Stack>
  );
}

// The hub's connection and source, for the target settings.
export function HubSettings({ busy, git, hub }: { busy: boolean; git: GitStatus | null; hub: HubHandle }) {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saved, setSaved] = useState(false);
  if (!hub.loaded) return null;
  if (!hub.hub) return <ConnectForm onConnected={hub.connected} />;
  const { state } = hub;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography sx={{ fontSize: 13, flex: 1 }}>
          {state ? (
            <>
              <b>{state.info.hostname}</b> · {hub.hub.url.replace(/^https:\/\//, '')} · Enterprise {state.info.version}
              {state.info.license && ` · ${state.info.license}`}
            </>
          ) : (
            `Connecting to ${hub.hub.url}…`
          )}
        </Typography>
        <Button size="small" disabled={busy} onClick={hub.other}>
          Other hub
        </Button>
        <Button size="small" color="error" disabled={busy} onClick={() => void hub.forget()}>
          Forget
        </Button>
      </Stack>
      <FailureAlert failure={hub.failure ?? failure} />
      {state && (
        <>
          {deploysProject(state, git) ? (
            <Line tone={cannotPull(state) ? 'error' : 'success'}>
              Deploys this project: {state.vcs!.url} @ {state.vcs!.refspec}
              {cannotPull(state) && ' — but it can’t pull an SSH URL without a deploy key.'}
            </Line>
          ) : (
            <Line tone="warning">{whyNotProject(state, git)}</Line>
          )}
          <VcsForm
            busy={busy || saving}
            git={git}
            state={state}
            onSave={settings => {
              setSaving(true);
              setFailure(null);
              setSaved(false);
              void window
                .api!.hubConfigureVcs(hub.hub!.url, settings)
                .then(result => {
                  if (!result.ok) return setFailure(result);
                  hub.setState(result.state);
                  setSaved(true);
                })
                .finally(() => setSaving(false));
            }}
          />
          {saved && <Alert severity="success">Saved to the hub. It deploys from these settings on its next update, or press Deploy now.</Alert>}
        </>
      )}
    </Stack>
  );
}
