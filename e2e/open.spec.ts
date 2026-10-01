import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// Opening projects from disk. Fixtures are written directly, and opened the way the File > Open
// Recent menu does it, so no native dialog is involved. Saving runs the Python sidecar's compiler.
const appEntry = resolve(__dirname, '../out/main/index.js');

let app: ElectronApplication;
let window: Page;
let scratchDir: string;
const consoleErrors: string[] = [];

const SAVE_TIMEOUT_MS = 20_000;

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf-8'));

// A project folder: its cfbs.json and, for a builder project, .policy-builder/project.json.
function writeProject(folder: string, cfbs: object, builder?: object): string {
  const path = join(scratchDir, folder);
  mkdirSync(path);
  writeFileSync(join(path, 'cfbs.json'), JSON.stringify(cfbs, null, 2));
  if (builder) {
    mkdirSync(join(path, '.policy-builder'));
    writeFileSync(join(path, '.policy-builder/project.json'), JSON.stringify(builder, null, 2));
  }
  return path;
}

const builderJson = (path: string) => readJson(join(path, '.policy-builder/project.json'));

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
      name: './web.cf',
      description: 'Local policy file added using cfbs command line',
      tags: ['local'],
      added_by: 'cfbs add',
      steps: ['copy ./web.cf services/cfbs/web.cf', 'policy_files services/cfbs/web.cf', 'bundles web']
    }
  ]
};

// Its .policy-builder/project.json.
const builderData = {
  schema_version: 1,
  folders: [],
  files: [
    {
      id: 'file-1',
      name: 'Web',
      bundle: 'web',
      path: './web.cf',
      blocks: [block('block-1', 'Say hello'), block('block-2', 'Say goodbye')],
      edges: [{ id: 'edge-1', source: 'block-1', target: 'block-2', outcomes: ['kept'] }],
      order: ['block-1', 'block-2'],
      layout: { positions: { 'block-1': { x: 0, y: 0 }, 'block-2': { x: 0, y: 200 } }, groups: [], derived_positions: {} }
    }
  ],
  current_file_id: 'file-1'
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
  const path = writeProject('web', builderProject, builderData);
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
    // Saving spawns the Python sidecar to generate the policy; a cold start can take a while.
    await expect(unsaved).toHaveCount(0, { timeout: SAVE_TIMEOUT_MS });
    const saved = readJson(join(path, 'cfbs.json'));
    expect(saved.build[0]).toEqual(builderProject.build[0]);
    expect(saved.build[1]).toEqual(builderProject.build[1]);
    expect(saved.meta).toBeUndefined();
    expect(builderJson(path).files[0].blocks).toHaveLength(3);
    expect(builderJson(path).files[0].edges).toHaveLength(1);
    const policy = readFileSync(join(path, 'web.cf'), 'utf-8');
    expect(policy).toContain('bundle agent web\n');
    expect(policy).toContain('  # Say goodbye\n');
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
  await expect
    .poll(() => (existsSync(join(path, '.policy-builder/project.json')) ? builderJson(path).schema_version : null), { timeout: SAVE_TIMEOUT_MS })
    .toBe(1);
  const saved = readJson(join(path, 'cfbs.json'));
  expect(saved.build[0]).toEqual(fake);
  expect(saved.build).toHaveLength(2);
  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test('a project from a newer builder does not open, and shows why', async () => {
  const path = writeProject('newer', builderProject, { ...builderData, schema_version: 99 });

  await openFromMenu(path);
  await expect(window.getByRole('alert')).toContainText('newer version of CFEngine Policy Builder');
  await expect(window.getByText(/^Try Demo:/)).toBeVisible();
});

test('opens a project whose builder data is still in cfbs.json, and moves it out on save', async () => {
  const path = writeProject('legacy', { ...builderProject, meta: { 'policy-builder': builderData, 'other-tool': { kept: true } } });
  const statusBar = window.locator('footer');

  await openFromMenu(path);
  await expect(statusBar.getByText('Blocks: 2', { exact: true })).toBeVisible();
  await window.getByRole('button', { name: /^Copy File\b/ }).click();
  await window.keyboard.press('ControlOrMeta+s');

  await expect
    .poll(() => (existsSync(join(path, '.policy-builder/project.json')) ? builderJson(path).files[0].blocks.length : 0), { timeout: SAVE_TIMEOUT_MS })
    .toBe(3);
  // Another tool's meta stays; the builder's moved to .policy-builder/.
  expect(readJson(join(path, 'cfbs.json')).meta).toEqual({ 'other-tool': { kept: true } });
  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test('Project Settings converts a policy set to a module and back', async () => {
  const path = writeProject('convert', builderProject, builderData);
  const statusBar = window.locator('footer');
  const settings = window.getByRole('button', { name: 'Project settings' });
  const store = async (as: 'Module' | 'Policy set') => {
    await settings.click();
    await window.getByRole('radio', { name: new RegExp(`^${as}`) }).check();
    await window.getByRole('button', { name: 'Save', exact: true }).last().click();
    await expect(window.getByRole('dialog')).toHaveCount(0, { timeout: SAVE_TIMEOUT_MS });
  };

  await openFromMenu(path);
  await expect(statusBar.getByText('Blocks: 2', { exact: true })).toBeVisible();

  await store('Module');
  const module = readJson(join(path, 'cfbs.json'));
  expect(module.type).toBe('module');
  // A module's cfbs.json name is its module name, derived from the project name.
  expect(module.name).toBe('web-hardening');
  expect(Object.keys(module.provides)).toEqual(['web-hardening']);
  expect(module.provides['web-hardening'].steps).toContain('bundles web');
  // Masterfiles (not ours) is kept; our own build module isn't.
  expect(module.build).toEqual([builderProject.build[0]]);
  await expect(window.locator('header').getByText('module', { exact: true })).toBeVisible();

  await store('Policy set');
  const policySet = readJson(join(path, 'cfbs.json'));
  expect(policySet.type).toBe('policy-set');
  expect(policySet.name).toBe('Web Hardening');
  expect(policySet.provides).toBeUndefined();
  expect(policySet.build).toEqual(builderProject.build);
  expect(consoleErrors, 'console errors during the run').toEqual([]);
});
