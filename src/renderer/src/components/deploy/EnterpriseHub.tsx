import { type ReactNode, useEffect, useState } from 'react';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Alert, Box, Button, CircularProgress, LinearProgress, MenuItem, Stack, TextField, Typography } from '@mui/material';

import type { GitStatus, HubProbe, HubState, SavedHub } from '../../../../preload/api';
import { HUB_STAGES, startHubDeploy, useDeployRun } from '../../project/deployRuns';

type Failure = { details: string; message: string };
const short = (hash: string | null | undefined) => (hash ? hash.slice(0, 7) : '?');
// git@host:a/b.git, https://host/a/b(.git), git://host/a/b.git: compared without scheme, user and .git.
const sameRepo = (a: string, b: string) => {
  const norm = (url: string) =>
    url
      .trim()
      .replace(/^[a-z+]+:\/\//, '')
      .replace(/^[^@/]+@/, '')
      .replace(':', '/')
      .replace(/\.git\/?$/, '')
      .toLowerCase();
  return Boolean(a && b) && norm(a) === norm(b);
};

const isSsh = (url: string) => /^(ssh:\/\/|[\w.-]+@[\w.-]+:)/.test(url.trim());

// git@host:owner/repo.git → https://host/owner/repo.git (for a public repository the hub then needs no key).
function httpsOf(url: string): string | null {
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(url.trim());
  const ssh = /^ssh:\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+)$/.exec(url.trim());
  const [, host, repoPath] = scp ?? ssh ?? [];
  return host ? `https://${host}/${repoPath.replace(/^\/+/, '')}` : null;
}

function Row({ children, tone }: { children: ReactNode; tone: 'success' | 'warning' }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', py: 0.25 }}>
      {tone === 'success' ? (
        <CheckCircleIcon color="success" sx={{ fontSize: 18, mt: 0.1 }} />
      ) : (
        <WarningAmberIcon color="warning" sx={{ fontSize: 18, mt: 0.1 }} />
      )}
      <Typography component="div" sx={{ fontSize: 13 }}>
        {children}
      </Typography>
    </Stack>
  );
}

function Failed({ failure }: { failure: Failure | null }) {
  if (!failure) return null;
  return (
    <Alert severity="error">
      {failure.message}
      {failure.details && (
        <Box component="pre" sx={{ m: 0, mt: 0.5, fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>
          {failure.details}
        </Box>
      )}
    </Alert>
  );
}

// Log in: URL, user, password; a self-signed certificate is shown to accept by fingerprint first.
function ConnectForm({ onConnected }: { onConnected: (hub: SavedHub, state: HubState) => void }) {
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
      <Stack direction="row" spacing={1}>
        <TextField
          label="Hub (Mission Portal) URL"
          size="small"
          placeholder="https://hub.example.com"
          value={url}
          onChange={event => {
            setUrl(event.target.value);
            setProbe(null);
          }}
          sx={{ flex: 2 }}
        />
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
      <Failed failure={failure} />
      <Typography sx={{ fontSize: 11, color: 'text.muted' }}>
        The password is kept encrypted in your system keychain. The user needs the VCS settings, CMDB and “run agent” permissions (admin has them).
      </Typography>
    </Stack>
  );
}

// Points the hub at this project's repository: GIT_CFBS, so the hub builds it with cfbs itself.
function VcsForm({
  onCancel,
  busy,
  git,
  onSave,
  state
}: {
  busy: boolean;
  git: GitStatus | null;
  // Back to the saved settings (while changing them).
  onCancel?: () => void;
  onSave: (settings: Parameters<NonNullable<Window['api']>['hubConfigureVcs']>[1]) => void;
  state: HubState;
}) {
  const [repository, setRepository] = useState(git?.remote ?? '');
  const [branch, setBranch] = useState(git?.branch ?? 'main');
  const [subdirectory, setSubdirectory] = useState('');
  const [access, setAccess] = useState<'key' | 'none' | 'token'>('none');
  const [gitUsername, setGitUsername] = useState('');
  const [token, setToken] = useState('');
  const [keyFile, setKeyFile] = useState('');
  const replaces = state.vcs && !(state.vcs.type === 'GIT_CFBS' && sameRepo(state.vcs.url, repository));
  // Over SSH the hub needs a key: without one its ssh refuses the unknown host key, and hosts like GitHub refuse keyless SSH.
  const sshWithoutKey = access !== 'key' && isSsh(repository);
  const https = httpsOf(repository);
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1}>
        <TextField
          label="Repository the hub pulls"
          size="small"
          value={repository}
          onChange={event => setRepository(event.target.value)}
          helperText="As the hub reaches it: usually the project's origin"
          sx={{ flex: 3 }}
          slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 } } }}
        />
        <TextField label="Branch" size="small" value={branch} onChange={event => setBranch(event.target.value)} sx={{ flex: 1 }} />
        <TextField
          label="Subdirectory"
          size="small"
          placeholder="(root)"
          value={subdirectory}
          onChange={event => setSubdirectory(event.target.value)}
          sx={{ flex: 1 }}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField select label="Access" size="small" value={access} onChange={event => setAccess(event.target.value as typeof access)} sx={{ width: 200 }}>
          <MenuItem value="none">Public repository</MenuItem>
          <MenuItem value="token">Username + token</MenuItem>
          <MenuItem value="key">Deploy key (private key)</MenuItem>
        </TextField>
        {access === 'token' && (
          <>
            <TextField label="Git username" size="small" value={gitUsername} onChange={event => setGitUsername(event.target.value)} sx={{ flex: 1 }} />
            <TextField
              label="Token (read-only advised)"
              size="small"
              type="password"
              value={token}
              onChange={event => setToken(event.target.value)}
              sx={{ flex: 1 }}
            />
          </>
        )}
        {access === 'key' && (
          <>
            <TextField
              label="Key file"
              size="small"
              value={keyFile}
              placeholder="The private half of a deploy key on the repository"
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { readOnly: true, style: { fontFamily: 'monospace', fontSize: 12 } } }}
            />
            <Button size="small" variant="outlined" onClick={() => void window.api?.pickSshKey().then(picked => picked && setKeyFile(picked))}>
              Choose…
            </Button>
          </>
        )}
        <Box sx={{ flex: 1 }} />
        {onCancel && (
          <Button size="small" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="contained"
          size="small"
          title="Saves these settings on the hub; Deploy now then uses them"
          disabled={busy || !repository.trim() || !branch.trim() || (access === 'key' && !keyFile) || (access === 'token' && (!gitUsername || !token))}
          onClick={() =>
            onSave({
              gitServer: repository.trim(),
              gitRefspec: branch.trim(),
              projectSubdirectory: subdirectory.trim(),
              ...(access === 'token' ? { gitUsername, gitPassword: token } : {}),
              ...(access === 'key' ? { gitPrivateKeyFile: keyFile } : {})
            })
          }
        >
          Save to the hub
        </Button>
      </Stack>
      {sshWithoutKey && (
        <Alert
          severity="warning"
          action={
            https ? (
              <Button color="inherit" size="small" onClick={() => setRepository(https)}>
                Use {https.replace(/^https:\/\//, '')}
              </Button>
            ) : undefined
          }
        >
          This is an SSH URL: the hub can only pull it with a deploy key. For a public repository use its https URL; otherwise choose “Deploy key”.
        </Alert>
      )}
      {replaces && (
        <Typography sx={{ fontSize: 12, color: 'warning.main' }}>
          Replaces the hub’s current source ({state.vcs!.type} {state.vcs!.url} @ {state.vcs!.refspec}).
        </Typography>
      )}
    </Stack>
  );
}

function DeployProgress({ stage }: { stage: string | null }) {
  const index = Math.max(
    0,
    HUB_STAGES.findIndex(item => item.id === stage)
  );
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <CircularProgress size={12} thickness={5} />
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          Step {index + 1} of {HUB_STAGES.length} · {HUB_STAGES[index].label}…
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={(index / HUB_STAGES.length) * 100} />
    </Stack>
  );
}

const isPushed = (git: GitStatus | null) => Boolean(git?.repo && git.lastCommit && git.ahead === 0 && git.changedFiles === 0 && git.remote);

// What the hub runs against what's pushed, and whether there's anything left to push.
function PolicyRows({ fromThisProject, git, releaseId }: { fromThisProject: boolean; git: GitStatus | null; releaseId: string | null }) {
  const pushed = isPushed(git);
  const current = pushed && releaseId === git?.lastCommit?.hash;
  return (
    <>
      {releaseId && (
        <Row tone={current ? 'success' : 'warning'}>
          The hub runs policy {short(releaseId)}
          {current ? ': your last pushed commit.' : git?.lastCommit ? `; your last commit is ${short(git.lastCommit.hash)}.` : '.'}
          <Box component="span" sx={{ color: 'text.muted' }}>
            {' '}
            (The hub reports this every ~5 minutes.)
          </Box>
        </Row>
      )}
      {!pushed && fromThisProject && <Row tone="warning">Commit and push first: the hub builds what’s in the repository, not your local edits.</Row>}
    </>
  );
}

function HubDeployResult({ run }: { run: ReturnType<typeof useDeployRun> }) {
  return (
    <>
      {run.action === 'hub' && <DeployProgress stage={run.stage} />}
      {run.hub.phase === 'failed' && <Failed failure={run.hub.failure} />}
      {run.hub.phase === 'done' && (
        <>
          {run.hub.deployed === 'yes' && (
            <Alert severity="success">
              The hub pulled, built and deployed the repository. Its hosts get the new policy on their next run (within ~5 minutes).
            </Alert>
          )}
          {run.hub.deployed === 'unknown' && (
            <Alert severity="warning">
              The hub ran its agent, but its output (cut at 4 KB by the hub) doesn’t say how the deploy went. “The hub runs policy …” above shows the result
              once the hub reports, within ~5 minutes.
            </Alert>
          )}
          {run.hub.deployed === 'no' && (
            <Alert severity="error">
              The hub couldn’t deploy. Its reason is only in the hub’s /var/cfengine/outputs/dc-scripts.log; the usual ones:
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                <li>
                  An SSH repository URL without a deploy key: GitHub and most hosts refuse SSH without one (and the hub doesn’t know their host key). Use the
                  https URL, or a deploy key.
                </li>
                <li>A private repository without a token or key, or the hub can’t reach it.</li>
                <li>The branch doesn’t exist, or cfbs build / cf-promises fails on the hub.</li>
              </Box>
            </Alert>
          )}
          <Box
            component="pre"
            sx={{ m: 0, p: 1, fontSize: 11, maxHeight: 220, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap' }}
          >
            {run.hub.output.trim() || '(no output)'}
          </Box>
        </>
      )}
    </>
  );
}

// The hub deploys this project: from where, and whether it can pull it at all.
function ProjectSource({ onChange, vcs }: { onChange: () => void; vcs: NonNullable<HubState['vcs']> }) {
  const https = httpsOf(vcs.url);
  return (
    <>
      <Row tone="success">
        Deploys this project: {vcs.url} @ {vcs.refspec} (GIT_CFBS: the hub builds it with cfbs).{' '}
        <Button size="small" onClick={onChange} sx={{ py: 0 }}>
          Change
        </Button>
      </Row>
      {isSsh(vcs.url) && !vcs.hasKey && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onChange}>
              Change
            </Button>
          }
        >
          The hub can’t pull this: it’s an SSH URL without a deploy key (the hub’s ssh refuses the unknown host key, and GitHub refuses keyless SSH). Switch to
          the https URL{https ? ` (${https})` : ''} for a public repository, or add a deploy key.
        </Alert>
      )}
    </>
  );
}

// Deploy now, only once the hub's saved settings are this project's.
function DeployNow({
  deploysEnabled,
  disabled,
  editing,
  fromThisProject,
  onDeploy,
  running
}: {
  deploysEnabled: boolean;
  disabled: boolean;
  editing: boolean;
  fromThisProject: boolean;
  onDeploy: () => void;
  running: boolean;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Button
        variant="contained"
        size="small"
        disabled={disabled || !fromThisProject || editing}
        title={
          editing
            ? 'Save the settings to the hub first (or cancel): Deploy now uses what the hub has'
            : fromThisProject
              ? 'Run the hub’s agent now: it pulls the repository, builds it with cfbs, validates and deploys'
              : 'Set the hub to deploy this project first'
        }
        onClick={onDeploy}
      >
        {running ? 'Deploying…' : 'Deploy now'}
      </Button>
      {editing && <Typography sx={{ fontSize: 12, color: 'warning.main' }}>Save the settings to the hub first: Deploy now uses what the hub has.</Typography>}
      {!deploysEnabled && fromThisProject && (
        <Typography sx={{ fontSize: 12, color: 'text.muted' }}>
          The first deploy also turns on deploys from version control (a CMDB class on the hub).
        </Typography>
      )}
    </Stack>
  );
}

/**
 * Deployment's Enterprise hub tab: connect to Mission Portal's API, have the hub deploy this
 * project from its git repository (GIT_CFBS), and Deploy now — what Mission Portal's Build app does.
 */
export function EnterpriseHub({ busy, git, path }: { busy: boolean; git: GitStatus | null; path: string }) {
  const run = useDeployRun(path);
  const storageKey = `cfpb.deploy.hub:${path}`;
  const [hubs, setHubs] = useState<SavedHub[] | null>(null);
  const [url, setUrl] = useState<string | null>(() => localStorage.getItem(storageKey));
  const [state, setState] = useState<HubState | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
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

  if (!window.api || hubs === null) return null;
  if (!hub) {
    return (
      <ConnectForm
        onConnected={(saved, connected) => {
          setHubs([...hubs.filter(item => item.url !== saved.url), saved]);
          choose(saved.url);
          setState(connected);
        }}
      />
    );
  }

  const vcs = state?.vcs;
  const fromThisProject = Boolean(vcs && vcs.type === 'GIT_CFBS' && git?.remote && sameRepo(vcs.url, git.remote) && vcs.refspec === git.branch);
  const working = busy || saving || run.action !== null;

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography sx={{ fontSize: 13, flex: 1 }}>
          {state ? (
            <>
              <b>{state.info.hostname}</b> · {hub.url.replace(/^https:\/\//, '')} · Enterprise {state.info.version}
              {state.hosts !== null && ` · ${state.hosts} ${state.hosts === 1 ? 'host' : 'hosts'}`}
              {state.info.license && ` · ${state.info.license}`}
            </>
          ) : (
            `Connecting to ${hub.url}…`
          )}
        </Typography>
        <Button size="small" disabled={working} onClick={() => choose(null)}>
          Other hub
        </Button>
        <Button
          size="small"
          color="error"
          disabled={working}
          onClick={() =>
            void window.api!.hubForget(hub.url).then(() => {
              setHubs(hubs.filter(item => item.url !== hub.url));
              choose(null);
            })
          }
        >
          Forget
        </Button>
      </Stack>
      <Failed failure={failure} />

      {state && (
        <>
          {fromThisProject && !editing && <ProjectSource vcs={vcs!} onChange={() => setEditing(true)} />}
          {fromThisProject && !editing ? null : (
            <>
              <Row tone="warning">
                {vcs ? (
                  <>
                    The hub deploys from {vcs.type} {vcs.url || '(none)'} @ {vcs.refspec}
                    {vcs.type === 'GIT_CFBS' && sameRepo(vcs.url, git?.remote ?? '') ? ', another branch' : ', not this project'}.
                  </>
                ) : (
                  'The hub isn’t set up to deploy from version control.'
                )}
              </Row>
              {!git?.remote && (
                <Typography sx={{ fontSize: 12, color: 'text.muted' }}>
                  Set the project’s remote and push first (Push to a git repository), so the hub has something to pull.
                </Typography>
              )}
              <VcsForm
                onCancel={fromThisProject ? () => setEditing(false) : undefined}
                busy={working}
                git={git}
                state={state}
                onSave={settings => {
                  setSaving(true);
                  setFailure(null);
                  void window
                    .api!.hubConfigureVcs(hub.url, settings)
                    .then(result => {
                      if (result.ok) {
                        setState(result.state);
                        setEditing(false);
                      } else setFailure(result);
                    })
                    .finally(() => setSaving(false));
                }}
              />
            </>
          )}

          <PolicyRows git={git} releaseId={state.releaseId} fromThisProject={fromThisProject} />
          <DeployNow
            disabled={working}
            editing={editing}
            fromThisProject={fromThisProject}
            deploysEnabled={state.deploysEnabled}
            running={run.action === 'hub'}
            onDeploy={() => void startHubDeploy(path, hub.url, setState)}
          />
          <HubDeployResult run={run} />
        </>
      )}
    </Stack>
  );
}
