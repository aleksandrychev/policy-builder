import type { GitStatus, HubState } from '../../../../preload/api';
import { type DeployRun, saveSshTarget } from '../../project/deployRuns';
import type { Target } from './TargetSettings';
import { statusLines } from './cards';
import type { HubHandle } from './hub';

const PATH = '/projects/demo';
const REMOTE = 'https://github.com/acme/policy';
const HEAD = '0123456789abcdef';

const gitStatus = (parts: Partial<GitStatus> = {}): GitStatus => ({
  ahead: 0,
  behind: 0,
  branch: 'main',
  changedFiles: 0,
  changedPaths: [],
  headBuilder: null,
  lastCommit: { date: '', hash: HEAD, subject: 'Added nginx' },
  remote: REMOTE,
  repo: true,
  upstream: 'origin/main',
  ...parts
});

const deployRun = (ssh: DeployRun['ssh'] = { phase: 'idle' }): DeployRun => ({
  action: null,
  build: null,
  buildFailure: null,
  builtFrom: null,
  hub: { phase: 'idle' },
  outcome: null,
  ssh,
  stage: null
});

const hubState = (parts: Partial<HubState> = {}, vcs: Partial<NonNullable<HubState['vcs']>> = {}): HubState => ({
  deploysEnabled: true,
  hosts: 1,
  info: { hostkey: 'SHA=abc', hostname: 'hub', license: 'x', version: '3.24.0' },
  releaseId: null,
  vcs: { hasKey: false, refspec: 'main', subdirectory: '', type: 'GIT_CFBS', url: REMOTE, username: '', ...vcs },
  ...parts
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

const lines = (target: Target, parts: Partial<Parameters<typeof statusLines>[0]> = {}) =>
  statusLines({ changes: 0, git: gitStatus(), hub: hubHandle(), path: PATH, run: deployRun(), target, ...parts });

afterEach(() => localStorage.clear());

describe('statusLines', () => {
  describe('git', () => {
    it('stops at the first missing piece', () => {
      expect(lines('git', { git: null })).toEqual([{ tone: 'muted', text: 'Reading git…' }]);
      expect(lines('git', { git: gitStatus({ repo: false }) })).toEqual([{ tone: 'warning', text: 'Not a git repository' }]);
      expect(lines('git', { git: gitStatus({ remote: null }) })).toEqual([{ tone: 'warning', text: 'No remote set' }]);
    });

    it('shows the remote, sync and pending changes', () => {
      expect(lines('git')).toEqual([
        { tone: 'muted', text: `${REMOTE} · main` },
        { tone: 'success', text: 'In sync with origin/main' },
        { tone: 'success', text: 'Nothing to commit' }
      ]);
    });

    it('puts commits on the remote before commits to push', () => {
      expect(lines('git', { git: gitStatus({ behind: 2, ahead: 1 }) })[1]).toEqual({ tone: 'warning', text: '2 new on the remote' });
      expect(lines('git', { git: gitStatus({ ahead: 1 }) })[1].text).toBe('1 commit to push');
      expect(lines('git', { git: gitStatus({ ahead: 2 }) })[1].text).toBe('2 commits to push');
    });

    it('counts builder changes, else changed files', () => {
      expect(lines('git', { changes: 1, git: gitStatus({ changedFiles: 5 }) })[2]).toEqual({ tone: 'warning', text: '1 change to commit' });
      expect(lines('git', { git: gitStatus({ changedFiles: 5 }) })[2].text).toBe('5 changes to commit');
    });
  });

  describe('ssh', () => {
    it('warns when no hub is set', () => {
      expect(lines('ssh')).toEqual([{ tone: 'warning', text: 'No hub set' }]);
    });

    it('shows the target and the last deploy', () => {
      saveSshTarget(PATH, { host: 'hub.example', port: 2222, key: '/keys/id' });
      expect(lines('ssh')).toEqual([
        { tone: 'muted', text: 'hub.example:2222 · own key' },
        { tone: 'muted', text: 'Not deployed from here yet' }
      ]);
      const deployed = deployRun({ phase: 'deployed', at: Date.now(), host: 'hub.example', log: '' });
      expect(lines('ssh', { run: deployed })[1]).toEqual({ tone: 'success', text: 'Deployed just now' });
      expect(lines('ssh', { run: deployRun({ phase: 'failed', failure: { message: 'x', details: '' } }) })[1]).toEqual({
        tone: 'error',
        text: 'Last deploy failed'
      });
      expect(lines('ssh', { run: deployRun({ phase: 'invalid' }) })[1]).toEqual({ tone: 'error', text: 'Not deployed: the checks failed' });
    });

    it('leaves out a default port and key', () => {
      saveSshTarget(PATH, { host: 'hub.example', port: null, key: null });
      expect(lines('ssh')[0].text).toBe('hub.example');
    });
  });

  describe('hub', () => {
    const name = { tone: 'muted', text: 'hub · Enterprise 3.24.0 · 1 host' };

    it('reports the connection', () => {
      expect(lines('hub', { hub: hubHandle({ hub: null }) })).toEqual([{ tone: 'warning', text: 'Not connected' }]);
      expect(lines('hub', { hub: hubHandle({ state: null }) })).toEqual([{ tone: 'muted', text: 'Connecting to https://hub…' }]);
      const failure = { message: 'refused', details: '' };
      expect(lines('hub', { hub: hubHandle({ state: null, failure }) })).toEqual([{ tone: 'error', text: 'Can’t reach https://hub' }]);
    });

    it('names the hub without a host count when unknown', () => {
      expect(lines('hub', { hub: hubHandle({ state: hubState({ hosts: null }) }) })[0].text).toBe('hub · Enterprise 3.24.0');
      expect(lines('hub', { hub: hubHandle({ state: hubState({ hosts: 4 }) }) })[0].text).toBe('hub · Enterprise 3.24.0 · 4 hosts');
    });

    it('flags another source, or an SSH URL it cannot pull', () => {
      const other = hubHandle({ state: hubState({}, { url: 'https://github.com/acme/other' }) });
      expect(lines('hub', { hub: other })).toEqual([name, { tone: 'warning', text: 'Deploys another source' }]);
      const ssh = hubHandle({ state: hubState({}, { url: 'git@github.com:acme/policy.git' }) });
      expect(lines('hub', { hub: ssh })).toEqual([name, { tone: 'error', text: 'Can’t pull: an SSH URL without a deploy key' }]);
    });

    it('compares what the hub runs with the latest commit', () => {
      const runs = (releaseId: string | null, git = gitStatus()) => lines('hub', { git, hub: hubHandle({ state: hubState({ releaseId }) }) });
      expect(runs(null)).toEqual([name, { tone: 'success', text: 'Deploys this project’s main' }, { tone: 'muted', text: 'No policy reported yet' }]);
      expect(runs(HEAD)[2]).toEqual({ tone: 'success', text: 'Runs 0123456, the latest' });
      expect(runs(HEAD, gitStatus({ ahead: 1 }))[2]).toEqual({ tone: 'warning', text: 'Runs 0123456 · you’d ship 0123456' });
      expect(runs('fedcba9876543210')[2]).toEqual({ tone: 'warning', text: 'Runs fedcba9 · you’d ship 0123456' });
      expect(runs('fedcba9876543210', gitStatus({ lastCommit: null }))[2]).toEqual({ tone: 'warning', text: 'Runs fedcba9' });
    });
  });
});
