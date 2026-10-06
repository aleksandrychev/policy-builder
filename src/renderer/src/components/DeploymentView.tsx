import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import { Alert, Box, Button, CircularProgress, Paper, Snackbar, Stack, Typography } from '@mui/material';

import type { BuildProblem, GitStatus } from '../../../preload/api';
import { type ProjectData, fromBuilderProject, toCfbsProject } from '../project/cfbsProject';
import {
  BUILD_STAGES,
  type DeployRun,
  type Failure,
  HUB_STAGES,
  SSH_STAGES,
  isValid,
  readRun,
  sshTargetOf,
  startBuild,
  startHubDeploy,
  startSshDeploy,
  useDeployRun
} from '../project/deployRuns';
import { commitMessage, projectChanges } from '../project/projectChanges';
import { useEnvironmentRuntime } from '../project/testRuns';
import { type CompiledPolicyState, contentKey } from '../project/useCompiledPolicy';
import { store, useAppSelector } from '../store';
import { selectCurrentProject } from '../store/projectSlice/selectors';
import { PreflightRow } from './deploy/Preflight';
import { RemoteSettings, SshSettings, type Target, TargetSettings } from './deploy/TargetSettings';
import { DeployTabs, statusLines } from './deploy/cards';
import { committedCheck, pushedCheck, savedCheck, testedCheck, validCheck } from './deploy/checks';
import { ConnectForm, HubOutcome, HubSettings, cannotPull, deploysProject, useHub } from './deploy/hub';
import { FailureAlert, Output, StageProgress, short } from './deploy/shared';
import { ShipDialog, type ShipPlan, type ShipStep, planShip } from './deploy/ship';

// The project as saving writes it, without test environments: what a test run deployed.
const snapshot = (): ProjectData => {
  const state = store.getState();
  return { canvas: state.canvas, derivedNodes: state.derivedNodes, edges: state.edges, files: state.files, groups: state.groups, testEnvironments: [] };
};

type GitResult = { details: string; message: string; ok: false } | { ok: true; status: GitStatus };
// What the run panel shows: the last thing that ran.
type Activity = 'build' | 'git' | 'hub' | 'ssh' | null;

function useGitStatus(path: string | null) {
  const [git, setGit] = useState<GitStatus | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const refresh = async () => {
    if (!path || !window.api) return;
    const result = await window.api.gitStatus(path);
    if (result.ok) setGit(result.status);
    else setFailure(result);
  };
  useEffect(() => {
    let current = true;
    if (path && window.api) {
      void window.api.gitStatus(path).then(result => {
        if (!current) return;
        if (result.ok) setGit(result.status);
        else setFailure(result);
      });
    }
    return () => {
      current = false;
    };
  }, [path]);
  return { git, setGit, failure, setFailure, refresh };
}

// The changes since the last commit, and the project content as saving writes it, keyed without layout (what checks compare).
function useProjectState(git: GitStatus | null) {
  const project = useAppSelector(selectCurrentProject);
  const canvas = useAppSelector(state => state.canvas);
  const edges = useAppSelector(state => state.edges);
  const groups = useAppSelector(state => state.groups);
  const files = useAppSelector(state => state.files);
  const derivedNodes = useAppSelector(state => state.derivedNodes);
  const saved = useMemo(
    () => (project ? toCfbsProject(snapshot(), project) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the slices are what the snapshot reads
    [project, canvas, edges, groups, files, derivedNodes]
  );
  const content = useMemo(() => (saved ? contentKey(saved) : ''), [saved]);
  const changes = useMemo(() => {
    let head: ProjectData | null = null;
    try {
      head = git?.headBuilder ? fromBuilderProject(git.headBuilder) : null;
    } catch {
      head = null;
    }
    // Through the same save and load as the commit went, so both sides have the same shape.
    let now = snapshot();
    try {
      if (saved) now = fromBuilderProject(JSON.parse(JSON.stringify(saved.project)));
    } catch {
      // Unsaveable state: compare as it is.
    }
    return projectChanges(head, now);
  }, [git, saved]);
  return { project, canvas, content, changes };
}

// The step running now: a build or deploy's stage, or a git action.
function Running({ gitStep, run }: { gitStep: string | null; run: DeployRun }) {
  if (run.action) return <StageProgress stage={run.stage} stages={run.action === 'hub' ? HUB_STAGES : run.action === 'ssh' ? SSH_STAGES : BUILD_STAGES} />;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <CircularProgress size={12} thickness={5} />
      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{gitStep}…</Typography>
    </Stack>
  );
}

function SshOutcome({ ssh }: { ssh: DeployRun['ssh'] }) {
  if (ssh.phase === 'failed') return <FailureAlert failure={ssh.failure} />;
  if (ssh.phase === 'invalid') return <Alert severity="error">Not deployed: the checks found problems. See Valid policy.</Alert>;
  if (ssh.phase !== 'deployed') return null;
  return (
    <Stack spacing={1}>
      <Alert severity="success">Deployed to {ssh.host}: it’s the hub’s masterfiles now, and its agent ran.</Alert>
      <Output text={ssh.log.split('\n').slice(-60).join('\n')} />
    </Stack>
  );
}

function BuildOutcome({ run }: { run: DeployRun }) {
  if (run.buildFailure) return <FailureAlert failure={run.buildFailure} />;
  if (run.build && !isValid(run)) return <Alert severity="error">The policy has problems: nothing was shipped. See Valid policy.</Alert>;
  return null;
}

// How the last thing that ran ended.
function Outcome({ activity, gitFailure, run }: { activity: Activity; gitFailure: Failure | null; run: DeployRun }) {
  if (activity === 'git') return <FailureAlert failure={gitFailure} />;
  if (activity === 'build') return <BuildOutcome run={run} />;
  if (activity === 'ssh') return <SshOutcome ssh={run.ssh} />;
  if (activity === 'hub') return <HubOutcome hub={run.hub} />;
  return null;
}

const hasOutcome = (activity: Activity, gitFailure: Failure | null, run: DeployRun) =>
  (activity === 'git' && Boolean(gitFailure)) ||
  (activity === 'build' && Boolean(run.buildFailure || (run.build && !isValid(run)))) ||
  (activity === 'ssh' && run.ssh.phase !== 'idle') ||
  (activity === 'hub' && run.hub.phase !== 'idle');

const SPIN = { animation: 'cfpb-spin 1s linear infinite', '@keyframes cfpb-spin': { to: { transform: 'rotate(360deg)' } } };

// Docked at the bottom: the running step, then how it ended.
function RunPanel(props: { activity: Activity; gitFailure: Failure | null; gitStep: string | null; onDismiss: () => void; run: DeployRun }) {
  const running = Boolean(props.run.action || props.gitStep);
  if (!running && !hasOutcome(props.activity, props.gitFailure, props.run)) return null;
  return (
    <Paper elevation={6} sx={{ position: 'sticky', bottom: 16, p: 1.5, mt: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {running ? <Running gitStep={props.gitStep} run={props.run} /> : <Outcome activity={props.activity} gitFailure={props.gitFailure} run={props.run} />}
        </Box>
        {!running && (
          <Button size="small" onClick={props.onDismiss}>
            Close
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

/**
 * The Deployment tab: pre-flight checks (saved, valid, tested, committed, pushed), then the ways
 * to deploy as tabs named with their status, each with its one action — a git repository, a hub over SSH, or an
 * Enterprise hub — with the run's progress and outcome docked at the bottom.
 */
export function DeploymentView({
  compiled,
  dirty,
  onOpenTests,
  onReload,
  onSave,
  onShowBlock
}: {
  compiled: CompiledPolicyState;
  dirty: boolean;
  onOpenTests: () => void;
  // Reads the project from disk again (after pulling the remote's commits into it).
  onReload: () => Promise<void>;
  onSave: () => Promise<boolean>;
  onShowBlock: (fileId: string, id: string) => void;
}) {
  const projectPath = useAppSelector(selectCurrentProject)?.path ?? null;
  const gitState = useGitStatus(projectPath);
  const { git, setGit } = gitState;
  const { project, canvas, content, changes } = useProjectState(git);
  const path = project?.path ?? null;
  const run = useDeployRun(path);
  const hub = useHub(path);
  const environment = useAppSelector(state => state.testEnvironments[0]);
  const testRuntime = useEnvironmentRuntime(environment?.id ?? '');
  const [open, setOpen] = useState<string | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<Target | null>(null);
  // Bumped when the SSH target is saved (it lives in localStorage), so the tab re-reads it.
  const [, setSshSaved] = useState(0);
  // The deploy tab last looked at, per project.
  const [tab, setTab] = useState<Target>(() => (localStorage.getItem(`cfpb.deploy.target:${projectPath}`) as Target | null) ?? 'git');
  const chooseTab = (value: Target) => {
    setTab(value);
    setActivity(null);
    localStorage.setItem(`cfpb.deploy.target:${projectPath}`, value);
  };
  const [plan, setPlan] = useState<ShipPlan | null>(null);
  const [gitStep, setGitStep] = useState<string | null>(null);
  const [activity, setActivity] = useState<Activity>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const isModule = project?.type === 'module';
  const busy = Boolean(run.action || gitStep);

  // Builds and commits work on what's on disk; saving an unedited project would only rewrite it.
  const saveIfEdited = useCallback(() => (dirty ? onSave() : Promise.resolve(true)), [dirty, onSave]);

  // Pre-flight on open: the build is rerun when the saved project changed since the last one.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !path || dirty || isModule) return;
    opened.current = true;
    const last = readRun(path);
    if (!last.action && (!last.build || last.builtFrom !== content)) void startBuild(path, saveIfEdited, content);
  }, [path, dirty, isModule, content, saveIfEdited]);

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

  const gitAction = async (label: string, action: () => Promise<GitResult>, done?: (status: GitStatus) => string): Promise<boolean> => {
    setGitStep(label);
    setActivity('git');
    gitState.setFailure(null);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        gitState.setFailure(result);
        setRejected(/\[rejected\]|fetch first|non-fast-forward/.test(`${result.message}\n${result.details}`));
        return false;
      }
      setGit(result.status);
      setRejected(false);
      if (done) setNotice(done(result.status));
      return true;
    } finally {
      setGitStep(null);
    }
  };

  const initGit = () =>
    gitAction(
      'Initializing git',
      () => window.api!.gitInit(path!),
      status => `Initialized git: first commit ${short(status.lastCommit?.hash)}.`
    );

  const preflight = async () => {
    if (!path) return void (await onSave());
    setActivity('build');
    setNotice(null);
    void gitState.refresh();
    void hub.refresh();
    await startBuild(path, saveIfEdited, content);
    if (isValid(readRun(path))) setNotice('Pre-flight: the policy builds and checks out.');
  };

  // One step of shipping; false stops the rest.
  const shipStep = async (step: ShipStep, folder: string, message: string): Promise<boolean> => {
    if (step === 'check') {
      setActivity('build');
      await startBuild(folder, saveIfEdited, content);
      return isValid(readRun(folder));
    }
    if (step === 'commit') return (await saveIfEdited()) && gitAction('Committing', () => window.api!.gitCommit(folder, message));
    if (step === 'push')
      return gitAction(
        'Pushing',
        () => window.api!.gitPush(folder),
        status => `Pushed ${short(status.lastCommit?.hash)} to ${status.upstream ?? 'origin'}.`
      );
    if (step === 'hub' && hub.hub) {
      setActivity('hub');
      await startHubDeploy(folder, hub.hub.url, hub.setState);
    }
    if (step === 'ssh') {
      setActivity('ssh');
      await startSshDeploy(folder, saveIfEdited, sshTargetOf(folder)!, content);
    }
    return true;
  };

  const ship = async (message: string) => {
    const steps = plan?.steps ?? [];
    setPlan(null);
    if (!path) return;
    for (const step of steps) if (!(await shipStep(step, path, message))) return;
  };

  if (!window.api) return <Centered text="Deployment needs the desktop app." />;
  if (!project) return null;

  const checks = [
    savedCheck(dirty),
    validCheck({ blockAt, content, isModule, run, onShowBlock, onReveal: file => void window.api!.revealInProject(path!, file) }),
    testedCheck({ content, onOpenTests, run: testRuntime.lastRun }),
    committedCheck({
      changes,
      git,
      onInit: () => void initGit()
    }),
    pushedCheck({
      busy,
      git,
      rejected,
      onSettings: () => setSettingsTarget('git'),
      onSync: mode =>
        void gitAction(
          mode === 'rebase' ? 'Pulling the remote’s commits' : 'Overwriting the remote',
          async () => {
            // Pulling reloads the project from disk: unsaved edits are saved first.
            if (mode === 'rebase' && !(await saveIfEdited())) return { ok: false, message: 'Not pulled: the project isn’t saved.', details: '' };
            const result = await window.api!.gitSync(path!, mode);
            if (result.ok && result.pulled) await onReload();
            return result;
          },
          status =>
            mode === 'rebase'
              ? `Pulled the remote’s commits under yours and pushed ${status.branch}; the project was reloaded.`
              : `Overwrote ${status.branch} on origin.`
        )
    })
  ];

  const TARGETS: Target[] = ['git', 'ssh', 'hub'];
  const unsaved: ShipPlan = {
    label: 'Save the project first',
    steps: [],
    warnings: [],
    blocked: { reason: 'Deployment works on a saved project folder.', action: { label: 'Save…', run: () => void onSave() } }
  };
  // A way that isn't set up yet shows its setup form in its tab.
  const setupFor = (target: Target) => {
    if (!path) return undefined;
    if (target === 'ssh') return sshTargetOf(path) ? undefined : <SshSettings path={path} onSaved={() => setSshSaved(count => count + 1)} />;
    if (target === 'hub') {
      if (hub.loaded && !hub.hub) return <ConnectForm onConnected={hub.connected} />;
      return hub.state && (!deploysProject(hub.state, git) || cannotPull(hub.state)) ? <HubSettings busy={busy} git={git} hub={hub} /> : undefined;
    }
    if (git && !git.repo) {
      return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography sx={{ fontSize: 13, flex: 1 }}>This project folder isn’t a git repository yet.</Typography>
          <Button variant="contained" size="small" disabled={busy} onClick={() => void initGit()}>
            Initialize git
          </Button>
        </Stack>
      );
    }
    return git?.repo && !git.remote ? <RemoteSettings path={path} git={git} onSaved={setGit} /> : undefined;
  };
  const planFor = (target: Target) =>
    path ? planShip({ checks, content, git, hub, isModule, path, run, target, onSettings: () => setSettingsTarget(target) }) : unsaved;

  return (
    <Box component="main" sx={{ flex: 1, minWidth: 0, overflowY: 'auto', bgcolor: 'background.default' }}>
      <Stack spacing={2} sx={{ maxWidth: 1000, mx: 'auto', p: 3 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Typography sx={{ fontSize: 20, fontWeight: 700, flex: 1 }}>Deployment</Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon sx={run.action === 'build' ? SPIN : undefined} />}
            disabled={busy || isModule}
            onClick={() => void preflight()}
          >
            Run pre-flight
          </Button>
        </Stack>

        <PreflightRow checks={checks} open={open} onOpen={setOpen} />

        <Typography sx={{ fontSize: 16, fontWeight: 700, pt: 1 }}>Deploy to</Typography>
        <DeployTabs
          tab={tab}
          busy={busy}
          ways={TARGETS.map(target => ({
            target,
            plan: planFor(target),
            lines: path ? statusLines({ changes: changes.length, git, hub, path, run, target }) : [{ tone: 'muted' as const, text: 'Not saved yet' }],
            setup: setupFor(target)
          }))}
          onTab={chooseTab}
          onSettings={target => (path ? setSettingsTarget(target) : void onSave())}
          onShip={target => setPlan(planFor(target))}
        />

        <RunPanel activity={activity} run={run} gitStep={gitStep} gitFailure={gitState.failure} onDismiss={() => setActivity(null)} />
      </Stack>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ top: { xs: 72, sm: 72 } }}
      >
        <Alert severity="success" variant="filled" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      </Snackbar>

      {plan && (
        <ShipDialog
          plan={plan}
          suggested={commitMessage(changes) || (git?.changedPaths.length ? `Updated ${git.changedPaths.join(', ')}` : '')}
          onCancel={() => setPlan(null)}
          onShip={message => void ship(message)}
        />
      )}
      {settingsTarget && path && (
        <TargetSettings
          target={settingsTarget}
          path={path}
          git={git}
          hub={hub}
          busy={busy}
          onGitStatus={setGit}
          onClose={() => {
            setSettingsTarget(null);
            void hub.refresh();
          }}
        />
      )}
    </Box>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <Box component="main" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Typography sx={{ color: 'text.muted' }}>{text}</Typography>
    </Box>
  );
}
