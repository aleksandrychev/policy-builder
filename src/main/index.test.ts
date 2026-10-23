import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { promises as fs, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
type WindowOpenHandler = (details: { url: string }) => { action: string };

// The app's entry point, loaded against a stand-in Electron that records what it is asked to do.
const state = vi.hoisted(() => ({
  isPackaged: false,
  loaded: [] as string[],
  protocols: new Map<string, (request: Request) => Promise<Response> | Response>(),
  handlers: new Map<string, Handler>(),
  // The window's webContents events (will-navigate…) and its window-open handler.
  contentsEvents: new Map<string, (...args: unknown[]) => void>(),
  windowOpenHandler: null as WindowOpenHandler | null,
  opened: [] as string[],
  menus: [] as MenuItemConstructorOptions[][],
  title: '',
  openDialogPaths: [] as string[],
  userData: ''
}));

vi.mock('electron', async importOriginal => {
  const original = await importOriginal<typeof import('./test/electron')>();
  const webContents = {
    on: (event: string, listener: (...args: unknown[]) => void) => void state.contentsEvents.set(event, listener),
    setWindowOpenHandler: (handler: WindowOpenHandler) => void (state.windowOpenHandler = handler),
    setZoomFactor: () => {},
    getURL: () => 'app://bundle/index.html',
    send: () => {}
  };
  class BrowserWindow {
    static current: BrowserWindow | null = null;
    webContents = webContents;
    constructor() {
      BrowserWindow.current = this;
    }
    static fromWebContents() {
      return BrowserWindow.current;
    }
    static getAllWindows() {
      return BrowserWindow.current ? [BrowserWindow.current] : [];
    }
    isDestroyed = () => false;
    loadURL = (url: string) => void state.loaded.push(url);
    on = () => {};
    setDocumentEdited = () => {};
    setTitle = (title: string) => void (state.title = title);
  }
  return {
    ...original,
    BrowserWindow,
    Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => (state.menus.push(template), {}), setApplicationMenu: () => {} },
    app: {
      ...original.app,
      get isPackaged() {
        return state.isPackaged;
      },
      getPath: () => state.userData,
      setAppUserModelId: () => {}
    },
    dialog: { ...original.dialog, showOpenDialog: async () => ({ canceled: state.openDialogPaths.length === 0, filePaths: state.openDialogPaths }) },
    ipcMain: { ...original.ipcMain, handle: (channel: string, handler: Handler) => void state.handlers.set(channel, handler) },
    net: { fetch: async () => new Response('file') },
    protocol: { registerSchemesAsPrivileged: () => {}, handle: (scheme: string, handler: never) => void state.protocols.set(scheme, handler) },
    session: { defaultSession: { setPermissionCheckHandler: () => {}, setPermissionRequestHandler: () => {} } },
    shell: { ...original.shell, openExternal: async (url: string) => void state.opened.push(url) }
  };
});

const backend = vi.hoisted(() => ({ lintCustom: vi.fn(async () => ({})) }));
vi.mock('./backend', () => backend);
vi.mock('./deploy', () => ({ registerDeployHandlers: () => {} }));
vi.mock('./hub', () => ({ registerHubHandlers: () => {} }));
vi.mock('./testenv', () => ({ registerTestEnvHandlers: () => {} }));
vi.mock('./project', () => ({
  clearRecentProjects: () => {},
  getRecentProjects: async () => [],
  getTheme: async () => 'system',
  onRecentsChanged: () => {},
  registerProjectHandlers: () => {},
  setTheme: async () => {}
}));

async function launch({ isPackaged }: { isPackaged: boolean }) {
  Object.assign(state, {
    isPackaged,
    loaded: [],
    handlers: new Map(),
    contentsEvents: new Map(),
    windowOpenHandler: null,
    opened: [],
    menus: [],
    openDialogPaths: [],
    userData: mkdtempSync(join(tmpdir(), 'cfpb-index-'))
  });
  vi.resetModules();
  await import('./index');
  await vi.waitFor(() => expect(state.loaded).toHaveLength(1));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// What the packaged renderer's top frame sends; `url` and `top` make another origin or an iframe.
function ipcEvent({ url = 'app://bundle/index.html', iframe = false } = {}) {
  const frame: { top?: unknown; url: string } = { url };
  frame.top = iframe ? {} : frame;
  const sender = { undo: vi.fn(), copy: vi.fn(), selectAll: vi.fn(), reload: vi.fn() };
  return { senderFrame: frame, sender } as unknown as IpcMainInvokeEvent & { sender: typeof sender };
}
const invoke = (channel: string, event: IpcMainInvokeEvent, ...args: unknown[]) => state.handlers.get(channel)!(event, ...args);

// The last application menu built: its top-level menu `label`, item by item.
const menuItems = (label: string) => (state.menus.at(-1)!.find(menu => menu.label === label)?.submenu ?? []) as MenuItemConstructorOptions[];

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

describe('links leaving the app', () => {
  const unsafe = ['file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'vscode://file/x', 'not a url'];

  it('open in the browser only for http(s), and never in a new app window', async () => {
    await launch({ isPackaged: true });
    for (const url of ['https://docs.cfengine.com/', 'http://example.com', ...unsafe]) {
      expect(state.windowOpenHandler!({ url })).toEqual({ action: 'deny' });
    }
    expect(state.opened).toEqual(['https://docs.cfengine.com/', 'http://example.com']);
  });

  it('stop the page navigating away; an http(s) target goes to the browser instead', async () => {
    await launch({ isPackaged: true });
    const navigate = state.contentsEvents.get('will-navigate')!;
    for (const url of ['https://example.com/phish', ...unsafe]) {
      const event = { preventDefault: vi.fn() };
      navigate(event, url);
      expect(event.preventDefault).toHaveBeenCalled();
    }
    expect(state.opened).toEqual(['https://example.com/phish']);
  });
});

describe('IPC from the renderer', () => {
  it('is refused from another origin or an iframe', async () => {
    await launch({ isPackaged: true });
    for (const event of [ipcEvent({ url: 'https://evil.example/' }), ipcEvent({ iframe: true })]) {
      expect(await invoke('theme:should-use-dark', event)).toBe(false);
      expect(() => invoke('window:set-document', event, { edited: false, title: null })).toThrow('untrusted sender');
      expect(() => invoke('window:native-edit', event, 'undo')).toThrow('untrusted sender');
      await expect(invoke('layout:set', event, {})).rejects.toThrow('untrusted sender');
    }
  });

  it('trusts the dev server’s origin only in development', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
    await launch({ isPackaged: false });
    expect(() => invoke('window:set-document', ipcEvent({ url: 'http://localhost:5173/' }), { edited: false, title: null })).not.toThrow();
    expect(() => invoke('window:set-document', ipcEvent(), { edited: false, title: null })).toThrow('untrusted sender');
  });

  it('checks Custom CFEngine text only in the shape it expects', async () => {
    await launch({ isPackaged: true });
    const block = { id: 'b', namespace: 'site', promises: 'files: ;', definitions: '' };
    await invoke('policy:lint-custom', ipcEvent(), [block]);
    expect(backend.lintCustom).toHaveBeenCalledWith([block]);
    expect(() => invoke('policy:lint-custom', ipcEvent({ url: 'https://evil.example/' }), [block])).toThrow('untrusted sender');
    expect(() => invoke('policy:lint-custom', ipcEvent(), 'files: ;')).toThrow('blocks must be a list');
    expect(() => invoke('policy:lint-custom', ipcEvent(), [{ ...block, promises: 42 }])).toThrow('each block has id');
    expect(() => invoke('policy:lint-custom', ipcEvent(), [{ ...block, promises: 'x'.repeat(200_001) }])).toThrow('too long');
  });

  it('runs only the Edit menu’s own text commands natively', async () => {
    await launch({ isPackaged: true });
    const event = ipcEvent();
    invoke('window:native-edit', event, 'undo');
    invoke('window:native-edit', event, 'selectAll');
    expect(event.sender.undo).toHaveBeenCalled();
    expect(event.sender.selectAll).toHaveBeenCalled();
    for (const command of ['reload', 'executeJavaScript', 'constructor', 42]) {
      expect(() => invoke('window:native-edit', event, command)).toThrow('unknown edit command');
    }
    expect(event.sender.reload).not.toHaveBeenCalled();
  });

  it('checks the document state, then titles the window and enables the project’s menu items', async () => {
    await launch({ isPackaged: true });
    const event = ipcEvent();
    for (const bad of [{ edited: 'yes', title: null }, { edited: false, title: 7 }, { edited: false, onDisk: 'no', title: null }, null]) {
      expect(() => invoke('window:set-document', event, bad)).toThrow('invalid document state');
    }
    const enabled = () => Object.fromEntries(menuItems('File').map(item => [item.label, item.enabled ?? true]));
    expect(enabled()).toMatchObject({ Save: false, 'Close Project': false, 'Reload from Disk': false });

    invoke('window:set-document', event, { edited: true, onDisk: false, title: 'Web' });
    expect(state.title).toBe('Web — CFEngine Policy Builder');
    await vi.waitFor(() => expect(enabled()).toMatchObject({ Save: true, 'Close Project': true, 'Reload from Disk': false }));

    invoke('window:set-document', event, { edited: false, onDisk: true, title: 'Web' });
    await vi.waitFor(() => expect(enabled()).toMatchObject({ 'Reload from Disk': true }));
  });

  it('keeps the layout settings it is sent only when they are well-formed', async () => {
    await launch({ isPackaged: true });
    const event = ipcEvent();
    const good = { leftSidebarFraction: 0.2, paletteHeightFraction: 0.5, rightSidebarFraction: 0.3 };
    for (const bad of [null, {}, { ...good, leftSidebarFraction: '0.2' }, { ...good, rightSidebarFraction: Infinity }]) {
      await expect(invoke('layout:set', event, bad)).rejects.toThrow('invalid layout settings');
    }
    await invoke('layout:set', event, good);
    expect(await invoke('layout:get', event)).toEqual(good);
    await fs.writeFile(join(state.userData, 'layout-settings.json'), '{"leftSidebarFraction": "wide"}');
    expect(await invoke('layout:get', event)).toBeNull();
  });

  it('imports a text file, and refuses a binary one', async () => {
    await launch({ isPackaged: true });
    const text = join(state.userData, 'motd.txt');
    const binary = join(state.userData, 'logo.png');
    await fs.writeFile(text, 'Managed by CFEngine\n');
    await fs.writeFile(binary, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]));
    expect(await invoke('file:import-text', ipcEvent())).toBeNull(); // cancelled
    state.openDialogPaths = [text];
    expect(await invoke('file:import-text', ipcEvent())).toEqual({ content: 'Managed by CFEngine\n', fileName: 'motd.txt' });
    state.openDialogPaths = [binary];
    await expect(invoke('file:import-text', ipcEvent())).rejects.toThrow('binary data');
  });
});

describe('the View menu', () => {
  const roles = () => menuItems('View').map(item => item.role);

  it('has no Reload or DevTools in a packaged app: a reload would drop unsaved changes', async () => {
    await launch({ isPackaged: true });
    expect(roles()).not.toContain('reload');
    expect(roles()).not.toContain('forceReload');
    expect(roles()).not.toContain('toggleDevTools');
  });

  it('keeps them in development', async () => {
    await launch({ isPackaged: false });
    expect(roles()).toEqual(expect.arrayContaining(['reload', 'forceReload', 'toggleDevTools']));
  });
});
