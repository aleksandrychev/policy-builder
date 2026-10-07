import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitStatus } from '../preload/api';
import { registerDeployHandlers } from './deploy';
import { registerProjectHandlers } from './project';
import { type FileSpec, builderContent, debianEnvironment, mainFile, webFile } from './test/content';
import { type Handler, invoker, isTrustedFrame } from './test/ipc';
import { useVenvSidecar } from './test/sidecar';

const state = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), userData: '' }));

vi.mock('electron', async importOriginal => {
  const original = await importOriginal<typeof import('./test/electron')>();
  return {
    ...original,
    app: { ...original.app, isPackaged: true, getPath: () => state.userData },
    ipcMain: { ...original.ipcMain, handle: (channel: string, handler: Handler) => void state.handlers.set(channel, handler) }
  };
});

type Outcome = { message?: string; ok: boolean; pulled?: boolean; status?: GitStatus };

const invoke = invoker(state.handlers);
let temp = '';
let origin = '';

beforeAll(() => {
  // The user's git config (signing, hooks, default branch) stays out of it, and fetches stay local.
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_ALLOW_PROTOCOL', 'file');
  registerProjectHandlers(isTrustedFrame);
  registerDeployHandlers(isTrustedFrame);
});

beforeEach(async () => {
  temp = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'cfpb-deploy-it-')));
  state.userData = join(temp, 'user-data');
  await fs.mkdir(state.userData);
  await useVenvSidecar(join(temp, 'resources'));
  origin = join(temp, 'origin.git');
  git(temp, 'init', '--quiet', '--bare', origin);
});

afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Other',
  GIT_AUTHOR_EMAIL: 'other@example.com',
  GIT_COMMITTER_NAME: 'Other',
  GIT_COMMITTER_EMAIL: 'other@example.com'
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf-8' }).trim();
const exists = (path: string) =>
  fs.stat(path).then(
    () => true,
    () => false
  );

const project = () => join(temp, 'web-demo');
const renamed: FileSpec = { ...mainFile, name: 'Hello', namespace: 'hello', path: './hello.cf' };

async function create(gitRepo = true) {
  const result = (await invoke('project:create', {
    ...builderContent([mainFile, webFile]),
    parent: temp,
    folderName: 'web-demo',
    name: 'Web Demo',
    description: 'A demo web server',
    git: gitRepo,
    masterfiles: 'no',
    type: 'policy-set'
  })) as Outcome;
  expect(result.ok).toBe(true);
}

async function save(files: FileSpec[], testEnvironments: object[] = []) {
  const result = (await invoke('project:save', {
    path: project(),
    ...builderContent(files, testEnvironments),
    storage: { type: 'policy-set', masterfiles: null }
  })) as Outcome;
  expect(result.ok).toBe(true);
}

const status = async () => ((await invoke('git:status', project())) as Outcome).status;
const commit = (message: unknown) => invoke('git:commit', project(), message) as Promise<Outcome>;
const push = () => invoke('git:push', project()) as Promise<Outcome>;
const sync = (mode: string) => invoke('git:sync', project(), mode) as Promise<Outcome>;

// The project with origin set and its first commit pushed.
async function pushed() {
  await create();
  expect(await invoke('git:set-remote', project(), origin)).toMatchObject({ ok: true });
  expect((await push()).ok).toBe(true);
}

// Someone else's commit, pushed to origin from a clone of their own.
async function theirCommit(file: string, text: string) {
  const clone = join(temp, 'theirs');
  if (!(await exists(clone))) git(temp, 'clone', '--quiet', origin, clone);
  else git(clone, 'pull', '--quiet');
  await fs.writeFile(join(clone, file), text);
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', `Changed ${file}`);
  git(clone, 'push', '--quiet', 'origin', 'HEAD');
}

describe('commit and push', () => {
  it('commits a save and pushes it', async () => {
    await create();
    const initial = await status();
    expect(initial).toMatchObject({ repo: true, remote: null, upstream: null, ahead: 0, behind: 0, changedFiles: 0 });
    expect(initial?.lastCommit?.subject).toBe('Initialized a new CFEngine Build project');
    expect(initial?.headBuilder).toEqual(JSON.parse(await fs.readFile(join(project(), '.policy-builder', 'project.json'), 'utf-8')));

    const remote = (await invoke('git:set-remote', project(), origin)) as Outcome;
    expect(remote.status).toMatchObject({ remote: origin, upstream: null, ahead: 1 });
    const first = await push();
    expect(first.status).toMatchObject({ upstream: `origin/${initial?.branch}`, ahead: 0, behind: 0 });

    await save([renamed, webFile]);
    const edited = await status();
    expect(edited?.changedPaths).toEqual(expect.arrayContaining(['hello.cf', 'main.cf', 'cfbs.json', '.policy-builder/project.json']));

    const committed = await commit('  Renamed the main file  ');
    expect(committed.status).toMatchObject({ changedFiles: 0, ahead: 1, behind: 0, lastCommit: { subject: 'Renamed the main file' } });
    expect(committed.status?.headBuilder).toMatchObject({ files: [{ path: './hello.cf' }, { path: './services/web.cf' }] });

    expect((await push()).status).toMatchObject({ ahead: 0, behind: 0 });
    expect(git(origin, 'log', '-1', '--format=%s')).toBe('Renamed the main file');
  });

  it('says when there is nothing to commit', async () => {
    await create();
    // The first commit still has the .gitignore it adds.
    expect(await commit('Ignored out/')).toMatchObject({ ok: true, status: { changedFiles: 0 } });
    expect(await commit('Again')).toMatchObject({ ok: false, message: 'Nothing to commit: the saved project matches the last commit.' });
  });

  it('wants a commit message', async () => {
    await create();
    await save([renamed]);
    for (const message of ['', '   ', 42]) expect(await commit(message)).toMatchObject({ ok: false, message: 'A commit needs a message' });
    expect((await status())?.lastCommit?.subject).toBe('Initialized a new CFEngine Build project');
  });

  it('keeps the test environments’ secrets out of commits', async () => {
    await create();
    await save([mainFile, webFile], [debianEnvironment]);
    await fs.writeFile(join(project(), '.env'), 'TOKEN=secret\n');
    expect((await commit('Added a test environment')).status?.changedFiles).toBe(0);
    const tracked = git(project(), 'ls-files').split('\n');
    expect(tracked).toContain('.policy-builder/test-environments.json');
    expect(tracked).not.toContain('.env');
    expect(await fs.readFile(join(project(), '.gitignore'), 'utf-8')).toBe('out/\n/.env\n');
  });

  it('starts a repository for a project made without git', async () => {
    await create(false);
    expect((await status())?.repo).toBe(false);
    const result = (await invoke('git:init', project())) as Outcome;
    expect(result.status).toMatchObject({ repo: true, changedFiles: 0, lastCommit: { subject: 'Initialized the project' } });
    expect(git(project(), 'ls-files')).toContain('.gitignore');
  });
});

describe('a remote that moved on', () => {
  it('reports ahead and behind, and pulls before pushing', async () => {
    await pushed();
    await theirCommit('README.md', 'Theirs\n');
    await save([renamed, webFile]);
    await commit('Renamed the main file');
    expect(await status()).toMatchObject({ ahead: 1, behind: 1 });

    const rejected = await push();
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toMatch(/^git push failed: /);

    const synced = await sync('rebase');
    expect(synced).toMatchObject({ ok: true, pulled: true, status: { ahead: 0, behind: 0, changedFiles: 0 } });
    expect(await fs.readFile(join(project(), 'README.md'), 'utf-8')).toBe('Theirs\n');
    expect(git(origin, 'log', '--format=%s')).toBe(['Renamed the main file', 'Changed README.md', 'Initialized a new CFEngine Build project'].join('\n'));
  });

  it('won’t pull over uncommitted changes', async () => {
    await pushed();
    await theirCommit('README.md', 'Theirs\n');
    await save([renamed]);
    expect(await sync('rebase')).toMatchObject({ ok: false, message: 'Commit your changes first: there are uncommitted files.' });
    expect(await exists(join(project(), 'README.md'))).toBe(false);
  });

  it('stops at a conflict, then overwrites the remote', async () => {
    await pushed();
    await theirCommit('main.cf', 'bundle agent main {}\n');
    await save([{ ...mainFile, messages: ['hello again'] }, webFile]);
    await commit('Changed the greeting');
    const head = git(project(), 'rev-parse', 'HEAD');

    const conflict = await sync('rebase');
    expect(conflict).toMatchObject({ ok: false });
    expect(conflict.message).toContain('(main.cf)');
    expect(git(project(), 'rev-parse', 'HEAD')).toBe(head);
    expect(git(project(), 'status', '--porcelain')).toBe('');

    expect(await sync('force')).toMatchObject({ ok: true, pulled: false, status: { ahead: 0, behind: 0 } });
    expect(git(origin, 'rev-parse', 'HEAD')).toBe(head);
  });
});
