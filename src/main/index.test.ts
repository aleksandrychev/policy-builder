import { afterEach, describe, expect, it, vi } from 'vitest';

// The app's entry point, loaded against a stand-in Electron that records what it is asked to do.
const state = vi.hoisted(() => ({
  isPackaged: false,
  loaded: [] as string[],
  protocols: new Map<string, (request: Request) => Promise<Response> | Response>()
}));

vi.mock('electron', async importOriginal => {
  const original = await importOriginal<typeof import('./test/electron')>();
  const emitter = { on: () => {}, setWindowOpenHandler: () => {}, setZoomFactor: () => {} };
  class BrowserWindow extends original.BrowserWindow {
    webContents = emitter;
    isDestroyed = () => true;
    loadURL = (url: string) => void state.loaded.push(url);
    on = () => {};
  }
  return {
    ...original,
    BrowserWindow,
    app: {
      ...original.app,
      get isPackaged() {
        return state.isPackaged;
      },
      setAppUserModelId: () => {}
    },
    net: { fetch: async () => new Response('file') },
    protocol: { registerSchemesAsPrivileged: () => {}, handle: (scheme: string, handler: never) => void state.protocols.set(scheme, handler) },
    session: { defaultSession: { setPermissionCheckHandler: () => {}, setPermissionRequestHandler: () => {} } }
  };
});

vi.mock('./backend', () => ({}));
vi.mock('./deploy', () => ({ registerDeployHandlers: () => {} }));
vi.mock('./hub', () => ({ registerHubHandlers: () => {} }));
vi.mock('./testenv', () => ({ registerTestEnvHandlers: () => {} }));
vi.mock('./project', () => ({
  clearRecentProjects: () => {},
  getRecentProjects: async () => [],
  onRecentsChanged: () => {},
  registerProjectHandlers: () => {}
}));

async function launch({ isPackaged }: { isPackaged: boolean }) {
  state.isPackaged = isPackaged;
  state.loaded = [];
  vi.resetModules();
  await import('./index');
  await vi.waitFor(() => expect(state.loaded).toHaveLength(1));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the renderer it loads', () => {
  it('is the dev server in development', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
    await launch({ isPackaged: false });
    expect(state.loaded).toEqual(['http://localhost:5173']);
  });

  it('is always the built one in a packaged app', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'https://evil.example');
    await launch({ isPackaged: true });
    expect(state.loaded).toEqual(['app://bundle/index.html']);
  });
});

describe('app://bundle/', () => {
  const serve = async (url: string) => (await state.protocols.get('app')!(new Request(url))).status;

  it('serves the built renderer’s files, and answers 404 to anything else', async () => {
    await launch({ isPackaged: true });
    expect(await serve('app://bundle/index.html')).toBe(200);
    for (const url of ['app://bundle/%E0%A4%A', 'app://bundle/%', 'app://bundle/..%2f..%2fpackage.json', 'app://other/index.html']) {
      expect(await serve(url)).toBe(404);
    }
  });
});
