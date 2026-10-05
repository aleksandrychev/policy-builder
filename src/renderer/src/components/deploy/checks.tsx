import { Box, Button, Stack, Typography } from '@mui/material';

import type { BuildResult, GitStatus } from '../../../../preload/api';
import { BUILD_STAGES, type DeployRun, isValid } from '../../project/deployRuns';
import type { ProjectChange } from '../../project/projectChanges';
import type { Check } from './Preflight';
import { type BlockAt, ChangeList, FailureAlert, Line, ProblemList, ago, short } from './shared';

type LastRun = { at: number; content: string; hosts: number; passed: boolean | null } | null;

export const savedCheck = (dirty: boolean): Check =>
  dirty
    ? { id: 'saved', label: 'Saved', tone: 'warning', status: 'Unsaved edits (pre-flight saves)' }
    : { id: 'saved', label: 'Saved', tone: 'success', status: 'All saved' };

// The last Deploy & run on test hosts, and whether it ran these edits.
export function testedCheck({ content, onOpenTests, run }: { content: string; onOpenTests: () => void; run: LastRun }): Check {
  const base = { id: 'tested', label: 'Tested' };
  const open = (
    <Button size="small" variant="outlined" onClick={onOpenTests}>
      Open Test Results &amp; Logs
    </Button>
  );
  if (!run) return { ...base, tone: 'warning', status: 'Not run yet', detail: open };
  if (run.passed === null) return { ...base, tone: 'muted', running: true, status: 'Deploy & run is running' };
  const hosts = `${run.hosts} ${run.hosts === 1 ? 'host' : 'hosts'}`;
  if (run.content !== content) return { ...base, tone: 'warning', status: `Edited since (${ago(run.at)})`, detail: open };
  return run.passed
    ? { ...base, tone: 'success', status: `Passed on ${hosts} (${ago(run.at)})`, detail: open }
    : { ...base, tone: 'error', status: `Problems on ${hosts} (${ago(run.at)})`, detail: open };
}

// "valid (local CFEngine)", "skipped: no CFEngine or Docker".
const promisesText = (promises: BuildResult['promises']) =>
  promises.ok === null
    ? `skipped. ${promises.message ?? ''}`
    : promises.ok
      ? `valid (${promises.how === 'docker' ? 'in a test-host image' : 'local CFEngine'})`
      : `${promises.problems.length || 'some'} errors`;

export function validCheck({
  blockAt,
  content,
  isModule,
  onReveal,
  onShowBlock,
  run
}: {
  blockAt: BlockAt;
  content: string;
  isModule: boolean;
  onReveal: (file: string) => void;
  onShowBlock: (fileId: string, id: string) => void;
  run: DeployRun;
}): Check {
  const base = { id: 'valid', label: 'Valid policy' };
  if (isModule) return { ...base, tone: 'muted', status: 'Built by the policy set that uses it' };
  const building = run.action === 'build' || (run.action === 'ssh' && BUILD_STAGES.some(stage => stage.id === run.stage));
  if (building) return { ...base, tone: 'muted', running: true, status: BUILD_STAGES.find(stage => stage.id === run.stage)?.label ?? 'Checking…' };
  if (run.buildFailure) return { ...base, tone: 'error', status: 'Build failed', detail: <FailureAlert failure={run.buildFailure} /> };
  const { build } = run;
  if (!build) return { ...base, tone: 'muted', status: 'Not checked yet' };
  const stale = run.builtFrom !== content;
  const problems = [...build.lint.problems, ...build.promises.problems];
  const detail = (
    <Stack spacing={0.75}>
      {stale && <Line tone="warning">The project changed since this check: Run pre-flight to check it again.</Line>}
      <Line tone={build.lint.ok ? 'success' : 'error'}>Linter: {build.lint.ok ? 'no problems' : `${build.lint.problems.length} problems`}</Line>
      <Line tone={build.promises.ok === null ? 'warning' : build.promises.ok ? 'success' : 'error'}>cf-promises: {promisesText(build.promises)}</Line>
      {problems.length > 0 && <ProblemList problems={problems} blockAt={blockAt} onShowBlock={onShowBlock} />}
      {build.tarball && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography sx={{ fontSize: 12, fontFamily: 'monospace', color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {build.tarball}
          </Typography>
          <Button size="small" onClick={() => onReveal(build.tarball!)}>
            Reveal
          </Button>
        </Stack>
      )}
    </Stack>
  );
  if (!isValid(run)) return { ...base, tone: 'error', status: `${problems.length || 'Some'} problems`, detail };
  if (stale) return { ...base, tone: 'warning', status: 'Out of date', detail };
  return {
    ...base,
    tone: build.promises.ok === null ? 'warning' : 'success',
    status: build.promises.ok === null ? 'Builds (cf-promises skipped)' : 'Checks out',
    detail
  };
}

export function committedCheck({ changes, git, onInit }: { changes: ProjectChange[]; git: GitStatus | null; onInit: () => void }): Check {
  const base = { id: 'committed', label: 'Committed' };
  if (!git) return { ...base, tone: 'muted', status: '…' };
  if (!git.repo) {
    return {
      ...base,
      tone: 'warning',
      status: 'No git repository',
      detail: (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography sx={{ fontSize: 13, flex: 1 }}>This project folder isn’t a git repository yet.</Typography>
          <Button size="small" variant="outlined" onClick={onInit}>
            Initialize git
          </Button>
        </Stack>
      )
    };
  }
  const pending = changes.length || git.changedFiles;
  if (!pending) return { ...base, tone: 'success', status: git.lastCommit ? `${short(git.lastCommit.hash)} · ${git.lastCommit.subject}` : 'Nothing to commit' };
  return {
    ...base,
    tone: 'warning',
    status: changes.length
      ? `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} not committed`
      : `${git.changedFiles} ${git.changedFiles === 1 ? 'file' : 'files'} not committed`,
    detail: (
      <Stack spacing={1}>
        {changes.length > 0 && <ChangeList changes={changes} />}
        {git.changedPaths.length > 0 && (
          <Typography component="div" sx={{ fontSize: 12, color: 'text.secondary' }}>
            Changed files:{' '}
            <Box component="span" sx={{ fontFamily: 'monospace' }}>
              {git.changedPaths.join(', ')}
            </Box>
          </Typography>
        )}
      </Stack>
    )
  };
}

export function pushedCheck({
  busy,
  git,
  onSettings,
  onSync,
  rejected
}: {
  busy: boolean;
  git: GitStatus | null;
  onSettings: () => void;
  onSync: (mode: 'force' | 'rebase') => void;
  rejected: boolean;
}): Check {
  const base = { id: 'pushed', label: 'Pushed' };
  if (!git?.repo) return { ...base, tone: 'muted', status: 'No repository' };
  if (!git.remote) {
    return {
      ...base,
      tone: 'warning',
      status: 'No remote',
      detail: (
        <Button size="small" variant="outlined" onClick={onSettings}>
          Set the remote…
        </Button>
      )
    };
  }
  if (git.behind > 0 || rejected) {
    return {
      ...base,
      tone: 'warning',
      status: git.behind > 0 ? `${git.behind} new on the remote` : 'The remote has commits you don’t',
      detail: (
        <Stack spacing={1}>
          <Typography sx={{ fontSize: 13 }}>
            Pull them in under yours (your commits are replayed on top, pushed, and the project reloads from disk), or overwrite the remote with yours (theirs
            are lost).
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" disabled={busy} onClick={() => onSync('rebase')}>
              Pull theirs, then push
            </Button>
            <Button size="small" color="error" disabled={busy} onClick={() => onSync('force')}>
              Overwrite the remote
            </Button>
          </Stack>
        </Stack>
      )
    };
  }
  if (git.ahead > 0) return { ...base, tone: 'warning', status: `${git.ahead} ${git.ahead === 1 ? 'commit' : 'commits'} to push` };
  return { ...base, tone: 'success', status: `In sync (${git.upstream ?? 'origin'})` };
}
