import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BuildResult, GitStatus } from '../preload/api';
import { buildPolicySet, deployPolicySet } from './backend';
import { registerDeployHandlers, status } from './deploy';
import { type Handler, invoker, ipcEvent, isTrustedFrame } from './test/ipc';

const state = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), known: new Set<string>() }));

vi.mock('electron', async importOriginal => {
  const original = await importOriginal<typeof import('./test/electron')>();
  return { ...original, ipcMain: { ...original.ipcMain, handle: (channel: string, handler: Handler) => void state.handlers.set(channel, handler) } };
});

vi.mock('./backend', () => ({ buildPolicySet: vi.fn(), deployPolicySet: vi.fn() }));
vi.mock('./project', () => ({ isKnownProject: (path: string) => state.known.has(path), testEnvironmentSecretFiles: async () => [] }));

let temp = '';

beforeAll(() => {
  // The user's git config (signing, hooks, default branch) stays out of it, and fetches stay local.
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_ALLOW_PROTOCOL', 'file');
});

beforeEach(async () => {
  temp = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'cfpb-deploy-')));
});

afterEach(async () => {
  state.known.clear();
  await fs.rm(temp, { recursive: true, force: true });
});

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com'
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf-8' }).trim();

async function repo(name = 'project'): Promise<string> {
  const path = join(temp, name);
  await fs.mkdir(path);
  git(path, 'init', '--quiet', '-b', 'main');
  return path;
}

async function commit(path: string, file: string, message: string) {
  await fs.mkdir(join(path, file, '..'), { recursive: true });
  await fs.writeFile(join(path, file), message);
  git(path, 'add', '--all');
  git(path, 'commit', '--quiet', '-m', message);
}

// A local bare repository as origin, with main pushed and tracked.
async function withOrigin(path: string): Promise<string> {
  const origin = join(temp, 'origin.git');
  git(temp, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(path, 'remote', 'add', 'origin', origin);
  git(path, 'push', '--quiet', '--set-upstream', 'origin', 'main');
  return origin;
}

describe('status', () => {
  it('says a plain folder isn’t a repository', async () => {
    await fs.mkdir(join(temp, 'plain'));
    expect(await status(join(temp, 'plain'))).toMatchObject({ repo: false, branch: null, changedFiles: 0, lastCommit: null });
  });

  it('says a folder inside another repository isn’t its own', async () => {
    const path = await repo();
    await fs.mkdir(join(path, 'sub'));
    expect((await status(join(path, 'sub'))).repo).toBe(false);
  });

  it('reads a repository without commits', async () => {
    const path = await repo();
    await fs.writeFile(join(path, 'cfbs.json'), '{}');
    expect(await status(path)).toEqual<GitStatus>({
      repo: true,
      branch: 'main',
      remote: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      changedFiles: 1,
      changedPaths: ['cfbs.json'],
      lastCommit: null,
      headBuilder: null
    });
  });

  it('reads the last commit and its builder data', async () => {
    const path = await repo();
    await fs.mkdir(join(path, '.policy-builder'));
    await fs.writeFile(join(path, '.policy-builder', 'project.json'), '{"files": []}');
    await commit(path, 'cfbs.json', 'Initialized the project');
    const result = await status(path);
    expect(result.lastCommit).toMatchObject({ hash: git(path, 'rev-parse', 'HEAD'), subject: 'Initialized the project' });
    expect(Number.isNaN(Date.parse(result.lastCommit?.date ?? ''))).toBe(false);
    expect(result.headBuilder).toEqual({ files: [] });
    expect(result.changedFiles).toBe(0);
  });

  it('ignores builder data at HEAD that isn’t JSON', async () => {
    const path = await repo();
    await commit(path, '.policy-builder/project.json', 'not json');
    expect((await status(path)).headBuilder).toBeNull();
  });

  it('counts commits ahead of and behind the upstream', async () => {
    const path = await repo();
    await commit(path, 'a.cf', 'first');
    const origin = await withOrigin(path);
    await commit(path, 'b.cf', 'ours');
    expect(await status(path)).toMatchObject({ remote: origin, upstream: 'origin/main', ahead: 1, behind: 0 });

    // Someone else pushes: status fetches it.
    git(temp, 'clone', '--quiet', origin, 'other');
    await commit(join(temp, 'other'), 'c.cf', 'theirs');
    git(join(temp, 'other'), 'push', '--quiet', 'origin', 'main');
    expect(await status(path)).toMatchObject({ ahead: 1, behind: 1 });
  });

  it('counts unpushed commits when the branch has no upstream', async () => {
    const path = await repo();
    await commit(path, 'a.cf', 'first');
    await withOrigin(path);
    git(path, 'checkout', '--quiet', '-b', 'feature');
    await commit(path, 'b.cf', 'second');
    await commit(path, 'c.cf', 'third');
    expect(await status(path)).toMatchObject({ branch: 'feature', upstream: null, ahead: 2, behind: 0 });
  });

  it('lists at most 50 changed paths', async () => {
    const path = await repo();
    await commit(path, 'a.cf', 'first');
    for (let index = 0; index < 60; index += 1) await fs.writeFile(join(path, `file${index}.cf`), 'x');
    await fs.writeFile(join(path, 'a.cf'), 'changed');
    const result = await status(path);
    expect(result.changedFiles).toBe(61);
    expect(result.changedPaths).toHaveLength(50);
    expect(result.changedPaths).toContain('a.cf');
  });
});

describe('IPC handlers', () => {
  const invoke = invoker(state.handlers);
  const build = vi.mocked(buildPolicySet);
  const deploy = vi.mocked(deployPolicySet);
  type Outcome = { deployed?: boolean; details?: string; log?: string; message?: string; ok: boolean; status?: GitStatus };
  const built: BuildResult = {
    lint: { ok: true, problems: [] },
    log: [],
    masterfiles: '3.27.1',
    promises: { how: 'local', ok: true, problems: [] },
    tarball: '/x/out/masterfiles.tgz'
  };
  let project = '';
  let key = '';

  beforeAll(() => registerDeployHandlers(isTrustedFrame));

  beforeEach(async () => {
    project = await repo();
    state.known.add(project);
    key = join(temp, 'id_ed25519');
    await fs.writeFile(key, 'key');
    build.mockReset().mockResolvedValue(built);
    deploy.mockReset().mockResolvedValue({ deployed: true, log: 'deployed\n' });
  });

  const ssh = (target: unknown, path: unknown = project) => invoke('deploy:ssh', path, target) as Promise<Outcome>;

  it('refuses an untrusted sender', () => {
    expect(() => state.handlers.get('git:status')?.(ipcEvent(false), project)).toThrow('untrusted sender');
  });

  it('acts only on projects opened in this session', async () => {
    for (const path of ['project', `${project}\0`, 42, null])
      expect(await ssh({ host: 'hub' }, path)).toMatchObject({ ok: false, message: 'Invalid project path' });
    expect(await ssh({ host: 'hub' }, join(temp, 'other'))).toMatchObject({ ok: false, message: 'Not a project opened in this session' });
    expect(await invoke('git:status', join(temp, 'other'))).toMatchObject({ ok: false, message: 'Not a project opened in this session' });
  });

  it('refuses hosts that aren’t user@host or host', async () => {
    for (const host of [
      '',
      ' ',
      '-oProxyCommand=touch /tmp/x',
      'root@-oProxyCommand=x',
      '-Fx@example.com',
      '.x@hub',
      'hub;reboot',
      'hub name',
      '@hub',
      'root@',
      'a@b@c',
      'hub:22',
      42,
      undefined
    ]) {
      expect(await ssh({ host })).toMatchObject({ ok: false, message: 'Not a host: user@host or host' });
    }
    expect(build).not.toHaveBeenCalled();
  });

  it('refuses invalid ports', async () => {
    for (const port of [0, -1, 65536, 22.5, '22', Number.NaN]) expect(await ssh({ host: 'hub', port })).toMatchObject({ ok: false, message: 'Invalid port' });
    expect(build).not.toHaveBeenCalled();
  });

  it('refuses a key that isn’t an existing file', async () => {
    for (const bad of ['id_ed25519', join(temp, 'missing'), temp, `${key}\0`, 42]) {
      expect(await ssh({ host: 'hub', key: bad })).toMatchObject({ ok: false, message: 'The private key file isn’t there' });
    }
    expect(build).not.toHaveBeenCalled();
  });

  it('builds, then deploys to the host and port', async () => {
    expect(await ssh({ host: ' root@hub.example.com ', port: 2222, key })).toMatchObject({ ok: true, deployed: true, log: 'deployed' });
    expect(build).toHaveBeenCalledWith(project, expect.any(Function));
    expect(deploy).toHaveBeenCalledWith({ host: 'root@hub.example.com:2222', key, path: project }, expect.any(Function));
  });

  it('doesn’t deploy a build that failed its checks', async () => {
    build.mockResolvedValue({ ...built, lint: { ok: false, problems: [] } });
    expect(await ssh({ host: '10.0.0.1' })).toMatchObject({ ok: true, deployed: false });
    build.mockResolvedValue({ ...built, tarball: null });
    expect(await ssh({ host: '10.0.0.1' })).toMatchObject({ ok: true, deployed: false });
    expect(deploy).not.toHaveBeenCalled();
  });

  it('reports a failed deploy by its last log line', async () => {
    deploy.mockResolvedValue({ deployed: false, log: 'connecting\nPermission denied\n' });
    expect(await ssh({ host: 'hub' })).toEqual({
      ok: false,
      message: 'cf-remote deploy to hub failed: Permission denied',
      details: 'connecting\nPermission denied'
    });
  });

  it('refuses remote URLs git could take for options', async () => {
    for (const url of [
      '',
      '--upload-pack=touch /tmp/x',
      '-u x',
      'ext::sh -c touch% /tmp/x',
      'origin',
      'https://',
      'C:repo',
      `https://a/${'b'.repeat(2000)}`,
      42
    ]) {
      expect(await invoke('git:set-remote', project, url)).toMatchObject({ ok: false, message: 'Not a git remote URL' });
    }
    expect(git(project, 'remote')).toBe('');
  });

  it('sets and replaces the origin remote', async () => {
    for (const url of ['https://github.com/acme/policy.git', 'git@github.com:acme/policy.git', 'ssh://git@host/policy', '/srv/git/policy.git']) {
      const result = (await invoke('git:set-remote', project, ` ${url} `)) as Outcome;
      expect(result).toMatchObject({ ok: true, status: { remote: url } });
    }
  });

  it('checks commit messages and sync modes', async () => {
    for (const message of ['', '  ', 'x'.repeat(10_001), 42]) {
      expect(await invoke('git:commit', project, message)).toMatchObject({ ok: false, message: 'A commit needs a message' });
    }
    expect(await invoke('git:sync', project, 'merge')).toMatchObject({ ok: false, message: 'Unknown sync' });
  });

  it('runs none of the project’s own hooks or fsmonitor', async () => {
    const ran = join(temp, 'ran');
    const script = join(temp, 'touch.sh');
    await fs.writeFile(script, `#!/bin/sh\necho "$0" >> '${ran}'\n`, { mode: 0o755 });
    git(project, 'config', 'core.fsmonitor', script);
    await fs.copyFile(script, join(project, '.git', 'hooks', 'pre-commit'));
    await fs.chmod(join(project, '.git', 'hooks', 'pre-commit'), 0o755);
    await fs.writeFile(join(project, 'cfbs.json'), '{}');
    expect(await invoke('git:status', project)).toMatchObject({ ok: true });
    expect(await invoke('git:commit', project, 'First')).toMatchObject({ ok: true });
    expect(git(project, 'log', '--format=%s')).toBe('First');
    await expect(fs.readFile(ran, 'utf-8')).rejects.toThrow();
  });

  it('reaches remotes with the user’s own core.sshCommand, not the project’s', async () => {
    const ran = join(temp, 'ran');
    for (const who of ['user', 'project']) await fs.writeFile(join(temp, `${who}.sh`), `#!/bin/sh\necho ${who} >> '${ran}'\nexit 1\n`, { mode: 0o755 });
    await fs.writeFile(join(temp, 'gitconfig'), `[core]\n\tsshCommand = ${join(temp, 'user.sh')}\n`);
    vi.stubEnv('GIT_CONFIG_GLOBAL', join(temp, 'gitconfig'));
    vi.stubEnv('GIT_ALLOW_PROTOCOL', 'file:ssh');
    try {
      git(project, 'config', 'core.sshCommand', join(temp, 'project.sh'));
      git(project, 'remote', 'add', 'origin', 'ssh://hub.invalid/policy.git');
      expect(await invoke('git:status', project)).toMatchObject({ ok: true });
      expect(new Set((await fs.readFile(ran, 'utf-8')).split('\n').filter(Boolean))).toEqual(new Set(['user']));
    } finally {
      vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
      vi.stubEnv('GIT_ALLOW_PROTOCOL', 'file');
    }
  });

  it('doesn’t write through a .gitignore that is a symlink', async () => {
    const target = join(temp, 'zshrc');
    await fs.writeFile(target, 'export A=1\n');
    await fs.symlink(target, join(project, '.gitignore'));
    await fs.writeFile(join(project, 'cfbs.json'), '{}');
    expect(await invoke('git:commit', project, 'First')).toMatchObject({ ok: false, message: expect.stringContaining('.gitignore is a symbolic link') });
    expect(await fs.readFile(target, 'utf-8')).toBe('export A=1\n');
  });

  it('leaves a project alone whose git config names other commands', async () => {
    git(project, 'config', 'filter.Evil.clean', 'touch /tmp/x');
    expect(await invoke('git:status', project)).toMatchObject({ ok: false, message: expect.stringContaining('(filter.Evil.clean)') });
    expect(await invoke('git:commit', project, 'First')).toMatchObject({ ok: false, message: expect.stringContaining('(filter.Evil.clean)') });
  });

  it('reveals only files of the project', () => {
    expect(() => invoke('deploy:reveal', project, join(temp, 'elsewhere'))).toThrow('Not a file of this project');
    expect(() => invoke('deploy:reveal', project, join(project, '..', 'x'))).toThrow('Not a file of this project');
    expect(() => invoke('deploy:reveal', project, 'out/masterfiles.tgz')).toThrow('Invalid file');
    expect(() => invoke('deploy:reveal', project, join(project, 'out', 'masterfiles.tgz'))).not.toThrow();
  });

  it('reports a failed push by git’s fatal: line, not the advice after it', async () => {
    await fs.writeFile(join(project, 'cfbs.json'), '{}');
    git(project, 'add', '--all');
    git(project, 'commit', '--quiet', '-m', 'First');
    git(project, 'remote', 'add', 'origin', join(temp, 'missing.git'));
    expect(await invoke('git:push', project)).toMatchObject({
      ok: false,
      message: 'git push failed: fatal: Could not read from remote repository.'
    });
  });
});
