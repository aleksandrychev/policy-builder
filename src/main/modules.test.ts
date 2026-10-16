import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerModuleHandlers } from './modules';
import { type Handler, invoker, ipcEvent, isTrustedFrame } from './test/ipc';

const electron = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), userData: '' }));

vi.mock('electron', async importOriginal => {
  const original = await importOriginal<typeof import('./test/electron')>();
  return {
    ...original,
    app: { ...original.app, getPath: () => electron.userData },
    ipcMain: { handle: (channel: string, handler: Handler) => electron.handlers.set(channel, handler) }
  };
});

const INDEX = { index: { 'delete-files': { description: 'Deletes files', version: '2.0.0' } } };
const DETAILS = {
  'delete-files': { '1.0.0': { versions: { '1.0.0': { latest: false } } }, '2.0.0': { readme: '<p>Hi</p>', versions: { '2.0.0': { latest: true } } } }
};

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const fetchMock = vi.fn<typeof fetch>();
const invoke = invoker(electron.handlers);

beforeAll(() => registerModuleHandlers(isTrustedFrame));

beforeEach(async () => {
  electron.userData = await fs.mkdtemp(join(tmpdir(), 'cfpb-modules-'));
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(electron.userData, { recursive: true, force: true });
});

describe('the module index', () => {
  it('downloads the index and keeps a copy for offline use', async () => {
    fetchMock.mockResolvedValueOnce(answer(INDEX));
    expect(await invoke('modules:index', true)).toMatchObject({ index: INDEX.index, offline: false });
    fetchMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));
    expect(await invoke('modules:index', true)).toMatchObject({ index: INDEX.index, offline: true, error: 'getaddrinfo ENOTFOUND' });
  });

  it('says so when offline with no copy, and refuses what isn’t an index', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await invoke('modules:index', true)).toEqual({ fetchedAt: null, index: null, offline: true, error: 'offline' });
    fetchMock.mockResolvedValueOnce(answer({ modules: [] }));
    expect(await invoke('modules:index', true)).toMatchObject({ index: null, error: 'not a cfbs index' });
  });

  it('refuses an untrusted sender', () => {
    expect(() => electron.handlers.get('modules:index')?.(ipcEvent(false), true)).toThrow('untrusted sender');
  });
});

describe('module details', () => {
  it('gives the latest version’s details, and refuses a name that isn’t one', async () => {
    fetchMock.mockResolvedValue(answer(DETAILS));
    expect(await invoke('modules:details', 'delete-files')).toMatchObject({ details: { readme: '<p>Hi</p>' }, offline: false });
    expect(await invoke('modules:details', 'nope')).toMatchObject({ details: null, error: expect.stringContaining('doesn’t list it') });
    expect(() => invoke('modules:details', '../etc')).toThrow('invalid module name');
  });
});
