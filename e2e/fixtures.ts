import { type ElectronApplication, type Page, test as base, _electron as electron, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// Shared launch/teardown: each test gets its own app with a throwaway profile, a scratch folder,
// a failure screenshot (Playwright's own don't reach Electron windows) and collected console errors.
const appEntry = resolve(__dirname, '../out/main/index.js');

// Saving spawns the Python sidecar to generate the policy; a cold start can take a while.
export const SAVE_TIMEOUT_MS = 20_000;

type Fixtures = {
  app: ElectronApplication;
  // Console errors (main process and windows) and page errors seen so far; assert it is empty at the end of a test.
  consoleErrors: string[];
  // A temp folder for project fixtures, removed after the test. The profile lives in user-data/,
  // and New Project defaults to projects/ (never the real Documents folder).
  scratchDir: string;
  window: Page;
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures arg to be destructured
  scratchDir: async ({}, provide) => {
    const dir = mkdtempSync(join(tmpdir(), 'cfpb-e2e-'));
    mkdirSync(join(dir, 'projects'));
    mkdirSync(join(dir, 'user-data'));
    writeFileSync(join(dir, 'user-data/app-settings.json'), JSON.stringify({ lastProjectParent: join(dir, 'projects') }));
    await provide(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures arg to be destructured
  consoleErrors: async ({}, provide) => provide([]),
  app: async ({ scratchDir, consoleErrors }, provide) => {
    const app = await launch(join(scratchDir, 'user-data'));
    // From launch on. The sidecar's stderr reaches the main console as diagnostics, not errors.
    app.on('console', message => {
      if (message.type() === 'error' && !message.text().startsWith('[cfpb-backend]')) consoleErrors.push(`main: ${message.text()}`);
    });
    const watch = (page: Page) => {
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
    };
    app.windows().forEach(watch);
    app.on('window', watch);
    await provide(app);
    // exit() skips the unsaved-changes prompt a plain close() would wait on.
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
    await app.close();
  },
  window: async ({ app }, provide, testInfo) => {
    const window = await shownWindow(app);
    await provide(window);
    if (testInfo.status !== testInfo.expectedStatus) {
      const path = testInfo.outputPath('failure.png');
      await window.screenshot({ path }).catch(() => {});
      await testInfo.attach('screenshot', { path, contentType: 'image/png' }).catch(() => {});
    }
  }
});

export { expect };

// Starts the built app with the given profile dir.
export async function launch(userDataDir: string): Promise<ElectronApplication> {
  // ELECTRON_RUN_AS_NODE=1 would start Electron as plain Node, with no window.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<
    string,
    string
  >;
  if (HIDDEN_RUN) env.CFPB_E2E_HIDDEN = '1';
  env.CFPB_E2E = '1';
  return electron.launch({ args: [appEntry, `--user-data-dir=${userDataDir}`], env });
}

// Off screen locally, so a run doesn't take over the desktop (CFPB_E2E_SHOW=1 shows it). Not in CI:
// xvfb is a virtual screen already, and there a hidden window paints no frames, which stalls clicks.
const HIDDEN_RUN = process.env.CFPB_E2E_SHOW !== '1' && !process.env.CI;
const SHOW_WAIT_MS = 5_000;

/**
 * The app's window, shown. Under xvfb a never-shown window gets about one animation frame a second,
 * or none, so Playwright's "stable" check hangs; the app shows it on its first paint, which a
 * cold launch can delay. If it isn't shown after a few seconds, show it (and say so in the log).
 */
export async function shownWindow(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow();
  if (HIDDEN_RUN) return window;
  const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
  const deadline = Date.now() + SHOW_WAIT_MS;
  while (!(await visible()) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (!(await visible())) {
    console.log(`e2e: the window was still hidden after ${SHOW_WAIT_MS / 1000} s; showing it`);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
  }
  expect(await visible(), 'the app window is shown').toBe(true);
  return window;
}

// Opens a project folder (or its cfbs.json) the way File > Open Recent does, with no native dialog.
export const openFromMenu = (app: ElectronApplication, path: string) =>
  app.evaluate(({ BrowserWindow }, target) => BrowserWindow.getAllWindows()[0].webContents.send('menu:open-recent', target), path);

export const windowTitle = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
