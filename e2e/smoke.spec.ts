import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const appEntry = resolve(__dirname, '../out/main/index.js');

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
const consoleErrors: string[] = [];

test.beforeEach(async () => {
  // A throwaway profile, so the run never reads or writes the developer's layout settings.
  userDataDir = mkdtempSync(join(tmpdir(), 'cfpb-e2e-'));
  // ELECTRON_RUN_AS_NODE=1 would start Electron as plain Node, with no window.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<
    string,
    string
  >;
  app = await electron.launch({ args: [appEntry, `--user-data-dir=${userDataDir}`], env });
  window = await app.firstWindow();
  window.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  window.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
});

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures arg to be destructured
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && window) {
    const path = testInfo.outputPath('failure.png');
    await window.screenshot({ path });
    await testInfo.attach('screenshot', { path, contentType: 'image/png' });
  }
  // exit() skips the unsaved-changes prompt a plain close() would wait on.
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('demo project: switch files, delete + undo, add and rename a block', async () => {
  const statusBar = window.locator('footer');
  const blockCount = async () => Number((await statusBar.getByText(/^Blocks: \d+$/).textContent())?.match(/\d+/)?.[0]);

  await test.step('window opens on the start screen', async () => {
    await expect(window).toHaveTitle('CFEngine Policy Builder');
    await expect(window.getByText(/^Try Demo:/)).toBeVisible();
  });

  await test.step('Try Demo opens the demo project', async () => {
    await window.getByText(/^Try Demo:/).click();
    await expect(statusBar.getByText('Project: Nginx Web Server Demo')).toBeVisible();
    await expect(window.getByText('Configurations', { exact: true })).toBeVisible();
  });

  await test.step('switch between Common.cf and Webserver.cf', async () => {
    await window.getByText('Common.cf', { exact: true }).click();
    await expect(statusBar.getByText('File: Common.cf')).toBeVisible();
    await window.getByText('Webserver.cf', { exact: true }).click();
    await expect(statusBar.getByText('File: Webserver.cf')).toBeVisible();
    await expect(window.locator('.react-flow').getByText('Create deploy user', { exact: true })).toBeVisible();
  });

  await test.step('Delete removes the selected block, undo brings it back', async () => {
    const canvasBlock = window.locator('.react-flow').getByText('Create deploy user', { exact: true });
    const before = await blockCount();
    await canvasBlock.click();
    await expect(window.getByLabel('Label')).toHaveValue('Create deploy user');
    await window.keyboard.press('Delete');
    await expect(statusBar.getByText(`Blocks: ${before - 1}`, { exact: true })).toBeVisible();
    await expect(canvasBlock).toHaveCount(0);

    await window.keyboard.press('ControlOrMeta+z');
    await expect(statusBar.getByText(`Blocks: ${before}`, { exact: true })).toBeVisible();
    await expect(canvasBlock).toBeVisible();
  });

  await test.step('clicking a palette block adds it to the canvas', async () => {
    const before = await blockCount();
    // Palette rows are dnd-kit draggables (role=button) named "<block name> <promise type>".
    await window.getByRole('button', { name: /^Copy File\b/ }).click();
    await expect(statusBar.getByText(`Blocks: ${before + 1}`, { exact: true })).toBeVisible();
    await expect(window.getByLabel('Label')).toHaveValue('Copy File');
  });

  await test.step('editing the label in Properties updates the canvas', async () => {
    await window.getByLabel('Label').fill('Copy the motd');
    await expect(window.locator('.react-flow').getByText('Copy the motd', { exact: true })).toBeVisible();
  });

  await test.step('closing the window with unsaved changes asks first', async () => {
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()))
      .toBe('Nginx Web Server Demo — CFEngine Policy Builder');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const prompt = window.getByRole('dialog', { name: /save changes/i });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Cancel' }).click();
    await expect(prompt).toBeHidden();
  });

  expect(consoleErrors, 'console errors during the run').toEqual([]);
});
