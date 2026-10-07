import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildPolicySet,
  compilePolicy,
  deployPolicySet,
  formatPolicy,
  initCfbsProject,
  masterfilesEntry,
  resolveCommand,
  sidecarError,
  startSidecarStream,
  testEnvQuery
} from './backend';

const electron = vi.hoisted(() => ({ packaged: false, quit: [] as (() => void)[] }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electron.packaged;
    },
    on: (event: string, listener: () => void) => event === 'will-quit' && electron.quit.push(listener)
  }
}));

vi.mock('fs', async importOriginal => ({ ...(await importOriginal<typeof import('fs')>()), existsSync: vi.fn() }));
vi.mock('child_process', async importOriginal => ({ ...(await importOriginal<typeof import('child_process')>()), spawn: vi.fn() }));

const result = (stderr: string, code: number | null = 1, signal: NodeJS.Signals | null = null) => ({ code, signal, stderr, stdout: '' });

describe('sidecarError', () => {
  it('uses the last stderr line as the message and all of it as details', () => {
    const error = sidecarError(result('Traceback…\n  File "x"\nError: cfbs init failed\n\n'), 1000);
    expect(error.message).toBe('Error: cfbs init failed');
    expect(error.details).toBe('Traceback…\n  File "x"\nError: cfbs init failed');
  });

  it('handles Windows line endings and blank lines', () => {
    expect(sidecarError(result('first\r\nlast\r\n   \r\n'), 1000).message).toBe('last');
  });

  it('says the process timed out on SIGTERM, whatever it printed', () => {
    expect(sidecarError(result('partial output', null, 'SIGTERM'), 30_000).message).toBe('Process timed out after 30000ms');
  });

  it('names another signal or the exit code when nothing was printed', () => {
    expect(sidecarError(result('', null, 'SIGKILL'), 1000).message).toBe('Process was killed by SIGKILL');
    expect(sidecarError(result('out of memory', null, 'SIGKILL'), 1000).message).toBe('out of memory');
    expect(sidecarError(result(' \n', 2), 1000)).toMatchObject({ message: 'Process failed (exit 2)', details: '' });
  });
});

describe('resolveCommand', () => {
  const exists = vi.mocked(existsSync);
  const repoRoot = resolve(__dirname, '../..');

  beforeEach(() => {
    electron.packaged = false;
    exists.mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    delete (process as { resourcesPath?: string }).resourcesPath;
  });

  it('runs the bundle from the app’s resources when packaged', () => {
    electron.packaged = true;
    Object.defineProperty(process, 'resourcesPath', { value: '/Applications/App.app/Contents/Resources', configurable: true });
    expect(resolveCommand()).toEqual({ command: '/Applications/App.app/Contents/Resources/backend/cfpb-backend', commandArgs: [] });
  });

  it('prefers a built bundle in development', () => {
    const bundled = join(repoRoot, 'python/dist/cfpb-backend/cfpb-backend');
    exists.mockImplementation(path => path === bundled);
    expect(resolveCommand()).toEqual({ command: bundled, commandArgs: [] });
  });

  it('falls back to the virtualenv in development', () => {
    expect(resolveCommand()).toEqual({ command: join(repoRoot, 'python/.venv/bin/python'), commandArgs: ['-m', 'cfpb_backend'] });
  });

  it('explains a missing backend instead of spawning', async () => {
    await expect(formatPolicy('bundle agent main {}')).rejects.toThrow(/^Python backend not found at .*python\/\.venv\/bin\/python/);
    expect(await startSidecarStream(['testenv', 'pull'], '{}', () => {}).done).toMatchObject({ ok: false });
  });
});

type FakeChild = EventEmitter & { kill: ReturnType<typeof vi.fn>; pid: number; stderr: PassThrough; stdin: PassThrough; stdout: PassThrough };

const pid = 4242;
let child: FakeChild;
let kill: ReturnType<typeof vi.spyOn>;

// Every spawn gets a fresh stand-in sidecar (the latest is `child`); process.kill is recorded.
function fakeSidecar() {
  beforeEach(() => {
    electron.packaged = false;
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(spawn)
      .mockReset()
      .mockImplementation(() => {
        child = Object.assign(new EventEmitter(), { pid, kill: vi.fn(), stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
        return child as never;
      });
    kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
}

// The sidecar prints and exits; output is delivered before 'close', as with a real process.
async function exit(code: number | null, { stdout = '', stderr = '' } = {}) {
  if (stdout) child.stdout.write(stdout);
  if (stderr) child.stderr.write(stderr);
  await new Promise(resolve => setImmediate(resolve));
  child.emit('close', code, null);
}

describe('stopping a sidecar', () => {
  fakeSidecar();

  it.skipIf(process.platform === 'win32')('cancels a stream by stopping its whole process group', async () => {
    const stream = startSidecarStream(['testenv', 'up'], '{}', () => {});
    expect(vi.mocked(spawn).mock.calls[0][2]).toMatchObject({ detached: true });
    stream.cancel();
    expect(kill).toHaveBeenCalledWith(-pid, 'SIGTERM');
    child.emit('close', 143, null);
    expect(await stream.done).toEqual({ ok: false, message: 'Cancelled' });
  });

  it.skipIf(process.platform === 'win32')('stops the sidecar itself when its process group is gone', () => {
    kill.mockImplementation(() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    });
    startSidecarStream(['testenv', 'up'], '{}', () => {}).cancel();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it.skipIf(process.platform === 'win32')('times a one-shot run out, though the sidecar exits on its own', async () => {
    vi.useFakeTimers();
    const formatted = formatPolicy('bundle agent main {}');
    vi.advanceTimersByTime(30_000);
    expect(kill).toHaveBeenCalledWith(-pid, 'SIGTERM');
    child.emit('close', 143, null);
    await expect(formatted).rejects.toThrow('Process timed out after 30000ms');
  });

  it.skipIf(process.platform === 'win32')('stops one-shot runs when the app quits', async () => {
    const formatted = formatPolicy('bundle agent main {}');
    electron.quit.forEach(listener => listener());
    expect(kill).toHaveBeenCalledWith(-pid, 'SIGTERM');
    child.emit('close', 143, null);
    await expect(formatted).rejects.toThrow();
  });
});

describe('a streamed run', () => {
  fakeSidecar();

  it('hands over one event per stdout line, however the output is chunked', async () => {
    const events: unknown[] = [];
    const stream = startSidecarStream(['testenv', 'up'], '{}', event => events.push(event));
    child.stdout.write('{"t": "progress", "n": 1}\n{"t": "pro');
    child.stdout.write('gress", "n": 2}\n\n   \n');
    await exit(0, { stdout: 'docker: pulling layer\n' });
    expect(events).toEqual([
      { t: 'progress', n: 1 },
      { t: 'progress', n: 2 },
      { t: 'log', line: 'docker: pulling layer' }
    ]);
    expect(await stream.done).toEqual({ ok: true });
  });

  it('ends with the sidecar’s last stderr line when it fails', async () => {
    const failed = startSidecarStream(['testenv', 'up'], '{}', () => {});
    await exit(1, { stderr: 'Traceback…\nError: no such image\n\n' });
    expect(await failed.done).toEqual({ ok: false, message: 'Error: no such image' });

    const silent = startSidecarStream(['testenv', 'up'], '{}', () => {});
    await exit(2);
    expect(await silent.done).toEqual({ ok: false, message: 'Process failed (exit 2)' });
  });

  it('ends when the sidecar can’t be started', async () => {
    const stream = startSidecarStream(['testenv', 'up'], '{}', () => {});
    child.emit('error', new Error('spawn EACCES'));
    expect(await stream.done).toEqual({ ok: false, message: 'spawn EACCES' });
  });
});

describe('a one-shot run', () => {
  fakeSidecar();

  it.skipIf(process.platform === 'win32')('rejects when the sidecar can’t be started, and never times out later', async () => {
    vi.useFakeTimers();
    const formatted = formatPolicy('bundle agent main {}');
    child.emit('error', new Error('spawn EACCES'));
    await expect(formatted).rejects.toThrow('spawn EACCES');
    vi.advanceTimersByTime(60_000);
    expect(kill).not.toHaveBeenCalled();
  });

  it('survives a sidecar that exits before reading its input', async () => {
    const formatted = formatPolicy('bundle agent main {}');
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    await exit(1, { stderr: 'Traceback…\nError: cfengine_cli crashed\n' });
    await expect(formatted).rejects.toMatchObject({ message: 'Error: cfengine_cli crashed', details: 'Traceback…\nError: cfengine_cli crashed' });
  });

  it.each([
    ['compile', () => compilePolicy({ files: [] }), 'Traceback (most recent call last):', 'compile result'],
    ['compile without files', () => compilePolicy({ files: [] }), '{"source_map": {}}', 'compile result'],
    ['init', () => initCfbsProject({} as never), '', 'init result'],
    ['build', () => buildPolicySet('/p'), 'Building…', 'build result'],
    ['deploy', () => deployPolicySet({ host: 'hub', key: null, path: '/p' }), '{"deployed": tr', 'deploy result'],
    ['masterfiles', () => masterfilesEntry('3.27.1'), '{"name": "evil", "steps": ["run sh"]}', 'masterfiles entry'],
    ['masterfiles null', () => masterfilesEntry('3.27.1'), 'null', 'masterfiles entry'],
    ['test environment query', () => testEnvQuery('status'), '<html>', 'answer']
  ])('refuses a %s answer it can’t read', async (_name, run, stdout, what) => {
    const result = run();
    await exit(0, { stdout });
    await expect(result).rejects.toMatchObject({ message: `Python backend returned an unreadable ${what}`, details: stdout });
  });

  it('forwards the build’s stages as their stderr lines complete', async () => {
    const stages: string[] = [];
    const built = buildPolicySet('/p', stage => stages.push(stage));
    child.stderr.write('::stage bu');
    child.stderr.write('ild\ncfbs: downloading masterfiles\n::stage lint\n  ::stage not-a-stage\n::stage prom');
    await exit(0, { stdout: '{"tarball": null}' });
    expect(await built).toEqual({ tarball: null });
    expect(stages).toEqual(['build', 'lint']);
  });
});
