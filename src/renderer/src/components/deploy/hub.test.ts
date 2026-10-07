import type { GitStatus, HubState } from '../../../../preload/api';
import { cannotPull, deploysProject, httpsOf, isSsh, sameRepo, whyNotProject } from './hub';

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

const hubState = (vcs: Partial<NonNullable<HubState['vcs']>> | null = {}): HubState => ({
  deploysEnabled: true,
  hosts: null,
  info: { hostkey: 'SHA=abc', hostname: 'hub', license: 'x', version: '3.24.0' },
  releaseId: null,
  vcs: vcs && { hasKey: false, refspec: 'main', subdirectory: '', type: 'GIT_CFBS', url: 'https://github.com/acme/policy', username: '', ...vcs }
});

describe('sameRepo', () => {
  it('matches the SSH and HTTPS forms of one repository', () => {
    expect(sameRepo('git@github.com:acme/policy.git', 'https://github.com/acme/policy')).toBe(true);
    expect(sameRepo('ssh://git@github.com/acme/policy.git', 'https://github.com/acme/policy.git')).toBe(true);
    expect(sameRepo('git://github.com/acme/policy.git', 'https://user@github.com/acme/policy')).toBe(true);
  });

  it('ignores .git, a slash after it, case and whitespace', () => {
    expect(sameRepo('https://github.com/acme/policy.git/', 'https://github.com/acme/policy')).toBe(true);
    expect(sameRepo(' https://GitHub.com/Acme/Policy ', 'https://github.com/acme/policy')).toBe(true);
  });

  it('ignores a trailing slash without .git', () => {
    expect(sameRepo('https://github.com/acme/policy/', 'https://github.com/acme/policy')).toBe(true);
  });

  it('tells different repositories and hosts apart', () => {
    expect(sameRepo('https://github.com/acme/policy', 'https://github.com/acme/other')).toBe(false);
    expect(sameRepo('https://gitlab.com/acme/policy', 'https://github.com/acme/policy')).toBe(false);
  });

  it('never matches an empty URL', () => {
    expect(sameRepo('', '')).toBe(false);
    expect(sameRepo('', 'https://github.com/acme/policy')).toBe(false);
  });
});

describe('isSsh', () => {
  it('recognizes scp-like and ssh:// URLs', () => {
    expect(isSsh('git@github.com:acme/policy.git')).toBe(true);
    expect(isSsh('ssh://git@github.com/acme/policy.git')).toBe(true);
    expect(isSsh('  git@github.com:acme/policy.git')).toBe(true);
  });

  it('is false for HTTPS, even with a user', () => {
    expect(isSsh('https://github.com/acme/policy.git')).toBe(false);
    expect(isSsh('https://user@github.com/acme/policy.git')).toBe(false);
  });
});

describe('httpsOf', () => {
  it('rewrites SSH URLs to HTTPS', () => {
    expect(httpsOf('git@github.com:acme/policy.git')).toBe('https://github.com/acme/policy.git');
    expect(httpsOf('ssh://git@github.com:2222/acme/policy.git')).toBe('https://github.com/acme/policy.git');
    expect(httpsOf('ssh://gitlab.example.com/acme/policy')).toBe('https://gitlab.example.com/acme/policy');
  });

  it('is null for anything else', () => {
    expect(httpsOf('https://github.com/acme/policy.git')).toBeNull();
    expect(httpsOf('')).toBeNull();
  });
});

describe('deploysProject', () => {
  it('matches the repository, branch and GIT_CFBS', () => {
    expect(deploysProject(hubState(), gitStatus())).toBe(true);
  });

  it('is false on any mismatch', () => {
    expect(deploysProject(hubState({ refspec: 'dev' }), gitStatus())).toBe(false);
    expect(deploysProject(hubState({ type: 'GIT' }), gitStatus())).toBe(false);
    expect(deploysProject(hubState({ url: 'https://github.com/acme/other' }), gitStatus())).toBe(false);
  });

  it('is false without vcs, git or a remote', () => {
    expect(deploysProject(hubState(null), gitStatus())).toBe(false);
    expect(deploysProject(null, gitStatus())).toBe(false);
    expect(deploysProject(hubState(), null)).toBe(false);
    expect(deploysProject(hubState(), gitStatus({ remote: null }))).toBe(false);
  });
});

describe('cannotPull', () => {
  it('is true only for an SSH URL without a deploy key', () => {
    expect(cannotPull(hubState({ url: REMOTE }))).toBe(true);
    expect(cannotPull(hubState({ url: REMOTE, hasKey: true }))).toBe(false);
    expect(cannotPull(hubState())).toBe(false);
    expect(cannotPull(hubState(null))).toBe(false);
    expect(cannotPull(null)).toBe(false);
  });
});

describe('whyNotProject', () => {
  it('is null when the hub deploys the project', () => {
    expect(whyNotProject(hubState(), gitStatus())).toBeNull();
  });

  it('explains a hub not set up for git', () => {
    expect(whyNotProject(hubState(null), gitStatus())).toBe('The hub isn’t set up to deploy from git.');
  });

  it('explains a project without a remote', () => {
    expect(whyNotProject(hubState(), gitStatus({ remote: null }))).toBe(
      'The hub deploys https://github.com/acme/policy @ main, but this project has no remote to compare with (set it under Git repository).'
    );
    expect(whyNotProject(hubState({ url: '' }), null)).toMatch(/^The hub deploys \(none\) @ main/);
  });

  it('names the other repository', () => {
    expect(whyNotProject(hubState({ url: 'https://github.com/acme/other' }), gitStatus())).toBe(
      `The hub deploys https://github.com/acme/other, not this project’s ${REMOTE}.`
    );
  });

  it('names both branches', () => {
    expect(whyNotProject(hubState({ refspec: 'dev' }), gitStatus())).toBe('The hub deploys branch “dev”, this project is on “main”.');
    expect(whyNotProject(hubState({ refspec: 'dev' }), gitStatus({ branch: null }))).toBe('The hub deploys branch “dev”, this project is on “?”.');
  });

  it('names a vcs type other than GIT_CFBS', () => {
    expect(whyNotProject(hubState({ type: 'GIT' }), gitStatus())).toBe('The hub deploys this repository as GIT, not GIT_CFBS (built with cfbs on the hub).');
  });
});
