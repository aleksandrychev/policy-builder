import { type ReactNode, useEffect, useMemo, useState } from 'react';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Alert, Box, Button, CircularProgress, LinearProgress, Link, Paper, Stack, Tab, Tabs, TextField, Typography, alpha, useTheme } from '@mui/material';

import type { BuildProblem, BuildResult, GitStatus } from '../../../preload/api';
import { type ProjectData, fromBuilderProject, toCfbsProject } from '../project/cfbsProject';
import {
  BUILD_STAGES,
  type DeployRun,
  type Failure,
  SSH_STAGES,
  type SshState,
  resetSsh,
  startBuild,
  startSshDeploy,
  useDeployRun
} from '../project/deployRuns';
import { type ProjectChange, commitMessage, projectChanges } from '../project/projectChanges';
import { useEnvironmentRuntime } from '../project/testRuns';
import type { CompiledPolicyState } from '../project/useCompiledPolicy';
import { store, useAppSelector } from '../store';
import { selectCurrentProject } from '../store/projectSlice/selectors';
import { EnterpriseHub } from './deploy/EnterpriseHub';

type Tone = 'error' | 'muted' | 'success' | 'warning';
// Where step 3 delivers the policy set.
type Target = 'git' | 'hub' | 'ssh';

const TAB_SX = { minHeight: 36, py: 0.5, textTransform: 'none', fontSize: 13 } as const;

const ago = (time: number) => {
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
};

// The project as saving writes it, without test environments: what a test run deployed.
const snapshot = (): ProjectData => {
  const state = store.getState();
  return { canvas: state.canvas, derivedNodes: state.derivedNodes, edges: state.edges, files: state.files, groups: state.groups, testEnvironments: [] };
};

function StatusIcon({ tone }: { tone: Tone }) {
  if (tone === 'success') return <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />;
  if (tone === 'error') return <ErrorIcon color="error" sx={{ fontSize: 18 }} />;
  if (tone === 'warning') return <WarningAmberIcon color="warning" sx={{ fontSize: 18 }} />;
  return <RemoveCircleOutlineIcon sx={{ fontSize: 18, color: 'text.disabled' }} />;
}

// One step of the pipeline: number, title, its state, and what it holds.
function Step({ actions, children, number, status, title }: { actions?: ReactNode; children?: ReactNode; number: number; status?: ReactNode; title: string }) {
  const theme = useTheme();
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Box
          sx={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            bgcolor: alpha(theme.palette.primary.main, 0.12),
            color: 'primary.main',
            flexShrink: 0
          }}
        >
          {number}
        </Box>
        <Typography sx={{ fontSize: 15, fontWeight: 700 }}>{title}</Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>{status}</Box>
        <Stack direction="row" spacing={1}>
          {actions}
        </Stack>
      </Stack>
      {children && <Box sx={{ mt: 1.5, pl: 5.25 }}>{children}</Box>}
    </Paper>
  );
}

function Line({ children, tone }: { children: ReactNode; tone: Tone }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.25 }}>
      <StatusIcon tone={tone} />
      <Typography component="div" sx={{ fontSize: 13 }}>
        {children}
      </Typography>
    </Stack>
  );
}

function FailureAlert({ failure }: { failure: Failure | null }) {
  if (!failure) return null;
  return (
    <Alert severity="error" sx={{ mt: 1 }}>
      {failure.message}
      {failure.details && failure.details !== failure.message && (
        <Box component="pre" sx={{ m: 0, mt: 0.5, fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>
          {failure.details}
        </Box>
      )}
    </Alert>
  );
}

function ProblemList({
  blockAt,
  onShowBlock,
  problems
}: {
  blockAt: (problem: BuildProblem) => { fileId: string; id: string; label: string } | null;
  onShowBlock: (fileId: string, id: string) => void;
  problems: BuildProblem[];
}) {
  return (
    <Stack spacing={0.5} sx={{ pl: 3.5, mt: 0.5 }}>
      {problems.slice(0, 20).map((problem, index) => {
        const block = blockAt(problem);
        return (
          <Typography key={index} sx={{ fontSize: 12, color: 'error.main' }}>
            {problem.message}
            <Box component="span" sx={{ color: 'text.muted', ml: 1, fontFamily: 'monospace' }}>
              {problem.file ?? '?'}:{problem.line}
            </Box>
            {block && (
              <Link component="button" sx={{ ml: 1, fontSize: 12 }} onClick={() => onShowBlock(block.fileId, block.id)}>
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

function ChangeList({ changes }: { changes: ProjectChange[] }) {
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

// "Tested?": the last Deploy & run, and whether the policy changed since.
function TestedLine() {
  const environment = useAppSelector(state => state.testEnvironments[0]);
  const runtime = useEnvironmentRuntime(environment?.id ?? '');
  const project = useAppSelector(selectCurrentProject);
  useAppSelector(state => state.canvas);
  const run = runtime.lastRun;
  if (!run) return <Line tone="warning">Not run on a test host yet (Test Results &amp; Logs → Deploy &amp; run).</Line>;
  if (run.passed === null) return <Line tone="muted">Deploy &amp; run is running…</Line>;
  const edited = project ? JSON.stringify(toCfbsProject(snapshot(), project)) !== run.content : false;
  const hosts = `${run.hosts} ${run.hosts === 1 ? 'host' : 'hosts'}`;
  if (edited) return <Line tone="warning">Edited since the last Deploy &amp; run ({ago(run.at)}): run it again to test these changes.</Line>;
  return run.passed ? (
    <Line tone="success">
      Deploy &amp; run passed on {hosts} ({ago(run.at)}).
    </Line>
  ) : (
    <Line tone="error">
      Deploy &amp; run had problems on {hosts} ({ago(run.at)}): see Test Results &amp; Logs.
    </Line>
  );
}

type BlockAt = (problem: BuildProblem) => { fileId: string; id: string; label: string } | null;

// "Step 3 of 9 · Checking with the linter", and a bar over the steps done.
function StageProgress({ stage, stages }: { stage: string | null; stages: typeof SSH_STAGES }) {
  const index = Math.max(
    0,
    stages.findIndex(item => item.id === stage)
  );
  return (
    <Stack spacing={0.5} sx={{ minWidth: 220, maxWidth: 420 }}>
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

function BuildStatus({ run }: { run: DeployRun }) {
  if (run.action === 'build') return <StageProgress stage={run.stage} stages={BUILD_STAGES} />;
  // An SSH deploy builds first: shown here until it moves on to the hub.
  if (run.action === 'ssh' && BUILD_STAGES.some(stage => stage.id === run.stage)) return <StageProgress stage={run.stage} stages={BUILD_STAGES} />;
  if (run.buildFailure) return <Chip tone="error" text="Build failed" />;
  if (!run.build) return <Chip tone="muted" text="Not built yet" />;
  const ok = run.build.lint.ok && run.build.promises.ok !== false;
  return <Chip tone={ok ? 'success' : 'error'} text={ok ? 'Valid' : 'Problems found'} />;
}

function promisesText(promises: BuildResult['promises']) {
  if (promises.ok === null) return `: skipped. ${promises.message ?? ''}`;
  if (promises.ok) return `: valid (${promises.how === 'docker' ? 'in a test-host image' : 'local CFEngine'})`;
  return `: ${promises.problems.length || 'some'} errors`;
}

// What the build made and what the checks found, problems linked to their blocks.
function BuildDetails({
  blockAt,
  build,
  onReveal,
  onShowBlock
}: {
  blockAt: BlockAt;
  build: BuildResult;
  onReveal: (file: string) => void;
  onShowBlock: (fileId: string, id: string) => void;
}) {
  return (
    <>
      <Line tone="success">Built with cfbs</Line>
      <Line tone={build.lint.ok ? 'success' : 'error'}>Linter: {build.lint.ok ? 'no problems' : `${build.lint.problems.length} problems`}</Line>
      {!build.lint.ok && <ProblemList problems={build.lint.problems} blockAt={blockAt} onShowBlock={onShowBlock} />}
      <Line tone={build.promises.ok === null ? 'muted' : build.promises.ok ? 'success' : 'error'}>cf-promises{promisesText(build.promises)}</Line>
      {build.promises.ok === false && <ProblemList problems={build.promises.problems} blockAt={blockAt} onShowBlock={onShowBlock} />}
      {build.tarball && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
          <Typography sx={{ fontSize: 12, fontFamily: 'monospace', color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {build.tarball}
          </Typography>
          <Button size="small" onClick={() => onReveal(build.tarball!)}>
            Reveal
          </Button>
        </Stack>
      )}
    </>
  );
}

/**
 * The Deployment tab: build and check the saved project's policy set, see what changed since the
 * last commit, then deliver it: commit and push (a hub on GIT_CFBS deploys from the repository),
 * or copy it to a hub over SSH as cf-remote deploy does.
 */
export function DeploymentView({
  compiled,
  onReload,
  onSave,
  onShowBlock
}: {
  compiled: CompiledPolicyState;
  // Reads the project from disk again (after pulling the remote's commits into it).
  onReload: () => Promise<void>;
  onSave: () => Promise<boolean>;
  onShowBlock: (fileId: string, id: string) => void;
}) {
  const project = useAppSelector(selectCurrentProject);
  const canvas = useAppSelector(state => state.canvas);
  const edges = useAppSelector(state => state.edges);
  const groups = useAppSelector(state => state.groups);
  const files = useAppSelector(state => state.files);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [gitFailure, setGitFailure] = useState<Failure | null>(null);
  const [gitBusy, setBusy] = useState<'commit' | 'force' | 'init' | 'push' | 'rebase' | 'remote' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [remote, setRemote] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>(() => (localStorage.getItem(`cfpb.deploy.target:${project?.path}`) as Target | null) ?? 'git');
  const chooseTarget = (value: Target) => {
    setTarget(value);
    localStorage.setItem(`cfpb.deploy.target:${path}`, value);
  };
  // What the last git action did, e.g. "Committed 5ec6020".
  const [notice, setNotice] = useState<string | null>(null);
  const path = project?.path ?? null;
  const run = useDeployRun(path);
  const { build, buildFailure, ssh } = run;
  // A Build or deploy, or a git action: one at a time.
  const busy = gitBusy ?? run.action;

  useEffect(() => {
    let current = true;
    if (path && window.api) {
      void window.api.gitStatus(path).then(result => {
        if (!current) return;
        if (result.ok) setGit(result.status);
        else setGitFailure(result);
      });
    }
    return () => {
      current = false;
    };
  }, [path]);

  const changes = useMemo(() => {
    let head: ProjectData | null = null;
    try {
      head = git?.headBuilder ? fromBuilderProject(git.headBuilder) : null;
    } catch {
      head = null;
    }
    // Through the same save and load as the commit went, so both sides have the same shape (saving
    // re-attaches arrows that cross a group frame, and splits a group's look from its policy).
    let now = snapshot();
    try {
      if (project) now = fromBuilderProject(toCfbsProject(now, project).project);
    } catch {
      // Unsaveable state: compare as it is.
    }
    return projectChanges(head, now);
    // The store slices are what the snapshot reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [git, canvas, edges, groups, files, project]);

  // A build or check problem's block, through the compiled source map.
  const blockAt = (problem: BuildProblem) => {
    const ranges = problem.file ? compiled.result?.sourceMap[problem.file] : undefined;
    const fileId = Object.entries(compiled.pathOf).find(([, policyPath]) => policyPath === problem.file)?.[0];
    if (!ranges || !fileId) return null;
    let best: { id: string; size: number } | null = null;
    for (const [id, spans] of Object.entries(ranges)) {
      for (const [first, last] of spans) {
        if (first <= problem.line && problem.line <= last && (!best || last - first < best.size)) best = { id, size: last - first };
      }
    }
    const block = best && canvas.find(item => item.instanceId === best.id);
    return block ? { fileId, id: block.instanceId, label: block.label } : null;
  };

  // Saves first: Build and Commit work on what's on disk.
  const withSave = async (step: NonNullable<typeof gitBusy>, run: (path: string) => Promise<void>) => {
    setBusy(step);
    try {
      if (!(await onSave())) return;
      const saved = store.getState().project?.path;
      if (saved) await run(saved);
    } finally {
      setBusy(null);
    }
  };

  // An unsaved project gets a folder first (Save as), then runs there.
  const located = async () => path ?? ((await onSave()) ? (store.getState().project?.path ?? null) : null);
  const runBuild = async () => {
    const folder = await located();
    if (folder) await startBuild(folder, onSave);
  };

  const gitAction = async (
    step: NonNullable<typeof gitBusy>,
    run: () => Promise<{ details: string; message: string; ok: false } | { ok: true; status: GitStatus }>
  ) => {
    setBusy(step);
    setGitFailure(null);
    setNotice(null);
    try {
      const result = await run();
      if (result.ok) {
        setGit(result.status);
        const commit = result.status.lastCommit?.hash.slice(0, 7);
        const notices: Partial<Record<string, string>> = {
          commit: `Committed ${commit}.`,
          init: `Initialized git, first commit ${commit}.`,
          push: `Pushed ${result.status.branch} to origin.`,
          rebase: `Pulled the remote’s commits under yours and pushed ${result.status.branch}; the project was reloaded from disk.`,
          force: `Overwrote ${result.status.branch} on origin with yours.`,
          remote: 'Remote set.'
        };
        setNotice(notices[step] ?? null);
      } else setGitFailure(result);
      return result.ok;
    } finally {
      setBusy(null);
    }
  };

  if (!window.api) return <Centered text="Deployment needs the desktop app." />;
  if (!project) return null;

  const suggested = commitMessage(changes);
  const text = message ?? suggested;
  const isModule = project.type === 'module';

  return (
    <Box component="main" sx={{ flex: 1, minWidth: 0, overflowY: 'auto', bgcolor: 'background.default' }}>
      <Stack spacing={2} sx={{ maxWidth: 900, mx: 'auto', p: 3 }}>
        <Box>
          <Typography sx={{ fontSize: 20, fontWeight: 700 }}>Deployment</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.muted' }}>
            Build and check the policy set, then push it to the git repository a hub deploys from, or copy it to a hub over SSH.
          </Typography>
        </Box>

        <Step
          number={1}
          title="Build & validate"
          status={<BuildStatus run={run} />}
          actions={
            <Button variant="contained" size="small" disabled={Boolean(busy) || isModule} onClick={() => void runBuild()}>
              Build
            </Button>
          }
        >
          {isModule && <Typography sx={{ fontSize: 13, color: 'text.muted' }}>A module is built by the policy set that uses it.</Typography>}
          <FailureAlert failure={buildFailure} />
          {build && <BuildDetails build={build} blockAt={blockAt} onShowBlock={onShowBlock} onReveal={file => void window.api!.revealInProject(path!, file)} />}
        </Step>

        <Step
          number={2}
          title="Changes since the last commit"
          status={
            git?.repo ? <Chip tone={changes.length ? 'warning' : 'success'} text={changes.length ? `${changes.length} changes` : 'Nothing new'} /> : undefined
          }
        >
          {!path && <Typography sx={{ fontSize: 13, color: 'text.muted' }}>Save the project to a folder first.</Typography>}
          {git?.repo && changes.length === 0 && (
            <Typography sx={{ fontSize: 13, color: 'text.muted' }}>Same as the last commit{git.lastCommit ? `: “${git.lastCommit.subject}”` : ''}.</Typography>
          )}
          {changes.length > 0 && <ChangeList changes={changes} />}
          <Box sx={{ mt: 1 }}>
            <TestedLine />
          </Box>
        </Step>

        <Step
          number={3}
          title="Deliver"
          status={
            target === 'git' ? (
              <GitSummary git={git} />
            ) : target === 'ssh' ? (
              <SshSummary state={ssh} running={run.action === 'ssh'} />
            ) : (
              <HubSummary run={run} />
            )
          }
        >
          <Tabs
            value={target}
            onChange={(_event, value: Target) => chooseTarget(value)}
            sx={{ minHeight: 36, mb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <Tab value="git" label="Push to a git repository" sx={TAB_SX} />
            <Tab value="ssh" label="Deploy to a hub over SSH" sx={TAB_SX} />
            <Tab value="hub" label="Enterprise hub" sx={TAB_SX} />
          </Tabs>
          {target === 'git' && (
            <>
              <CommitStep
                git={git}
                path={path}
                busy={busy}
                text={text}
                canCommit={changes.length > 0 || (git?.changedFiles ?? 0) > 0}
                remote={remote ?? git?.remote ?? ''}
                onRemoteChange={setRemote}
                onTextChange={setMessage}
                onInit={() => void withSave('init', async saved => void (await gitAction('init', () => window.api!.gitInit(saved))))}
                onCommit={() =>
                  void withSave('commit', async saved => {
                    if (await gitAction('commit', () => window.api!.gitCommit(saved, text))) setMessage(null);
                  })
                }
                onSetRemote={() => void gitAction('remote', () => window.api!.gitSetRemote(path!, (remote ?? '').trim())).then(ok => ok && setRemote(null))}
                onPush={() => void gitAction('push', () => window.api!.gitPush(path!))}
                rejected={Boolean(gitFailure && /\[rejected\]|fetch first|non-fast-forward/.test(`${gitFailure.message}\n${gitFailure.details}`))}
                onSync={mode =>
                  void gitAction(mode, async () => {
                    const result = await window.api!.gitSync(path!, mode);
                    if (result.ok && result.pulled) await onReload();
                    return result;
                  })
                }
              />
              <FailureAlert failure={gitFailure} />
              {notice && !gitFailure && (
                <Alert severity="success" sx={{ mt: 1 }} onClose={() => setNotice(null)}>
                  {notice}
                </Alert>
              )}
            </>
          )}
          {target === 'ssh' && path && (
            <SshDeploy
              path={path}
              busy={Boolean(busy)}
              run={run}
              onEdit={() => resetSsh(path)}
              onDeploy={target => void startSshDeploy(path, onSave, target)}
            />
          )}
          {target === 'hub' && path && <EnterpriseHub path={path} git={git} busy={Boolean(gitBusy)} />}
        </Step>
      </Stack>
    </Box>
  );
}

function HubSummary({ run }: { run: DeployRun }) {
  if (run.action === 'hub' || run.hub.phase === 'idle') return null;
  if (run.hub.phase === 'failed' || run.hub.deployed === 'no') return <Chip tone="error" text="Hub deploy failed" />;
  if (run.hub.deployed === 'unknown') return <Chip tone="warning" text={`Hub ran (${ago(run.hub.at)}): result unknown`} />;
  return <Chip tone="success" text={`Deployed on the hub (${ago(run.hub.at)})`} />;
}

function SshSummary({ running, state }: { running: boolean; state: SshState }) {
  if (running) return null;
  if (state.phase === 'deployed') return <Chip tone="success" text={`Deployed to ${state.host} (${ago(state.at)})`} />;
  if (state.phase === 'failed') return <Chip tone="error" text="Deploy failed" />;
  if (state.phase === 'invalid') return <Chip tone="error" text="Not deployed: the checks found problems (step 1)" />;
  return null;
}

// Where the policy set goes: a hub reachable with the user's own ssh, kept per project.
function SshDeploy({
  busy,
  onDeploy,
  onEdit,
  path,
  run
}: {
  busy: boolean;
  onDeploy: (target: { host: string; key: string | null; port: number | null }) => void;
  // The hub changed: the last result no longer applies.
  onEdit: () => void;
  path: string;
  run: DeployRun;
}) {
  const state = run.ssh;
  const key = `cfpb.deploy.ssh:${path}`;
  const [host, setHost] = useState(() => localStorage.getItem(key)?.split('|')[0] ?? '');
  const [port, setPort] = useState(() => localStorage.getItem(key)?.split('|')[1] ?? '');
  // A private key file's path (never its contents); empty: whatever ssh picks (agent, ~/.ssh/config).
  const [identity, setIdentity] = useState(() => localStorage.getItem(key)?.split('|')[2] ?? '');
  const valid = /^(?:[\w.-]+@)?[\w][\w.-]*$/.test(host.trim()) && (port === '' || (Number(port) > 0 && Number(port) < 65536));
  const deploy = () => {
    localStorage.setItem(key, `${host.trim()}|${port}|${identity}`);
    onDeploy({ host: host.trim(), key: identity || null, port: port ? Number(port) : null });
  };
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField
          label="Hub"
          size="small"
          placeholder="root@hub.example.com, or an ~/.ssh/config name"
          value={host}
          onChange={event => {
            setHost(event.target.value);
            onEdit();
          }}
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
          value={identity}
          placeholder="Default: your ssh agent and ~/.ssh/config"
          sx={{ flex: 1 }}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { readOnly: true, style: { fontFamily: 'monospace', fontSize: 13 } } }}
        />
        <Button size="small" variant="outlined" disabled={busy} onClick={() => void window.api?.pickSshKey().then(picked => picked && setIdentity(picked))}>
          Choose…
        </Button>
        {identity && (
          <Button size="small" disabled={busy} onClick={() => setIdentity('')}>
            Use default
          </Button>
        )}
        <Button variant="contained" size="small" disabled={busy || !valid} onClick={deploy}>
          {state.phase === 'deploying' ? 'Deploying…' : 'Build & deploy'}
        </Button>
      </Stack>
      <Typography sx={{ fontSize: 11, color: 'text.muted' }}>
        Saves, builds and checks the policy set (step 1), copies it with your own ssh / scp (the chosen key, or your agent and ~/.ssh/config; never a prompt, so
        a key with a passphrase must be in the agent), validates it on the hub with cf-promises, then makes it /var/cfengine/masterfiles and runs the agent
        there. The login needs root or passwordless sudo. If the hub deploys from git, its next update replaces this — push to the repository instead.
      </Typography>
      {run.action === 'ssh' && <StageProgress stage={run.stage} stages={SSH_STAGES} />}
      {state.phase === 'failed' && <FailureAlert failure={state.failure} />}
      {state.phase === 'deployed' && (
        <Box
          component="pre"
          sx={{ m: 0, p: 1, fontSize: 11, maxHeight: 220, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap' }}
        >
          {state.log.split('\n').slice(-60).join('\n') || 'Deployed.'}
        </Box>
      )}
    </Stack>
  );
}

function GitSummary({ git }: { git: GitStatus | null }) {
  if (!git) return null;
  if (!git.repo) return <Chip tone="warning" text="Not a git repository" />;
  if (!git.remote) return <Chip tone="warning" text={`${git.branch ?? 'no branch'} · no remote`} />;
  if (git.behind > 0) return <Chip tone="warning" text={`${git.behind} new on the remote`} />;
  if (git.ahead > 0) return <Chip tone="warning" text={`${git.ahead} to push`} />;
  return <Chip tone="success" text={`${git.branch} · up to date with ${git.upstream ?? 'origin'}`} />;
}

function CommitStep(props: {
  busy: string | null;
  canCommit: boolean;
  git: GitStatus | null;
  onCommit: () => void;
  onInit: () => void;
  onPush: () => void;
  onRemoteChange: (value: string) => void;
  onSetRemote: () => void;
  onSync: (mode: 'force' | 'rebase') => void;
  onTextChange: (value: string) => void;
  path: string | null;
  // The last push was refused: the remote has commits this project doesn't.
  rejected: boolean;
  remote: string;
  text: string;
}) {
  const { busy, git } = props;
  if (!props.path || !git) return null;
  if (!git.repo) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography sx={{ fontSize: 13, color: 'text.muted', flex: 1 }}>This project folder isn’t a git repository yet.</Typography>
        <Button size="small" variant="outlined" disabled={Boolean(busy)} onClick={props.onInit}>
          Initialize git
        </Button>
      </Stack>
    );
  }
  return (
    <Stack spacing={1.5}>
      <TextField
        label="Commit message"
        size="small"
        multiline
        minRows={2}
        maxRows={8}
        value={props.text}
        onChange={event => props.onTextChange(event.target.value)}
        slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 } } }}
      />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button variant="contained" size="small" disabled={Boolean(busy) || !props.canCommit || !props.text.trim()} onClick={props.onCommit}>
          {busy === 'commit' ? 'Committing…' : 'Save & commit'}
        </Button>
        <Typography sx={{ fontSize: 12, color: 'text.muted' }}>
          {git.lastCommit ? `Last: “${git.lastCommit.subject}” · ${git.lastCommit.hash.slice(0, 7)}` : 'No commits yet'}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField
          label="Remote (origin)"
          size="small"
          placeholder="git@github.com:org/policy.git"
          value={props.remote}
          onChange={event => props.onRemoteChange(event.target.value)}
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 } } }}
        />
        {props.remote.trim() !== (git.remote ?? '') && (
          <Button size="small" variant="outlined" disabled={Boolean(busy) || !props.remote.trim()} onClick={props.onSetRemote}>
            {git.remote ? 'Change' : 'Set remote'}
          </Button>
        )}
        <Button size="small" variant="contained" disabled={Boolean(busy) || !git.remote || git.ahead === 0 || git.behind > 0} onClick={props.onPush}>
          {busy === 'push' ? 'Pushing…' : `Push${git.branch ? ` ${git.branch}` : ''}`}
        </Button>
      </Stack>
      {(git.behind > 0 || props.rejected) && (
        <Alert
          severity="warning"
          action={
            <Stack direction="row" spacing={1}>
              <Button color="inherit" size="small" disabled={Boolean(busy)} onClick={() => props.onSync('rebase')}>
                {busy === 'rebase' ? 'Pulling…' : 'Pull theirs, then push'}
              </Button>
              <Button color="error" size="small" disabled={Boolean(busy)} onClick={() => props.onSync('force')}>
                Overwrite the remote
              </Button>
            </Stack>
          }
        >
          The remote has {git.behind > 0 ? `${git.behind} ${git.behind === 1 ? 'commit' : 'commits'}` : 'commits'} this project doesn’t. Pull them in under
          yours (your commits are replayed on top, then pushed; the project reloads from disk), or overwrite the remote with yours (theirs are lost).
        </Alert>
      )}
      <Typography sx={{ fontSize: 11, color: 'text.muted' }}>
        Pushing uses your own git credentials (SSH agent or credential helper); the app stores none.
      </Typography>
    </Stack>
  );
}

function Chip({ text, tone }: { text: string; tone: Tone }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <StatusIcon tone={tone} />
      <Typography sx={{ fontSize: 13, color: tone === 'muted' ? 'text.muted' : `${tone}.main`, fontWeight: 600 }}>{text}</Typography>
    </Stack>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <Box component="main" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Typography sx={{ color: 'text.muted' }}>{text}</Typography>
    </Box>
  );
}
