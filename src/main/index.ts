import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, net, protocol, session, shell } from 'electron';
import type { MenuItemConstructorOptions, WebFrameMain } from 'electron';
import { promises as fs } from 'fs';
import { basename, join, normalize, sep } from 'path';
import { pathToFileURL } from 'url';

import type { RecentProject } from '../preload/api';
import { compilePolicy, formatPolicy, warmUpSidecar } from './backend';
import { registerDeployHandlers } from './deploy';
import { registerHubHandlers } from './hub';
import { clearRecentProjects, getRecentProjects, onRecentsChanged, registerProjectHandlers } from './project';
import { registerTestEnvHandlers } from './testenv';

const APP_TITLE = 'CFEngine Policy Builder';
const MAX_TITLE_LENGTH = 200;

// Per window: unsaved changes (from window:set-document), and whether the user already agreed to lose them.
const documentState = new WeakMap<BrowserWindow, { closeConfirmed: boolean; edited: boolean; quitAfterClose: boolean }>();
let quitting = false;
// The window the application menu talks to.
let menuWindow: BrowserWindow | null = null;

// Sidebar/palette resize state the renderer asks us to persist across
// launches — kept as its own small file rather than folded into a future
// cfbs.json, since it's a window-chrome preference, not project data.
interface LayoutSettings {
  leftSidebarFraction: number;
  paletteHeightFraction: number;
  rightSidebarFraction: number;
}

function isLayoutSettings(value: unknown): value is LayoutSettings {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.leftSidebarFraction === 'number' &&
    Number.isFinite(candidate.leftSidebarFraction) &&
    typeof candidate.rightSidebarFraction === 'number' &&
    Number.isFinite(candidate.rightSidebarFraction) &&
    typeof candidate.paletteHeightFraction === 'number' &&
    Number.isFinite(candidate.paletteHeightFraction)
  );
}

function layoutSettingsPath(): string {
  return join(app.getPath('userData'), 'layout-settings.json');
}

// electron-vite exposes the dev renderer URL via this env var; a packaged app never
// reads it (it would trust whatever page it names) and loads the built renderer.
const rendererDevUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];

// Only ever hand http(s) links to the OS: shell.openExternal with any other
// scheme (file:, smb:, custom protocols…) can execute programs.
function openExternalIfSafe(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    shell.openExternal(url);
  }
}

// The built renderer is served from app://bundle/, not file:// (Electron's security checklist #18):
// a standard, secure origin of its own, so file:// keeps no extra privileges (see electron-builder.yml).
const APP_ORIGIN = 'app://bundle';
const rendererDir = join(__dirname, '../renderer');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

// app://bundle/<path> → the built renderer's file; nothing outside its folder.
function serveRenderer(request: Request): Promise<Response> | Response {
  const url = new URL(request.url);
  let path: string;
  try {
    path = normalize(join(rendererDir, decodeURIComponent(url.pathname)));
  } catch {
    return new Response('Not found', { status: 404 }); // a malformed %-escape
  }
  if (url.host !== 'bundle' || !path.startsWith(rendererDir + sep)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(path).href).catch(() => new Response('Not found', { status: 404 }));
}

// IPC handlers only answer our own renderer: the dev-server origin in dev, app://bundle in production.
function isTrustedFrame(frame: WebFrameMain | null): boolean {
  if (!frame || frame !== frame.top) return false;
  const url = new URL(frame.url);
  // Node gives non-special schemes like app: a "null" origin: compare scheme and host.
  return rendererDevUrl ? url.origin === new URL(rendererDevUrl).origin : `${url.protocol}//${url.host}` === APP_ORIGIN;
}

// Mirrors the three entry points on NoProjectScreen's welcome card — the
// renderer owns what each one actually does (open the dialog, dispatch the
// demo builder); this just forwards a "you chose X" signal down the same
// window's preload bridge, since a Menu click handler runs in the main
// process and has no access to renderer state.
function buildApplicationMenu(mainWindow: BrowserWindow, recents: RecentProject[]): Menu {
  const isMac = process.platform === 'darwin';
  const send = (channel: string, argument?: string) => () => mainWindow.webContents.send(channel, argument);
  const openRecent: MenuItemConstructorOptions[] = [
    ...recents.map(recent => ({
      label: recent.name,
      sublabel: recent.path,
      toolTip: recent.path,
      enabled: recent.exists,
      click: send('menu:open-recent', recent.path)
    })),
    ...(recents.length ? [{ type: 'separator' as const }] : []),
    { label: 'Clear Recent', enabled: recents.length > 0, click: () => void clearRecentProjects() }
  ];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: send('menu:new-project') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: send('menu:open-project') },
        { label: 'Open Recent', submenu: openRecent },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('menu:save') },
        { label: 'Project Settings…', accelerator: 'CmdOrCtrl+,', click: send('menu:project-settings') },
        { type: 'separator' },
        { label: 'Try Demo: Web Server Hardening', click: send('menu:try-demo') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    // The default View menu minus page zoom: Ctrl/Cmd +/-/0 zoom the canvas instead (renderer).
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    },
    ...(isMac ? [{ role: 'windowMenu' as const }] : [])
  ];

  return Menu.buildFromTemplate(template);
}

async function refreshMenu(): Promise<void> {
  if (!menuWindow || menuWindow.isDestroyed()) return;
  const window = menuWindow;
  const recents = await getRecentProjects().catch(() => []);
  if (window === menuWindow && !window.isDestroyed()) Menu.setApplicationMenu(buildApplicationMenu(window, recents));
}

// End-to-end runs (development builds only): no window on screen and no Dock icon, so tests
// don't steal focus. Playwright drives the page all the same.
const HIDDEN = !app.isPackaged && process.env.CFPB_E2E_HIDDEN === '1';
if (HIDDEN) app.dock?.hide();
// Under test the page always renders frames, even before the window counts as visible.
const TESTING = HIDDEN || (!app.isPackaged && process.env.CFPB_E2E === '1');

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: APP_TITLE,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#21262A' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      // A hidden or not-yet-visible window would otherwise have its frames and timers throttled.
      backgroundThrottling: !TESTING
    }
  });

  menuWindow = mainWindow;
  Menu.setApplicationMenu(buildApplicationMenu(mainWindow, []));
  void refreshMenu();
  // A recent project's folder may have gone (or come back) meanwhile.
  mainWindow.on('focus', () => void refreshMenu());
  documentState.set(mainWindow, { closeConfirmed: false, edited: false, quitAfterClose: false });

  // With unsaved changes the renderer asks Save / Don't Save / Cancel, then confirms via window:close-confirmed.
  mainWindow.on('close', event => {
    const state = documentState.get(mainWindow);
    if (!state?.edited || state.closeConfirmed) return;
    event.preventDefault();
    state.quitAfterClose = quitting;
    quitting = false;
    mainWindow.webContents.send('window:close-requested');
  });

  mainWindow.on('ready-to-show', () => {
    if (!HIDDEN) mainWindow.show();
    warmUpSidecar();
  });

  // Chromium remembers a page zoom per origin across launches; the app has none any more.
  mainWindow.webContents.on('did-finish-load', () => mainWindow.webContents.setZoomFactor(1));

  // Open external links in the user's browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(details => {
    openExternalIfSafe(details.url);
    return { action: 'deny' };
  });

  // The app never navigates after load; anything else (dragged links, a
  // compromised renderer setting location.href) goes to the browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      openExternalIfSafe(url);
    }
  });

  if (rendererDevUrl) {
    mainWindow.loadURL(rendererDevUrl);
  } else {
    mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }
}

app.whenReady().then(() => {
  protocol.handle('app', serveRenderer);
  app.setAppUserModelId('com.northerntech.cfengine-policy-builder');

  // The app needs no web permissions (camera, geolocation, notifications…) except writing
  // text to the clipboard (Copy in Generated Policy); deny anything else that asks, or checks.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write');
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'clipboard-sanitized-write');

  ipcMain.handle('theme:should-use-dark', event => {
    if (!isTrustedFrame(event.senderFrame)) return false;
    return nativeTheme.shouldUseDarkColors;
  });

  ipcMain.handle('window:set-document', (event, document: { edited?: unknown; title?: unknown }) => {
    if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
    const window = BrowserWindow.fromWebContents(event.sender);
    const state = window && documentState.get(window);
    if (!window || !state) return;
    const { edited, title } = document ?? {};
    if (typeof edited !== 'boolean' || (title !== null && typeof title !== 'string')) throw new Error('invalid document state');
    state.edited = edited;
    window.setTitle(title ? `${title.slice(0, MAX_TITLE_LENGTH)} — ${APP_TITLE}` : APP_TITLE);
    if (process.platform === 'darwin') window.setDocumentEdited(edited);
  });

  ipcMain.handle('window:close-confirmed', event => {
    if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
    const window = BrowserWindow.fromWebContents(event.sender);
    const state = window && documentState.get(window);
    if (!window || !state) return;
    state.closeConfirmed = true;
    if (state.quitAfterClose) app.quit();
    else window.close();
  });

  registerProjectHandlers(isTrustedFrame);
  registerTestEnvHandlers(isTrustedFrame);
  registerDeployHandlers(isTrustedFrame);
  registerHubHandlers(isTrustedFrame);
  // The File menu and the start screen both list recent projects.
  onRecentsChanged(() => {
    void refreshMenu();
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('window:recents-changed');
  });

  ipcMain.handle('policy:format', (event, source: unknown) => {
    if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
    // Arguments crossing the bridge are untrusted input, even from our own
    // renderer: check the type here rather than handing it to spawn.
    if (typeof source !== 'string') throw new Error('policy source must be a string');
    return formatPolicy(source);
  });

  // The Generated Policy tab's preview: the same compile as a save, nothing written.
  ipcMain.handle('policy:compile', (event, project: unknown) => {
    if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
    if (typeof project !== 'object' || project === null || Array.isArray(project)) throw new Error('project data must be an object');
    return compilePolicy(project);
  });

  // 1 MB is plenty for config/template/script text and keeps a single
  // import from bloating the in-memory project (everything here lands in a
  // Redux field, not a file reference).
  const MAX_IMPORT_BYTES = 1_000_000;

  ipcMain.handle('file:import-text', async event => {
    if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await (window ? dialog.showOpenDialog(window, { properties: ['openFile'] }) : dialog.showOpenDialog({ properties: ['openFile'] }));
    if (result.canceled || result.filePaths.length === 0) return null;
    const [filePath] = result.filePaths;
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_IMPORT_BYTES) throw new Error(`File is too large (max ${MAX_IMPORT_BYTES / 1_000_000} MB)`);
    const buffer = await fs.readFile(filePath);
    // A NUL byte practically never appears in real text — cheap guard against
    // importing a binary file's garbled bytes straight into a policy field.
    if (buffer.includes(0)) throw new Error('That file looks like it contains binary data, not text');
    return { content: buffer.toString('utf-8'), fileName: basename(filePath) };
  });

  ipcMain.handle('layout:get', async event => {
    if (!isTrustedFrame(event.senderFrame)) return null;
    try {
      const raw = await fs.readFile(layoutSettingsPath(), 'utf-8');
      const parsed = JSON.parse(raw);
      return isLayoutSettings(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('layout:set', async (event, settings: unknown) => {
    if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
    if (!isLayoutSettings(settings)) throw new Error('invalid layout settings');
    await fs.writeFile(layoutSettingsPath(), JSON.stringify(settings, null, 2));
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS: a recent project picked from the Dock menu (or a folder dropped on the Dock icon).
app.on('open-file', (event, path) => {
  event.preventDefault();
  if (menuWindow && !menuWindow.isDestroyed()) menuWindow.webContents.send('menu:open-recent', path);
});

// A quit (⌘Q) goes through each window's 'close'; if one asks first, quit again once it is confirmed.
app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
