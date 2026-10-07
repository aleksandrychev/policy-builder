import type { BuildResult } from '../../../preload/api';
import { installApi, uninstallApi } from '../test/render';
import {
  type DeployRun,
  forgetSshTarget,
  isValid,
  markDeploySeen,
  readRun,
  resetSsh,
  saveSshTarget,
  sshTargetOf,
  startBuild,
  startHubDeploy,
  startSshDeploy
} from './deployRuns';

const PATH = '/projects/demo';

const build = (lint = true, promises: boolean | null = true): BuildResult => ({
  lint: { ok: lint, problems: [] },
  log: [],
  masterfiles: '/tmp/out/masterfiles',
  promises: { how: promises === null ? 'skipped' : 'local', ok: promises, problems: [] },
  tarball: null
});

const deployRun = (parts: Partial<DeployRun> = {}): DeployRun => ({
  action: null,
  build: build(),
  buildFailure: null,
  builtFrom: null,
  hub: { phase: 'idle' },
  outcome: null,
  ssh: { phase: 'idle' },
  stage: null,
  ...parts
});

afterEach(() => localStorage.clear());

describe('SSH targets', () => {
  it('round-trips a target per project', () => {
    saveSshTarget(PATH, { host: 'hub.example', port: 2222, key: '/keys/id_ed25519' });
    expect(sshTargetOf(PATH)).toEqual({ host: 'hub.example', port: 2222, key: '/keys/id_ed25519' });
    expect(sshTargetOf('/projects/other')).toBeNull();
  });

  it('keeps an empty port and key as null', () => {
    saveSshTarget(PATH, { host: 'hub.example', port: null, key: null });
    expect(localStorage.getItem(`cfpb.deploy.ssh:${PATH}`)).toBe('hub.example||');
    expect(sshTargetOf(PATH)).toEqual({ host: 'hub.example', port: null, key: null });
  });

  it('has no target without a path or a host', () => {
    expect(sshTargetOf(null)).toBeNull();
    localStorage.setItem(`cfpb.deploy.ssh:${PATH}`, '|22|');
    expect(sshTargetOf(PATH)).toBeNull();
  });

  it('forgets a target and resets its deploy state', () => {
    saveSshTarget(PATH, { host: 'hub.example', port: null, key: null });
    forgetSshTarget(PATH);
    expect(sshTargetOf(PATH)).toBeNull();
    expect(readRun(PATH).ssh).toEqual({ phase: 'idle' });
  });
});

describe('isValid', () => {
  it('needs a build that passed the linter', () => {
    expect(isValid(deployRun())).toBe(true);
    expect(isValid(deployRun({ build: null }))).toBe(false);
    expect(isValid(deployRun({ build: build(false) }))).toBe(false);
  });

  it('accepts skipped cf-promises, not failed', () => {
    expect(isValid(deployRun({ build: build(true, null) }))).toBe(true);
    expect(isValid(deployRun({ build: build(true, false) }))).toBe(false);
  });

  it('is false after a build failure', () => {
    expect(isValid(deployRun({ buildFailure: { message: 'cfbs failed', details: '' } }))).toBe(false);
  });
});

describe('readRun', () => {
  it('starts empty for an unknown project, and for none', () => {
    const empty = {
      action: null,
      build: null,
      buildFailure: null,
      builtFrom: null,
      outcome: null,
      stage: null,
      hub: { phase: 'idle' },
      ssh: { phase: 'idle' }
    };
    expect(readRun('/projects/never-built')).toEqual(empty);
    expect(readRun(null)).toEqual(empty);
  });
});

// Runs outlive a test (module state), so each test uses a project path of its own.
let project = 0;
const nextPath = () => `/projects/run-${(project += 1)}`;
const saves = (ok = true) => vi.fn(async () => ok);
const failure = { ok: false as const, message: 'cfbs build failed', details: 'raw output' };
const target = { host: 'web1', key: null, port: null };

describe('starting a Build', () => {
  afterEach(uninstallApi);

  it('saves first and builds nothing when saving failed', async () => {
    const api = installApi();
    const path = nextPath();
    await startBuild(path, saves(false));
    expect(api.buildPolicySet).not.toHaveBeenCalled();
    expect(readRun(path)).toMatchObject({ action: null, stage: null, build: null, outcome: null });
  });

  it('keeps the result, what it was built from, and how it ended', async () => {
    installApi({ buildPolicySet: async () => ({ ok: true, build: build() }) });
    const path = nextPath();
    await startBuild(path, saves(), '{"saved":1}');
    expect(readRun(path)).toMatchObject({ action: null, stage: null, build: build(), buildFailure: null, builtFrom: '{"saved":1}', outcome: 'ok' });
  });

  it('ends in error when a check failed, though it built', async () => {
    installApi({ buildPolicySet: async () => ({ ok: true, build: build(true, false) }) });
    const path = nextPath();
    await startBuild(path, saves());
    expect(readRun(path)).toMatchObject({ build: build(true, false), outcome: 'error' });
  });

  it('replaces an earlier build with the failure', async () => {
    installApi({ buildPolicySet: async () => ({ ok: true, build: build() }) });
    const path = nextPath();
    await startBuild(path, saves());
    installApi({ buildPolicySet: async () => failure });
    await startBuild(path, saves());
    expect(readRun(path)).toMatchObject({ build: null, buildFailure: failure, outcome: 'error' });
    expect(isValid(readRun(path))).toBe(false);
  });

  it('ignores a second start while one is running', async () => {
    let finish!: () => void;
    const api = installApi({
      buildPolicySet: vi.fn(() => new Promise<{ build: BuildResult; ok: true }>(resolve => (finish = () => resolve({ ok: true, build: build() }))))
    });
    const path = nextPath();
    const first = startBuild(path, saves());
    await vi.waitFor(() => expect(api.buildPolicySet).toHaveBeenCalled());
    expect(readRun(path).action).toBe('build');

    await startBuild(path, saves());
    expect(api.buildPolicySet).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(readRun(path).action).toBeNull();
  });

  it('is not left running when the build throws', async () => {
    installApi({ buildPolicySet: async () => Promise.reject(new Error('ipc gone')) });
    const path = nextPath();
    await expect(startBuild(path, saves())).rejects.toThrow('ipc gone');
    expect(readRun(path)).toMatchObject({ action: null, stage: null });
  });

  it('forgets how it ended once the tab is looked at', async () => {
    installApi({ buildPolicySet: async () => ({ ok: true, build: build() }) });
    const path = nextPath();
    await startBuild(path, saves());
    markDeploySeen(path);
    expect(readRun(path).outcome).toBeNull();
  });
});

describe('deploying over SSH', () => {
  afterEach(uninstallApi);

  it('records where and when it deployed, and the build it shipped', async () => {
    installApi({ deployOverSsh: async () => ({ ok: true, build: build(), deployed: true, log: 'agent ran' }) });
    const path = nextPath();
    await startSshDeploy(path, saves(), target, 'content');
    expect(readRun(path)).toMatchObject({
      action: null,
      build: build(),
      builtFrom: 'content',
      outcome: 'ok',
      ssh: { phase: 'deployed', host: 'web1', log: 'agent ran', at: expect.any(Number) }
    });
  });

  it('copies nothing when the build’s checks failed', async () => {
    installApi({ deployOverSsh: async () => ({ ok: true, build: build(false), deployed: false, log: '' }) });
    const path = nextPath();
    await startSshDeploy(path, saves(), target);
    expect(readRun(path)).toMatchObject({ ssh: { phase: 'invalid' }, outcome: 'error' });
  });

  it('keeps the failure to show', async () => {
    installApi({ deployOverSsh: async () => failure });
    const path = nextPath();
    await startSshDeploy(path, saves(), target);
    expect(readRun(path)).toMatchObject({ action: null, ssh: { phase: 'failed', failure }, outcome: 'error' });
  });

  it('can’t be reset while deploying', async () => {
    let finish!: () => void;
    installApi({ deployOverSsh: () => new Promise(resolve => (finish = () => resolve(failure))) });
    const path = nextPath();
    const running = startSshDeploy(path, saves(), target);
    await vi.waitFor(() => expect(readRun(path).ssh.phase).toBe('deploying'));
    resetSsh(path);
    expect(readRun(path).ssh.phase).toBe('deploying');
    finish();
    await running;
    resetSsh(path);
    expect(readRun(path).ssh).toEqual({ phase: 'idle' });
  });
});

describe('deploying on a hub', () => {
  afterEach(uninstallApi);

  it('passes on what the hub runs now, and ends in error when it didn’t deploy', async () => {
    const state = { deploysEnabled: true, hosts: 2, info: {}, releaseId: 'abc', vcs: null } as never;
    installApi({ hubDeploy: async () => ({ ok: true, deployed: 'no', output: 'validation failed', state }) });
    const path = nextPath();
    const onState = vi.fn();
    await startHubDeploy(path, 'https://hub', onState);
    expect(onState).toHaveBeenCalledWith(state);
    expect(readRun(path)).toMatchObject({ action: null, outcome: 'error', hub: { phase: 'done', deployed: 'no', output: 'validation failed' } });
  });

  it('counts an unknown result as done', async () => {
    installApi({ hubDeploy: async () => ({ ok: true, deployed: 'unknown', output: '', state: {} as never }) });
    const path = nextPath();
    await startHubDeploy(path, 'https://hub', vi.fn());
    expect(readRun(path).outcome).toBe('ok');
  });

  it('keeps the failure and leaves the hub’s state alone', async () => {
    installApi({ hubDeploy: async () => failure });
    const path = nextPath();
    const onState = vi.fn();
    await startHubDeploy(path, 'https://hub', onState);
    expect(onState).not.toHaveBeenCalled();
    expect(readRun(path)).toMatchObject({ hub: { phase: 'failed', failure }, outcome: 'error' });
  });
});
