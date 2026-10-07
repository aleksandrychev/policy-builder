import type { BuildProblem, BuildResult, GitStatus } from '../../../../preload/api';
import type { DeployRun } from '../../project/deployRuns';
import { committedCheck, pushedCheck, savedCheck, testedCheck, validCheck } from './checks';

const CONTENT = '{"v":1}';
const problem: BuildProblem = { file: 'main.cf', line: 3, message: 'syntax error' };

const gitStatus = (parts: Partial<GitStatus> = {}): GitStatus => ({
  ahead: 0,
  behind: 0,
  branch: 'main',
  changedFiles: 0,
  changedPaths: [],
  headBuilder: null,
  lastCommit: null,
  remote: 'git@github.com:acme/policy.git',
  repo: true,
  upstream: 'origin/main',
  ...parts
});

const build = (parts: Partial<BuildResult> = {}): BuildResult => ({
  lint: { ok: true, problems: [] },
  log: [],
  masterfiles: '/tmp/out/masterfiles',
  promises: { how: 'local', ok: true, problems: [] },
  tarball: null,
  ...parts
});

const deployRun = (parts: Partial<DeployRun> = {}): DeployRun => ({
  action: null,
  build: build(),
  buildFailure: null,
  builtFrom: CONTENT,
  hub: { phase: 'idle' },
  outcome: null,
  ssh: { phase: 'idle' },
  stage: null,
  ...parts
});

describe('savedCheck', () => {
  it('warns about unsaved edits', () => {
    expect(savedCheck(true)).toMatchObject({ tone: 'warning', status: 'Unsaved edits (pre-flight saves)' });
    expect(savedCheck(false)).toMatchObject({ tone: 'success', status: 'All saved' });
  });
});

describe('testedCheck', () => {
  const tested = (run: Parameters<typeof testedCheck>[0]['run'], content = CONTENT) => testedCheck({ content, onOpenTests: () => {}, run });
  const now = Date.now();

  it('warns when never run', () => {
    expect(tested(null)).toMatchObject({ tone: 'warning', status: 'Not run yet' });
  });

  it('is running while the result is pending', () => {
    expect(tested({ at: now, content: CONTENT, hosts: 1, passed: null })).toMatchObject({ tone: 'muted', running: true });
  });

  it('warns when edited since', () => {
    expect(tested({ at: now, content: 'older', hosts: 1, passed: true })).toMatchObject({ tone: 'warning', status: 'Edited since (just now)' });
  });

  it('reports passes and problems per host count', () => {
    expect(tested({ at: now, content: CONTENT, hosts: 1, passed: true })).toMatchObject({ tone: 'success', status: 'Passed on 1 host (just now)' });
    expect(tested({ at: now, content: CONTENT, hosts: 2, passed: false })).toMatchObject({ tone: 'error', status: 'Problems on 2 hosts (just now)' });
  });
});

describe('validCheck', () => {
  const valid = (run: DeployRun, isModule = false) =>
    validCheck({ blockAt: () => null, content: CONTENT, isModule, onReveal: () => {}, onShowBlock: () => {}, run });

  it('leaves a module to the policy set using it', () => {
    expect(valid(deployRun(), true)).toMatchObject({ tone: 'muted', status: 'Built by the policy set that uses it' });
  });

  it('shows the stage while building', () => {
    expect(valid(deployRun({ action: 'build', stage: 'lint' }))).toMatchObject({ tone: 'muted', running: true, status: 'Checking with the linter' });
    expect(valid(deployRun({ action: 'build', stage: null })).status).toBe('Checking…');
  });

  it('counts an SSH deploy as building only during the build stages', () => {
    expect(valid(deployRun({ action: 'ssh', stage: 'promises' })).running).toBe(true);
    expect(valid(deployRun({ action: 'ssh', stage: 'deploy' })).running).toBeUndefined();
  });

  it('reports a failed build', () => {
    expect(valid(deployRun({ build: null, buildFailure: { message: 'cfbs failed', details: '' } }))).toMatchObject({ tone: 'error', status: 'Build failed' });
  });

  it('is unchecked without a build', () => {
    expect(valid(deployRun({ build: null }))).toMatchObject({ tone: 'muted', status: 'Not checked yet' });
  });

  it('counts the linter and cf-promises problems', () => {
    const run = deployRun({ build: build({ lint: { ok: false, problems: [problem] }, promises: { how: 'local', ok: false, problems: [problem, problem] } }) });
    expect(valid(run)).toMatchObject({ tone: 'error', status: '3 problems' });
  });

  it('says "Some problems" when a failed check listed none', () => {
    expect(valid(deployRun({ build: build({ lint: { ok: false, problems: [] } }) })).status).toBe('Some problems');
  });

  it('flags an out-of-date build, unless it is invalid', () => {
    expect(valid(deployRun({ builtFrom: 'older' }))).toMatchObject({ tone: 'warning', status: 'Out of date' });
    expect(valid(deployRun({ builtFrom: 'older', build: build({ lint: { ok: false, problems: [problem] } }) })).tone).toBe('error');
  });

  it('warns when cf-promises was skipped', () => {
    const skipped = build({ promises: { how: 'skipped', ok: null, message: 'No CFEngine', problems: [] } });
    expect(valid(deployRun({ build: skipped }))).toMatchObject({ tone: 'warning', status: 'Builds (cf-promises skipped)' });
  });

  it('checks out a valid current build', () => {
    expect(valid(deployRun())).toMatchObject({ tone: 'success', status: 'Checks out' });
  });
});

describe('committedCheck', () => {
  const committed = (git: GitStatus | null, changes = 0) =>
    committedCheck({ changes: Array.from({ length: changes }, () => ({ kind: 'added' as const, what: 'x' })), git, onInit: () => {} });

  it('waits for git', () => {
    expect(committed(null)).toMatchObject({ tone: 'muted', status: '…' });
  });

  it('offers to initialize a missing repository', () => {
    expect(committed(gitStatus({ repo: false }))).toMatchObject({ tone: 'warning', status: 'No git repository' });
  });

  it('shows the last commit when clean', () => {
    const lastCommit = { date: '', hash: '0123456789abcdef', subject: 'Added nginx' };
    expect(committed(gitStatus({ lastCommit }))).toMatchObject({ tone: 'success', status: '0123456 · Added nginx' });
    expect(committed(gitStatus()).status).toBe('Nothing to commit');
  });

  it('counts builder changes before changed files', () => {
    expect(committed(gitStatus({ changedFiles: 4 }), 1)).toMatchObject({ tone: 'warning', status: '1 change not committed' });
    expect(committed(gitStatus(), 2).status).toBe('2 changes not committed');
    expect(committed(gitStatus({ changedFiles: 1 })).status).toBe('1 file not committed');
    expect(committed(gitStatus({ changedFiles: 3 })).status).toBe('3 files not committed');
  });
});

describe('pushedCheck', () => {
  const pushed = (git: GitStatus | null, rejected = false) => pushedCheck({ busy: false, git, onSettings: () => {}, onSync: () => {}, rejected });

  it('needs a repository and a remote', () => {
    expect(pushed(null)).toMatchObject({ tone: 'muted', status: 'No repository' });
    expect(pushed(gitStatus({ repo: false })).status).toBe('No repository');
    expect(pushed(gitStatus({ remote: null }))).toMatchObject({ tone: 'warning', status: 'No remote' });
  });

  it('warns about remote commits, or a rejected push', () => {
    expect(pushed(gitStatus({ behind: 2 }))).toMatchObject({ tone: 'warning', status: '2 new on the remote' });
    expect(pushed(gitStatus(), true)).toMatchObject({ tone: 'warning', status: 'The remote has commits you don’t' });
  });

  it('counts commits to push', () => {
    expect(pushed(gitStatus({ ahead: 1 }))).toMatchObject({ tone: 'warning', status: '1 commit to push' });
    expect(pushed(gitStatus({ ahead: 3 })).status).toBe('3 commits to push');
  });

  it('is in sync with the upstream', () => {
    expect(pushed(gitStatus())).toMatchObject({ tone: 'success', status: 'In sync (origin/main)' });
    expect(pushed(gitStatus({ upstream: null })).status).toBe('In sync (origin)');
  });
});
