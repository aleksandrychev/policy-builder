import type { BuildResult } from '../../../preload/api';
import { type DeployRun, forgetSshTarget, isValid, readRun, saveSshTarget, sshTargetOf } from './deployRuns';

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
