import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatPolicy, resolveCommand, sidecarError, startSidecarStream } from './backend';

const electron = vi.hoisted(() => ({ packaged: false }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electron.packaged;
    }
  }
}));

vi.mock('fs', async importOriginal => ({ ...(await importOriginal<typeof import('fs')>()), existsSync: vi.fn() }));

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
