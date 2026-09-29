import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, session, shell } from 'electron';
import type { MenuItemConstructorOptions, WebFrameMain } from 'electron';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { pathToFileURL } from 'url';

import { formatPolicy } from './backend';

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

// electron-vite exposes the dev renderer URL via this env var; in a packaged
// app it is absent and we load the built HTML from disk instead.
const rendererDevUrl = process.env['ELECTRON_RENDERER_URL'];

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

// IPC handlers only answer our own renderer: the dev-server origin in dev,
// the bundled file: page in production.
function isTrustedFrame(frame: WebFrameMain | null): boolean {
  if (!frame || frame !== frame.top) return false;
  if (rendererDevUrl) return new URL(frame.url).origin === new URL(rendererDevUrl).origin;
  // Compare URLs, not a raw `file://${path}` string: Chromium reports frame.url
  // percent-encoded (the install path "CFEngine Policy Builder.app" contains
  // spaces) and Windows paths contain backslashes, so a plain string
  // comparison never matches in a packaged build.
  return frame.url === pathToFileURL(join(__dirname, '../renderer/index.html')).href;
}

// Mirrors the three entry points on NoProjectScreen's welcome card — the
// renderer owns what each one actually does (open the dialog, dispatch the
// demo builder); this just forwards a "you chose X" signal down the same
// window's preload bridge, since a Menu click handler runs in the main
// process and has no access to renderer state.
function buildApplicationMenu(mainWindow: BrowserWindow): Menu {
  const isMac = process.platform === 'darwin';
  const send = (channel: string) => () => mainWindow.webContents.send(channel);

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: send('menu:new-project') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: send('menu:open-project') },
        { type: 'separator' },
        { label: 'Try Demo: Web Server Hardening', click: send('menu:try-demo') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    ...(isMac ? [{ role: 'windowMenu' as const }] : [])
  ];

  return Menu.buildFromTemplate(template);
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'CFEngine Policy Builder',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#21262A' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  });

  Menu.setApplicationMenu(buildApplicationMenu(mainWindow));

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

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
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.northerntech.cfengine-policy-builder');

  // The app needs no web permissions (camera, geolocation, notifications…);
  // deny anything that asks.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  ipcMain.handle('theme:should-use-dark', event => {
    if (!isTrustedFrame(event.senderFrame)) return false;
    return nativeTheme.shouldUseDarkColors;
  });

  ipcMain.handle('policy:format', (event, source: unknown) => {
    if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
    // Arguments crossing the bridge are untrusted input, even from our own
    // renderer: check the type here rather than handing it to spawn.
    if (typeof source !== 'string') throw new Error('policy source must be a string');
    return formatPolicy(source);
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
