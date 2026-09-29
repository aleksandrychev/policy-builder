import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// Opening projects from disk. Fixtures are written directly (no Python sidecar needed), and opened
// the way the File > Open Recent menu does it, so no native dialog is involved.
const appEntry = resolve(__dirname, '../out/main/index.js');

let app: ElectronApplication;
let window: Page;
let scratchDir: string;
const consoleErrors: string[] = [];

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf-8'));

function writeProject(folder: string, cfbs: object): string {
  const path = join(scratchDir, folder);
  mkdirSync(path);
  writeFileSync(join(path, 'cfbs.json'), JSON.stringify(cfbs, null, 2));
  return path;
}

const block = (instanceId: string, label: string) => ({
  instanceId,
  blockId: 'report-message',
  label,
  params: { message: `${label} from the E2E test` }
});

const builderProject = {
  name: 'Web Hardening',
  description: 'Opened by the E2E test',
  type: 'policy-set',
  build: [
    { name: 'masterfiles', version: '3.27.1', added_by: 'cfbs init' },
    {
      name: './policy/web.cf',
      description: 'Local policy file added using cfbs command line',
      tags: ['local'],
      added_by: 'cfbs add',
      steps: ['copy ./policy/web.cf services/cfbs/policy/web.cf', 'policy_files services/cfbs/policy/web.cf', 'bundles web:main']
    }
  ],
  meta: {
    'policy-builder': {
      schema_version: 1,
      folders: [],
      files: [
        {
          id: 'file-1',
          name: 'Web',
          namespace: 'web',
          path: './policy/web.cf',
          blocks: [block('block-1', 'Say hello'), block('block-2', 'Say goodbye')],
          edges: [{ id: 'edge-1', source: 'block-1', target: 'block-2', outcomes: ['kept'] }],
          order: ['block-1', 'block-2'],
          layout: { positions: { 'block-1': { x: 0, y: 0 }, 'block-2': { x: 0, y: 200 } }, groups: [], derived_positions: {} }
        }
      ],
      current_file_id: 'file-1'
    }
  }
};

const openFromMenu = (path: string) =>
  app.evaluate(({ BrowserWindow }, target) => BrowserWindow.getAllWindows()[0].webContents.send('menu:open-recent', target), path);

test.beforeEach(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), 'cfpb-e2e-open-'));
  const userDataDir = join(scratchDir, 'user-data');
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
  // The renderer listens for menu actions once it has rendered.
  await expect(window.getByText(/^Try Demo:/)).toBeVisible();
});

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures arg to be destructured
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && window) {
    const path = testInfo.outputPath('failure.png');
    await window.screenshot({ path });
    await testInfo.attach('screenshot', { path, contentType: 'image/png' });
  }
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
  await app?.close();
  rmSync(scratchDir, { recursive: true, force: true });
});

test('opens a builder project with its blocks and arrows, clean, and saves it back', async () => {
  const path = writeProject('web', builderProject);
  const statusBar = window.locator('footer');
  const unsaved = window.getByLabel('Unsaved changes');

  await test.step('opening loads the blocks and arrows, not dirty', async () => {
    await openFromMenu(path);
    await expect(statusBar.getByText('Project: Web Hardening')).toBeVisible();
    await expect(statusBar.getByText('Blocks: 2', { exact: true })).toBeVisible();
    await expect(window.locator('.react-flow').getByText('Say goodbye', { exact: true })).toBeVisible();
    await expect(window.locator('.react-flow__edge')).toHaveCount(1);
    await expect(unsaved).toHaveCount(0);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('Web Hardening — CFEngine Policy Builder');
  });

  await test.step('an edit makes it dirty, ⌘S writes it into cfbs.json', async () => {
    await window.getByRole('button', { name: /^Copy File\b/ }).click();
    await expect(statusBar.getByText('Blocks: 3', { exact: true })).toBeVisible();
    await expect(unsaved).toBeVisible();
    await window.keyboard.press('ControlOrMeta+s');
    await expect(unsaved).toHaveCount(0);
    const saved = readJson(join(path, 'cfbs.json'));
    expect(saved.build[0]).toEqual(builderProject.build[0]);
    expect(saved.build[1]).toEqual(builderProject.build[1]);
    expect(saved.meta['policy-builder'].files[0].blocks).toHaveLength(3);
    expect(saved.meta['policy-builder'].files[0].edges).toHaveLength(1);
  });

  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test('opens a plain cfbs project with one empty file, keeping its build entries on save', async () => {
  const fake = { name: 'some-module', version: '1.0.0', added_by: 'cfbs add', steps: ['copy a.cf services/a.cf'] };
  const path = writeProject('plain', { name: 'Plain Project', type: 'policy-set', description: '', build: [fake] });
  const statusBar = window.locator('footer');

  await openFromMenu(join(path, 'cfbs.json'));
  await expect(statusBar.getByText('Project: Plain Project')).toBeVisible();
  await expect(statusBar.getByText('Blocks: 0', { exact: true })).toBeVisible();
  await expect(statusBar.getByText('File: Plain Project.cf')).toBeVisible();
  await expect(window.getByLabel('Unsaved changes')).toHaveCount(0);

  await window.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => readJson(join(path, 'cfbs.json')).meta?.['policy-builder']?.schema_version).toBe(1);
  const saved = readJson(join(path, 'cfbs.json'));
  expect(saved.build[0]).toEqual(fake);
  expect(saved.build).toHaveLength(2);
  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test('a project from a newer builder does not open, and shows why', async () => {
  const path = writeProject('newer', { ...builderProject, meta: { 'policy-builder': { ...builderProject.meta['policy-builder'], schema_version: 99 } } });

  await openFromMenu(path);
  await expect(window.getByRole('alert')).toContainText('newer version of CFEngine Policy Builder');
  await expect(window.getByText(/^Try Demo:/)).toBeVisible();
});
