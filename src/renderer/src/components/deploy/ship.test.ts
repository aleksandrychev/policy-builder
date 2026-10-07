import type { BuildResult, GitStatus, HubState } from '../../../../preload/api';
import { type DeployRun, saveSshTarget } from '../../project/deployRuns';
import type { Check } from './Preflight';
import type { Target } from './TargetSettings';
import type { HubHandle } from './hub';
import { planShip } from './ship';

const PATH = '/projects/demo';
const CONTENT = '{"v":1}';
const REMOTE = 'git@github.com:acme/policy.git';

const gitStatus = (parts: Partial<GitStatus> = {}): GitStatus => ({
  ahead: 0,
  behind: 0,
  branch: 'main',
  changedFiles: 0,
  changedPaths: [],
  headBuilder: null,
  lastCommit: null,
  remote: REMOTE,
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

const hubState = (vcs: Partial<NonNullable<HubState['vcs']>> = {}): HubState => ({
  deploysEnabled: true,
  hosts: 3,
  info: { hostkey: 'SHA=abc', hostname: 'hub', license: 'x', version: '3.24.0' },
  releaseId: null,
  vcs: { hasKey: true, refspec: 'main', subdirectory: '', type: 'GIT_CFBS', url: REMOTE, username: '', ...vcs }
});

const hubHandle = (parts: Partial<HubHandle> = {}): HubHandle => ({
  hub: { url: 'https://hub', username: 'admin' },
  state: hubState(),
  failure: null,
  loaded: true,
  setState: () => {},
  connected: () => {},
  forget: async () => {},
  other: () => {},
  refresh: async () => {},
  ...parts
});

const check = (id: string, tone: Check['tone'], status = '', running = false): Check => ({ id, label: id, status, tone, running });
const passing = [check('tested', 'success'), check('committed', 'success')];
const uncommitted = [check('tested', 'success'), check('committed', 'warning')];

const onSettings = () => {};
const plan = (target: Target, parts: Partial<Parameters<typeof planShip>[0]> = {}) =>
  planShip({
    checks: passing,
    content: CONTENT,
    git: gitStatus(),
    hub: hubHandle(),
    isModule: false,
    onSettings,
    path: PATH,
    run: deployRun(),
    target,
    ...parts
  });

afterEach(() => localStorage.clear());

describe('planShip', () => {
  it('never ships a module', () => {
    expect(plan('git', { isModule: true }).blocked?.reason).toMatch(/module ships with the policy set/);
  });

  it('blocks an invalid build of the current content', () => {
    const result = plan('git', { run: deployRun({ build: build({ lint: { ok: false, problems: [] } }) }), checks: uncommitted });
    expect(result.steps).toEqual([]);
    expect(result.blocked?.reason).toMatch(/has problems/);
  });

  it('blocks a failed build, even of older content', () => {
    const failed = deployRun({ build: null, buildFailure: { message: 'boom', details: '' }, builtFrom: 'older' });
    expect(plan('git', { run: failed, checks: uncommitted }).blocked?.reason).toMatch(/has problems/);
  });

  it('checks first when the build is stale or missing', () => {
    expect(plan('git', { run: deployRun({ builtFrom: 'older' }), checks: uncommitted }).steps).toEqual(['check', 'commit', 'push']);
    expect(plan('git', { run: deployRun({ build: null, builtFrom: null }), checks: uncommitted }).steps).toEqual(['check', 'commit', 'push']);
  });

  it('checks a stale invalid build again instead of blocking', () => {
    const stale = deployRun({ build: build({ lint: { ok: false, problems: [] } }), builtFrom: 'older' });
    expect(plan('git', { run: stale, checks: uncommitted }).steps).toEqual(['check', 'commit', 'push']);
  });

  describe('git', () => {
    it('commits and pushes uncommitted changes', () => {
      expect(plan('git', { checks: uncommitted })).toEqual({ label: 'Commit & push', steps: ['commit', 'push'], warnings: [] });
    });

    it('only pushes when ahead', () => {
      expect(plan('git', { git: gitStatus({ ahead: 2 }) })).toMatchObject({ label: 'Push', steps: ['push'] });
    });

    it('is up to date with nothing to commit or push', () => {
      const result = plan('git');
      expect(result.label).toBe('Up to date');
      expect(result.blocked?.reason).toBe('Nothing to commit or push.');
    });

    it('needs a git repository', () => {
      expect(plan('git', { git: gitStatus({ repo: false }) }).blocked?.reason).toMatch(/isn’t a git repository/);
      expect(plan('git', { git: null }).blocked?.reason).toMatch(/isn’t a git repository/);
    });

    it('offers to set a missing remote', () => {
      const result = plan('git', { git: gitStatus({ remote: null }) });
      expect(result.blocked?.reason).toMatch(/Set the git remote/);
      expect(result.blocked?.action).toEqual({ label: 'Set the remote…', run: onSettings });
      expect(result.label).toBe('Set the remote…');
    });

    it('stops when the remote is ahead', () => {
      expect(plan('git', { git: gitStatus({ behind: 1 }), checks: uncommitted }).blocked?.reason).toMatch(/remote has commits you don’t/);
    });
  });

  describe('ssh', () => {
    it('asks for the hub when none is saved', () => {
      const result = plan('ssh');
      expect(result.blocked?.reason).toMatch(/Choose the hub/);
      expect(result.blocked?.action?.label).toBe('Set the hub…');
    });

    it('deploys to the saved hub, whatever git says', () => {
      saveSshTarget(PATH, { host: 'hub.example', key: null, port: null });
      expect(plan('ssh', { git: null, run: deployRun({ build: null }) })).toEqual({ label: 'Deploy to hub.example', steps: ['ssh'], warnings: [] });
    });
  });

  describe('hub', () => {
    it('asks to connect a hub', () => {
      const result = plan('hub', { hub: hubHandle({ hub: null, state: null }) });
      expect(result.blocked?.reason).toBe('Connect to the Enterprise hub.');
      expect(result.blocked?.action?.label).toBe('Connect a hub…');
    });

    it('waits while connecting, and says when unreachable', () => {
      expect(plan('hub', { hub: hubHandle({ state: null }) }).blocked).toEqual({ reason: 'Connecting to the hub…', action: undefined });
      const failure = { message: 'refused', details: '' };
      expect(plan('hub', { hub: hubHandle({ state: null, failure }) }).blocked?.reason).toBe('Can’t reach the hub.');
    });

    it('offers to point a hub deploying another source at the project', () => {
      const result = plan('hub', { hub: hubHandle({ state: hubState({ url: 'https://github.com/acme/other' }) }) });
      expect(result.blocked?.reason).toBe('The hub deploys another source.');
      expect(result.blocked?.action?.label).toBe('Point the hub at this project…');
    });

    it('stops on an SSH URL the hub has no key for', () => {
      const result = plan('hub', { hub: hubHandle({ state: hubState({ hasKey: false }) }) });
      expect(result.blocked?.reason).toMatch(/can’t pull an SSH URL/);
      expect(result.blocked?.action?.label).toBe('Fix the hub’s source…');
    });

    it('reports the hub setup before git problems', () => {
      expect(plan('hub', { git: gitStatus({ repo: false }), hub: hubHandle({ hub: null }) }).blocked?.reason).toBe('Connect to the Enterprise hub.');
    });

    it('still needs git to be in order', () => {
      expect(plan('hub', { git: gitStatus({ behind: 3 }) }).blocked?.reason).toMatch(/remote has commits/);
    });

    it('names what it does', () => {
      expect(plan('hub', { checks: uncommitted })).toMatchObject({ label: 'Commit, push & deploy to hub', steps: ['commit', 'push', 'hub'] });
      expect(plan('hub', { git: gitStatus({ ahead: 1 }) })).toMatchObject({ label: 'Push & deploy to hub', steps: ['push', 'hub'] });
      expect(plan('hub')).toEqual({ label: 'Deploy to hub', steps: ['hub'], warnings: [] });
    });

    it('checks a stale build first', () => {
      expect(plan('hub', { run: deployRun({ builtFrom: 'older' }) }).steps).toEqual(['check', 'hub']);
    });
  });

  describe('warnings', () => {
    it('warns about an untested policy', () => {
      expect(plan('git', { checks: [check('tested', 'warning', 'Not run yet'), check('committed', 'warning')] }).warnings).toEqual(['Tested: Not run yet.']);
      expect(plan('git', { checks: [check('tested', 'error', 'Problems on 2 hosts')] }).warnings).toEqual(['Tested: Problems on 2 hosts.']);
    });

    it('does not warn while tests run, or when they passed', () => {
      expect(plan('git', { checks: [check('tested', 'muted', 'running', true)] }).warnings).toEqual([]);
      expect(plan('git', { checks: passing }).warnings).toEqual([]);
      expect(plan('git', { checks: [] }).warnings).toEqual([]);
    });

    it('carries the warnings into blocked plans', () => {
      expect(plan('git', { isModule: true, checks: [check('tested', 'warning', 'Not run yet')] }).warnings).toEqual(['Tested: Not run yet.']);
    });
  });
});
