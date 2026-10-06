import { execFile } from 'child_process';
import { BrowserWindow, type IpcMainInvokeEvent, type WebFrameMain, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'fs';
import { homedir, hostname } from 'os';
import { isAbsolute, join, normalize, relative, sep } from 'path';

import type { GitStatus } from '../preload/api';
import { buildPolicySet, deployPolicySet } from './backend';
import { isKnownProject, testEnvironmentSecretFiles } from './project';

/**
 * The Deployment tab: Build (cfbs build + checks, in the sidecar) and Commit & push (the
 * system's git, in the project folder). Only folders this session opened are touched.
 */

const GIT_TIMEOUT_MS = 30_000;
// Copying the policy set and two agent runs on the hub.
// `host` or `user@host` that cf-remote can reach (no ~/.ssh/config aliases); never an option.
const SSH_HOST = /^(?:\w[\w.-]*@)?\w[\w.-]*$/;
const PUSH_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 15_000;
// http(s), ssh, git, file URLs, scp-like `user@host:path`, or a local path.
const REMOTE_URL = /^(?:(?:https?|ssh|git|file):\/\/\S+|[\w.-]+@[\w.-]+:\S+|\/\S+)$/;

// A project folder may come from someone else: its own hooks, fsmonitor and ext:: remotes never run.
const NO_PROJECT_COMMANDS = [
  'core.fsmonitor=false',
  `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
  'protocol.ext.allow=never'
].flatMap(setting => ['-c', setting]);
// Repository settings that run a command and can't be overridden like those (the project names them).
const RUNS_COMMAND =
  /^(?:filter\..+\.(?:clean|smudge|process)|merge\..+\.driver|credential\.(?:.+\.)?helper|gpg\.(?:.+\.)?program|gpg\.ssh\.defaultkeycommand|core\.(?:askpass|gitproxy|alternaterefscommand)|remote\..+\.(?:uploadpack|receivepack))$/i;

type Git = { code: number; stderr: string; stdout: string };

// No prompts: a push without stored credentials fails at once instead of hanging.
const NO_PROMPT_SSH = 'ssh -o BatchMode=yes';

// The user's own core.sshCommand (global or system), never the project's; the env var outranks both.
async function sshCommand(): Promise<string> {
  const [scope, command] = (await git(homedir(), ['config', '--show-scope', '--get', 'core.sshCommand'])).stdout.trim().split('\t');
  return (scope === 'global' || scope === 'system') && command ? command : NO_PROMPT_SSH;
}

async function git(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<Git> {
  const ssh = args[0] === 'fetch' || args[0] === 'push' ? await sshCommand() : NO_PROMPT_SSH;
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: ssh };
    execFile('git', [...NO_PROJECT_COMMANDS, ...args], { cwd, env, timeout, maxBuffer: 20_000_000 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error('Git isn’t installed (or not on PATH).'));
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

// The last line a failed command printed: its own summary.
const commandError = (what: string, result: Git) =>
  Object.assign(new Error(`${what}: ${result.stderr.trim().split('\n').filter(Boolean).pop() ?? `exit ${result.code}`}`), {
    details: result.stderr.trim()
  });

function projectPath(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) throw new Error('Invalid project path');
  const path = normalize(value);
  if (!isKnownProject(path)) throw new Error('Not a project opened in this session');
  return path;
}

// A project whose repository config would make git run one of its commands is left alone.
async function repoPath(value: unknown): Promise<string> {
  const path = projectPath(value);
  const config = await git(path, ['config', '--list', '--show-scope', '--name-only']);
  const runs = config.stdout
    .split('\n')
    .map(line => line.split('\t'))
    .find(([scope, name]) => (scope === 'local' || scope === 'worktree') && RUNS_COMMAND.test(name ?? ''));
  if (runs) throw new Error(`This project’s git config runs a command (${runs[1]}), so the app won’t run git in it. Remove that setting from .git/config.`);
  return path;
}

// Keeps cfbs's build output and the test environments' secrets (.env) files out of git.
async function ensureGitignore(path: string, secrets: string[]) {
  const file = join(path, '.gitignore');
  if ((await fs.lstat(file).catch(() => null))?.isSymbolicLink()) throw new Error('.gitignore is a symbolic link: the app won’t write through it.');
  const text = await fs.readFile(file, 'utf-8').catch(() => '');
  const lines = text.split('\n').map(line => line.trim());
  const missing = [
    ...(['out', 'out/', '/out', '/out/'].some(entry => lines.includes(entry)) ? [] : ['out/']),
    ...secrets.map(secret => `/${secret.split(sep).join('/')}`).filter(entry => !lines.includes(entry) && !lines.includes(entry.slice(1)))
  ];
  if (missing.length) await fs.writeFile(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
}

// git's own identity when there is one, else the same fallback the project's first commit used.
async function identity(path: string): Promise<string[]> {
  const args: string[] = [];
  for (const [key, fallback] of [
    ['user.name', 'cfbs'],
    ['user.email', `cfbs@${hostname()}`]
  ]) {
    if (!(await git(path, ['config', key])).stdout.trim()) args.push('-c', `${key}=${fallback}`);
  }
  return args;
}

export async function status(path: string): Promise<GitStatus> {
  const top = await git(path, ['rev-parse', '--show-toplevel']);
  const real = await fs.realpath(path);
  const repo = top.code === 0 && normalize(top.stdout.trim()) === real;
  const empty: GitStatus = {
    repo,
    branch: null,
    remote: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    changedFiles: 0,
    changedPaths: [],
    lastCommit: null,
    headBuilder: null
  };
  if (!repo) return empty;
  // What the remote has that we don't (best effort: offline, the last fetch's view).
  if ((await git(path, ['remote', 'get-url', 'origin'])).code === 0) await git(path, ['fetch', '--quiet', 'origin'], FETCH_TIMEOUT_MS).catch(() => null);
  const [branch, remote, upstream, changed, last, head] = await Promise.all([
    git(path, ['symbolic-ref', '--short', 'HEAD']),
    git(path, ['remote', 'get-url', 'origin']),
    git(path, ['rev-parse', '--abbrev-ref', '@{u}']),
    git(path, ['status', '--porcelain']),
    git(path, ['log', '-1', '--format=%H%x00%s%x00%cI']),
    git(path, ['show', 'HEAD:.policy-builder/project.json'])
  ]);
  let ahead = 0;
  let behind = 0;
  if (upstream.code === 0) {
    const counts = await git(path, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
    [behind, ahead] = counts.stdout.trim().split(/\s+/).map(Number);
  } else if (remote.code === 0 && last.code === 0) {
    ahead = Number((await git(path, ['rev-list', '--count', 'HEAD', '--not', '--remotes=origin'])).stdout.trim()) || 0;
  }
  const [hash, subject, date] = last.code === 0 ? last.stdout.trim().split('\0') : [];
  let headBuilder: unknown = null;
  try {
    headBuilder = head.code === 0 ? JSON.parse(head.stdout) : null;
  } catch {
    headBuilder = null;
  }
  return {
    repo,
    branch: branch.code === 0 ? branch.stdout.trim() : null,
    remote: remote.code === 0 ? remote.stdout.trim() : null,
    upstream: upstream.code === 0 ? upstream.stdout.trim() : null,
    ahead: ahead || 0,
    behind: behind || 0,
    changedFiles: changed.stdout.split('\n').filter(Boolean).length,
    changedPaths: changed.stdout
      .split('\n')
      .filter(Boolean)
      .map(line => line.slice(3))
      .slice(0, 50),
    lastCommit: hash ? { hash, subject, date } : null,
    headBuilder
  };
}

async function commitAll(path: string, message: string) {
  const secrets = await testEnvironmentSecretFiles(path);
  await ensureGitignore(path, secrets);
  // A secrets file committed before it was ignored leaves the index (it stays on disk).
  if (secrets.length) await git(path, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...secrets]);
  const add = await git(path, ['add', '--all']);
  if (add.code !== 0) throw commandError('git add failed', add);
  const commit = await git(path, [...(await identity(path)), 'commit', '--quiet', '-m', message]);
  if (commit.code !== 0) {
    if (/nothing to commit/.test(commit.stdout + commit.stderr)) throw new Error('Nothing to commit: the saved project matches the last commit.');
    throw commandError('git commit failed', commit);
  }
}

/** Makes a built policy set the hub's masterfiles with `cf-remote deploy`, as is. */
async function deployOverSsh(path: string, host: string, port: number | null, key: string | null, onStage: (stage: string) => void): Promise<string> {
  const { deployed, log } = await deployPolicySet({ host: port ? `${host}:${port}` : host, key, path }, onStage);
  if (!deployed) {
    const last = log.trim().split('\n').filter(Boolean).pop();
    throw Object.assign(new Error(`cf-remote deploy to ${host} failed${last ? `: ${last}` : ''}`), { details: log.trim() });
  }
  return log.trim();
}

// A build's or deploy's step as it starts, to the window that asked ('deploy:progress').
const progress = (event: IpcMainInvokeEvent) => (stage: string) => {
  if (!event.sender.isDestroyed()) event.sender.send('deploy:progress', stage);
};

type Result<T> = Promise<({ ok: true } & T) | { details: string; message: string; ok: false }>;

async function attempt<T extends object>(run: () => Promise<T>): Result<T> {
  try {
    return { ok: true as const, ...(await run()) };
  } catch (error) {
    const failure = error as Error & { details?: string };
    return { ok: false as const, message: failure.message, details: failure.details ?? '' };
  }
}

export function registerDeployHandlers(isTrustedFrame: (frame: WebFrameMain | null) => boolean): void {
  const trusted =
    <A extends unknown[], R>(handler: (event: IpcMainInvokeEvent, ...args: A) => R) =>
    (event: IpcMainInvokeEvent, ...args: A) => {
      if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
      return handler(event, ...args);
    };

  ipcMain.handle(
    'deploy:build',
    trusted((event, path: unknown) => attempt(async () => ({ build: await buildPolicySet(projectPath(path), progress(event)) })))
  );
  ipcMain.handle(
    'deploy:ssh',
    trusted((event, path: unknown, target: unknown) =>
      attempt(async () => {
        const root = projectPath(path);
        const { host, key, port } = (target ?? {}) as { host?: unknown; key?: unknown; port?: unknown };
        if (key !== null && key !== undefined) {
          if (typeof key !== 'string' || !isAbsolute(key) || key.includes('\0') || !(await fs.stat(key).catch(() => null))?.isFile()) {
            throw new Error('The private key file isn’t there');
          }
        }
        if (typeof host !== 'string' || !SSH_HOST.test(host.trim())) throw new Error('Not a host: user@host or host');
        if (port !== null && port !== undefined && !(Number.isInteger(port) && (port as number) > 0 && (port as number) < 65536))
          throw new Error('Invalid port');
        // Always the current saved project: build and check it first.
        const onStage = progress(event);
        const build = await buildPolicySet(root, onStage);
        if (!build.tarball || !build.lint.ok || build.promises.ok === false) return { build, deployed: false, log: '' };
        const log = await deployOverSsh(root, host.trim(), (port as number | null | undefined) ?? null, (key as string | null | undefined) ?? null, onStage);
        return { build, deployed: true, log };
      })
    )
  );
  ipcMain.handle(
    'deploy:pick-key',
    trusted(async event => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = { title: 'Private key for the hub', defaultPath: join(homedir(), '.ssh'), properties: ['openFile' as const, 'showHiddenFiles' as const] };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    })
  );
  ipcMain.handle(
    'deploy:reveal',
    trusted((_event, path: unknown, file: unknown) => {
      const root = projectPath(path);
      if (typeof file !== 'string' || !isAbsolute(file)) throw new Error('Invalid file');
      const inside = relative(root, normalize(file));
      if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Not a file of this project');
      shell.showItemInFolder(normalize(file));
    })
  );
  ipcMain.handle(
    'git:status',
    trusted((_event, path: unknown) => attempt(async () => ({ status: await status(await repoPath(path)) })))
  );
  ipcMain.handle(
    'git:init',
    trusted((_event, path: unknown) =>
      attempt(async () => {
        const root = await repoPath(path);
        const init = await git(root, ['init', '--quiet']);
        if (init.code !== 0) throw commandError('git init failed', init);
        await commitAll(root, 'Initialized the project');
        return { status: await status(root) };
      })
    )
  );
  ipcMain.handle(
    'git:commit',
    trusted((_event, path: unknown, message: unknown) =>
      attempt(async () => {
        const root = await repoPath(path);
        if (typeof message !== 'string' || !message.trim() || message.length > 10_000) throw new Error('A commit needs a message');
        await commitAll(root, message.trim());
        return { status: await status(root) };
      })
    )
  );
  ipcMain.handle(
    'git:set-remote',
    trusted((_event, path: unknown, url: unknown) =>
      attempt(async () => {
        const root = await repoPath(path);
        if (typeof url !== 'string' || url.length > 2000 || !REMOTE_URL.test(url.trim())) throw new Error('Not a git remote URL');
        const known = (await git(root, ['remote', 'get-url', 'origin'])).code === 0;
        const set = await git(root, ['remote', known ? 'set-url' : 'add', 'origin', url.trim()]);
        if (set.code !== 0) throw commandError('Setting the remote failed', set);
        return { status: await status(root) };
      })
    )
  );
  // A push the remote rejected (it has commits we don't): bring theirs in under ours, or overwrite.
  ipcMain.handle(
    'git:sync',
    trusted((_event, path: unknown, mode: unknown) =>
      attempt(async () => {
        const root = await repoPath(path);
        if (mode !== 'rebase' && mode !== 'force') throw new Error('Unknown sync');
        if (mode === 'rebase') {
          if ((await git(root, ['status', '--porcelain'])).stdout.trim()) throw new Error('Commit your changes first: there are uncommitted files.');
          const fetch = await git(root, ['fetch', 'origin'], PUSH_TIMEOUT_MS);
          if (fetch.code !== 0) throw commandError('git fetch failed', fetch);
          const branch = (await git(root, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
          const upstream = await git(root, ['rev-parse', '--abbrev-ref', '@{u}']);
          const onto = upstream.code === 0 ? upstream.stdout.trim() : `origin/${branch}`;
          const rebase = await git(root, [...(await identity(root)), 'rebase', onto]);
          if (rebase.code !== 0) {
            const conflicts = (await git(root, ['diff', '--name-only', '--diff-filter=U'])).stdout.trim().split('\n').filter(Boolean);
            await git(root, ['rebase', '--abort']);
            throw Object.assign(
              new Error(
                `Your commits and the remote’s change the same ${conflicts.length ? `files (${conflicts.join(', ')})` : 'lines'}: nothing was changed. Merge them in git, or overwrite the remote.`
              ),
              { details: `${rebase.stdout}${rebase.stderr}`.trim() }
            );
          }
        }
        const push = await git(root, ['push', ...(mode === 'force' ? ['--force-with-lease'] : []), '--set-upstream', 'origin', 'HEAD'], PUSH_TIMEOUT_MS);
        if (push.code !== 0) throw commandError('git push failed', push);
        return { status: await status(root), pulled: mode === 'rebase' };
      })
    )
  );
  ipcMain.handle(
    'git:push',
    trusted((_event, path: unknown) =>
      attempt(async () => {
        const root = await repoPath(path);
        const push = await git(root, ['push', '--set-upstream', 'origin', 'HEAD'], PUSH_TIMEOUT_MS);
        if (push.code !== 0) throw commandError('git push failed', push);
        return { status: await status(root) };
      })
    )
  );
}
