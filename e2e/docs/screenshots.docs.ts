import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { expect, test } from '../fixtures';

// Where the docs pages are: ../documentation/content/policy-builder unless DOCS_SCREENSHOTS says.
// Run with CFPB_NETWORK_TESTS=1 (the real module catalog, masterfiles) and Docker running (test runs).
const OUT = resolve(process.env.DOCS_SCREENSHOTS ?? join(__dirname, '../../../documentation/content/policy-builder'));
const SIZE = { width: 1440, height: 900 };
const FIRST_PROJECT = '/Users/Shared/my-first-project';

async function prepare(app: ElectronApplication, window: Page) {
  await app.evaluate(({ BrowserWindow, nativeTheme }, size) => {
    nativeTheme.themeSource = 'light';
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
  }, SIZE);
  await window.emulateMedia({ colorScheme: 'light' });
}

type Clip = { height: number; width: number; x: number; y: number };

// After the UI settles: no hover, nothing animating. Prefixed: image names are unique across the docs.
async function shot(window: Page, name: string, clip?: Clip) {
  await window.mouse.move(0, 0);
  await window.waitForTimeout(500);
  await window.screenshot({ path: join(OUT, `policy-builder-${name}.png`), animations: 'disabled', clip });
}

const canvas = (window: Page) => window.locator('.react-flow');
const cardOf = (window: Page, label: string) => canvas(window).locator('.react-flow__node').filter({ hasText: label }).first();
const boxOf = async (locator: Locator) => (await locator.boundingBox())!;

// The union of some blocks' boxes, on screen.
async function boxAround(window: Page, labels: string[]): Promise<Clip> {
  const boxes = await Promise.all(labels.map(label => boxOf(cardOf(window, label))));
  const x = Math.min(...boxes.map(box => box.x));
  const y = Math.min(...boxes.map(box => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map(box => box.x + box.width)) - x,
    height: Math.max(...boxes.map(box => box.y + box.height)) - y
  };
}

// Zooms in (the toolbar's Zoom in), then pans the blocks to the canvas's middle (the wheel pans here).
async function focus(window: Page, labels: string[], zoomIns = 3) {
  await window.getByTitle('Fit to screen (1)').click();
  for (let i = 0; i < zoomIns; i++) await window.getByTitle('Zoom in (+)').click();
  await window.waitForTimeout(500);
  const area = await boxOf(canvas(window));
  for (let i = 0; i < 4; i++) {
    const box = await boxAround(window, labels);
    const dx = box.x + box.width / 2 - (area.x + area.width / 2);
    const dy = box.y + box.height / 2 - (area.y + area.height / 2);
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) break;
    await window.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await window.mouse.wheel(dx, dy);
    await window.waitForTimeout(400);
  }
}

// The whole canvas, toolbar and minimap included.
const canvasClip = async (window: Page) => boxOf(canvas(window));

// A close-up: the blocks with room around them, within the canvas.
async function clipAround(window: Page, labels: string[], pad = 60): Promise<Clip> {
  const box = await boxAround(window, labels);
  const area = await boxOf(canvas(window));
  const x = Math.max(area.x, box.x - pad);
  const y = Math.max(area.y, box.y - pad);
  return { x, y, width: Math.min(area.x + area.width, box.x + box.width + pad) - x, height: Math.min(area.y + area.height, box.y + box.height + pad) - y };
}

// The Properties panel: from its heading to the window's right and bottom edges.
async function propertiesClip(window: Page): Promise<Clip> {
  const heading = await boxOf(window.getByText('Properties', { exact: true }).first());
  const x = heading.x - 24;
  return { x, y: heading.y - 24, width: SIZE.width - x, height: SIZE.height - heading.y + 24 - 30 };
}

// Replaces a text setting's content in its editor dialog.
async function editText(window: Page, label: string, text: string) {
  await window.getByLabel(label, { exact: true }).click();
  const editor = window.getByRole('dialog', { name: label });
  await editor.locator('.cm-content').click();
  await window.keyboard.press('ControlOrMeta+a');
  await window.keyboard.insertText(text);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
}

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

test('the demo project', async ({ app, window }) => {
  test.setTimeout(240_000);
  await prepare(app, window);
  await window.getByText(/^Try Demo:/).click();
  await expect(window.locator('footer').getByText('Project: Nginx Web Server Demo')).toBeVisible();
  await shot(window, 'window');

  await test.step('each configuration canvas', async () => {
    for (const [file, name] of [
      ['Common.cf', 'demo-common'],
      ['Security.cf', 'demo-security'],
      ['Webserver.cf', 'demo-webserver']
    ]) {
      await window.getByText(file, { exact: true }).click();
      await window.getByTitle('Fit to screen (1)').click();
      await window.waitForTimeout(500);
      await shot(window, name, await canvasClip(window));
    }
  });

  await test.step('the Configurations list', async () => {
    // The side bar from the Configurations heading down to the Modules row.
    const heading = await boxOf(window.getByText('Configurations', { exact: true }).first());
    const bar = await boxOf(window.locator('nav[aria-label="Side bar views"]'));
    const footer = await boxOf(window.locator('footer'));
    const left = bar.x + bar.width;
    const folderButton = await boxOf(window.getByTitle('New folder').first());
    const right = folderButton.x + folderButton.width + 20;
    await shot(window, 'configurations', { x: left, y: heading.y - 20, width: right - left, height: footer.y - heading.y + 20 });
  });

  await test.step('the window, its parts numbered', async () => {
    // Numbered badges on each part, as the index lists them; removed after the shot.
    await window.evaluate(() => {
      const at = (element: Element | null | undefined, dx: number, dy: number) => {
        const box = element?.getBoundingClientRect();
        return box ? { x: box.left + dx, y: box.top + dy } : null;
      };
      const textOf = (text: string) => [...document.querySelectorAll('*')].find(node => node.childElementCount === 0 && node.textContent === text);
      const spots = [
        at(document.querySelector('[role="tablist"]'), -14, 8),
        at(document.querySelector('nav[aria-label="Side bar views"]'), 9, 150),
        at(textOf('Blocks'), 70, -2),
        at(textOf('Configurations'), 175, -2),
        at(document.querySelector('.react-flow'), 24, 24),
        at(textOf('Properties'), 125, -2),
        at(document.querySelector('footer'), 62, -12)
      ];
      spots.forEach((spot, index) => {
        if (!spot) return;
        const badge = document.createElement('div');
        badge.className = 'docs-badge';
        badge.textContent = String(index + 1);
        Object.assign(badge.style, {
          position: 'fixed',
          left: `${spot.x}px`,
          top: `${spot.y}px`,
          width: '26px',
          height: '26px',
          borderRadius: '13px',
          background: '#e8541e',
          color: 'white',
          font: '700 15px/26px sans-serif',
          textAlign: 'center',
          zIndex: '100000',
          boxShadow: '0 1px 4px rgba(0,0,0,0.35)'
        });
        document.body.appendChild(badge);
      });
    });
    await shot(window, 'window-parts');
    await window.evaluate(() => document.querySelectorAll('.docs-badge').forEach(badge => badge.remove()));
  });

  await test.step('a block, its condition and arrows, close up', async () => {
    await cardOf(window, 'Install web server package').click();
    await expect(window.getByText('Package name').first()).toBeVisible();
    await shot(window, 'block-properties', await propertiesClip(window));
    const shown = ['Install web server package', 'Keep nginx running', 'Render nginx config', 'Restart nginx on config change'];
    await focus(window, [...shown, 'only if'], 2);
    await shot(window, 'canvas-arrows', await clipAround(window, [...shown, 'only if']));
    const chip = canvas(window)
      .getByTitle('Change or remove this arrow')
      .filter({ hasText: /^↻ repaired$/ })
      .first();
    await chip.click();
    await expect(window.getByRole('menuitem', { name: /not kept/ })).toBeVisible();
    // Measured once it has finished opening (it grows in).
    await window.waitForTimeout(600);
    const menu = await boxOf(window.getByRole('menu'));
    const around = await clipAround(window, ['Render nginx config', 'Restart nginx on config change'], 40);
    const x = Math.min(around.x, menu.x - 20);
    const y = Math.min(around.y, menu.y - 20);
    await shot(window, 'outcome-menu', {
      x,
      y,
      width: Math.max(around.x + around.width, menu.x + menu.width + 20) - x,
      height: Math.max(around.y + around.height, menu.y + menu.height + 20) - y
    });
    await window.keyboard.press('Escape');
  });

  await test.step('the template editor', async () => {
    await cardOf(window, 'Render nginx config').click();
    await window.getByLabel('Template content', { exact: true }).click();
    await expect(window.getByRole('dialog', { name: 'Template content' })).toBeVisible();
    await shot(window, 'template-editor');
    await window.getByRole('dialog', { name: 'Template content' }).getByRole('button', { name: 'Cancel' }).click();
  });

  await test.step('a group', async () => {
    const grouped = ['Render nginx config', 'Restart nginx on config change'];
    await focus(window, grouped, 3);
    const box = await boxAround(window, grouped);
    // A box selection: Shift and drag around both blocks, from the empty canvas beside them.
    await window.keyboard.down('Shift');
    await window.mouse.move(box.x - 20, box.y - 20);
    await window.mouse.down();
    await window.mouse.move(box.x + box.width + 20, box.y + box.height + 20, { steps: 10 });
    await window.mouse.up();
    await window.keyboard.up('Shift');
    await window.keyboard.press('ControlOrMeta+g');
    await window.getByLabel('Group name').fill('Configure nginx');
    await window.getByTitle('Tidy up').click();
    await window.getByRole('dialog', { name: 'Tidy up this canvas?' }).getByRole('button', { name: 'Tidy up' }).click();
    await focus(window, grouped, 2);
    await shot(window, 'group', await clipAround(window, grouped, 70));
    // Undone (the name, then the group), from the canvas: in the name field ⌘Z is the field's own.
    await canvas(window)
      .locator('.react-flow__pane')
      .click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 3; i++) await window.keyboard.press('ControlOrMeta+z');
    await expect(window.getByText('Configure nginx')).toHaveCount(0);
  });

  await test.step('a variable computed with transforms', async () => {
    // The canvas draws a variable's transforms as a card of their own, next to its block.
    await window.getByText('Common.cf', { exact: true }).click();
    const shown = ['Data transformer', 'Nginx settings'];
    await focus(window, shown, 1);
    await shot(window, 'transforms', await clipAround(window, shown, 40));
    await window.getByText('Webserver.cf', { exact: true }).click();
  });

  await test.step('Generated Policy', async () => {
    await cardOf(window, 'Install web server package').click();
    await window.getByRole('tab', { name: 'Generated Policy (.cf)' }).click();
    await expect(window.getByText('Generating the policy…')).toBeHidden({ timeout: 30_000 });
    await expect(window.getByText(/bundle agent/).first()).toBeVisible();
    await shot(window, 'generated-policy-view');
    await window.getByRole('tab', { name: 'Canvas' }).click();
  });

  await test.step('modules', async () => {
    await window.getByRole('navigation', { name: 'Side bar views' }).getByRole('button', { name: 'Modules' }).click();
    const search = window.getByPlaceholder('Search modules, promise types…');
    await expect(search).toBeVisible();
    await expect(window.getByText(/^\d+ available$/)).toBeVisible({ timeout: 30_000 });
    await shot(window, 'modules-view');
    await search.fill('promise-type-git');
    await window.getByText('promise-type-git', { exact: true }).first().click();
    await expect(window.getByRole('heading', { name: 'promise-type-git', exact: true })).toBeVisible();
    await expect(window.getByText(/^Loading the description/)).toBeHidden({ timeout: 30_000 });
    await shot(window, 'module-page');
    await search.fill('delete-files');
    await window.getByText('delete-files', { exact: true }).first().click();
    await window.getByRole('button', { name: 'Add to project' }).click();
    await window.getByRole('tab', { name: 'Input' }).click();
    await window.getByRole('button', { name: 'Add', exact: true }).last().click();
    await window.getByRole('textbox', { name: 'Path' }).first().fill('/etc/hosts.equiv');
    await shot(window, 'module-input');
    await window.getByRole('button', { name: /Back to Canvas/ }).click();
  });

  await test.step('connecting an AI agent', async () => {
    await window.getByRole('button', { name: 'AI agent' }).click();
    const dialog = window.getByRole('dialog', { name: 'Connect an AI agent' });
    await dialog.getByText('Let AI agents connect').click();
    await expect(dialog.getByRole('button', { name: 'Copy', exact: true })).toBeVisible({ timeout: 15_000 });
    await shot(window, 'connect-agent-dialog');

    // An agent at work: connected as Claude Code would be, with the address and token the dialog shows.
    const snippet = await dialog.locator('pre').innerText();
    const url = snippet.match(/http:\/\/127\.0\.0\.1:\d+\/mcp/)![0];
    const token = snippet.match(/Bearer ([\w-]+)/)![1];
    await dialog.getByRole('button', { name: 'Done' }).click();
    const agent = new Client({ name: 'docs-screenshots', version: '1.0.0' });
    await agent.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await agent.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
      return result.content[0]?.text ?? '';
    };
    await window.getByRole('navigation', { name: 'Side bar views' }).getByRole('button', { name: 'Blocks and files' }).click();
    await call('begin_work', { task: 'Adding a firewall to the web servers' });
    const overview = JSON.parse(await call('get_project_overview')) as { files: { id: string; name: string }[] };
    const fileId = overview.files.find(file => file.name === 'Webserver')!.id;
    await call('add_block', { fileId, blockType: 'install-package', label: 'Install the firewall', params: { package_name: 'ufw' } });
    await call('add_block', { fileId, blockType: 'manage-service', label: 'Keep the firewall running', params: { service_name: 'ufw' } });
    await window.getByRole('button', { name: 'Log', exact: true }).click();
    // The log panel opens collapsed at the bottom: expanded, so its steps show.
    await window.getByRole('button', { name: 'Show the log' }).click();
    await window.waitForTimeout(500);
    await shot(window, 'agent-working');
    await call('end_work', { summary: 'Added the firewall: installed and kept running.' });
    await agent.close();
  });
});

test('the New Project dialog', async ({ app, window, scratchDir }) => {
  await prepare(app, window);
  // A neutral location instead of the run's temporary folder: settings are read as the dialog opens.
  writeFileSync(join(scratchDir, 'user-data/app-settings.json'), JSON.stringify({ lastProjectParent: '/Users/Shared' }));
  await window.getByRole('button', { name: 'New Project' }).click();
  const dialog = window.getByRole('dialog', { name: 'New Project' });
  await dialog.getByLabel('Project name').fill('Web servers');
  await dialog.getByLabel('Description').fill('Nginx on every web server, with its configuration and landing page.');
  await expect(dialog.getByText(/^Will be created at:/)).toBeVisible();
  await shot(window, 'new-project-dialog');
});

// A project built from scratch, for the test run, Deployment and host settings shots: needs the network and Docker.
test('a project of your own', async ({ app, window, scratchDir }) => {
  test.setTimeout(1_200_000);
  await prepare(app, window);
  // In a folder whose path reads well in the status bar; removed before and after.
  for (const path of [FIRST_PROJECT, `${FIRST_PROJECT}.git`]) rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  writeFileSync(join(scratchDir, 'user-data/app-settings.json'), JSON.stringify({ lastProjectParent: '/Users/Shared' }));
  test.info().attach('folder', { body: FIRST_PROJECT });

  await test.step('create it', async () => {
    await window.getByRole('button', { name: 'New Project' }).click();
    const dialog = window.getByRole('dialog', { name: 'New Project' });
    await dialog.getByLabel('Project name').fill('My first project');
    await dialog.getByLabel('Description').fill('Installs tree and reports it.');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden({ timeout: 300_000 });
  });

  await test.step('two blocks and an arrow', async () => {
    await window.getByPlaceholder('Search blocks…').fill('Install Package');
    await window.getByRole('button', { name: /^Install Package\b/ }).click();
    await window.getByLabel('Label').fill('Install tree');
    await editText(window, 'Package name', 'tree');
    await window.getByPlaceholder('Search blocks…').fill('Report Message');
    await window.getByRole('button', { name: /^Report Message\b/ }).click();
    await window.getByLabel('Label').fill('Report tree');
    await editText(window, 'Message', 'tree is installed');
    await window.getByTitle('Tidy up').click();
    await window.getByRole('dialog', { name: 'Tidy up this canvas?' }).getByRole('button', { name: 'Tidy up' }).click();
    await window.getByTitle('Fit to screen (1)').click();
    await window.waitForTimeout(600);
    const from = await boxOf(cardOf(window, 'Install tree').locator('.react-flow__handle[data-handleid="out"]'));
    const to = await boxOf(cardOf(window, 'Report tree').locator('.react-flow__handle[data-handleid="in"]'));
    await window.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await window.mouse.down();
    await window.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await window.mouse.up();
    await expect(canvas(window).getByTitle('Change or remove this arrow')).toHaveCount(1);
    await window.keyboard.press('ControlOrMeta+s');
    await expect(window.getByLabel('Unsaved changes')).toHaveCount(0, { timeout: 60_000 });
    await cardOf(window, 'Install tree').click();
  });

  await test.step('a test run', async () => {
    await window.getByRole('tab', { name: 'Test Results & Logs' }).click();
    await window.getByRole('button', { name: 'Create test environment' }).click();
    const deployAndRun = window.getByRole('button', { name: 'Deploy & run', exact: true });
    await deployAndRun.click();
    await expect(window.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(deployAndRun).toBeVisible({ timeout: 900_000 });
    await expect(window.getByText('Converged', { exact: true }).first()).toBeVisible();
    await window.getByPlaceholder('Filter logs…').fill('tree is installed');
    await shot(window, 'tests-and-logs-view');
    await window.getByPlaceholder('Filter logs…').fill('');
    // A running host's settings: the docker exec command for a shell in it.
    await window.getByRole('button', { name: 'Host settings' }).first().click();
    const settings = window.getByRole('dialog', { name: 'Host settings' });
    await expect(settings.getByRole('textbox', { name: 'Shell in this container' })).toHaveValue(/^docker exec -it /);
    await window.waitForTimeout(400);
    const box = await boxOf(settings);
    await shot(window, 'host-settings', { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 });
    await window.keyboard.press('Escape');
    await expect(settings).toBeHidden();
  });

  await test.step('committed, pushed and checked', async () => {
    const remote = `${FIRST_PROJECT}.git`;
    execFileSync('git', ['init', '--quiet', '--bare', remote]);
    // Creating the test environment was an edit: saved first.
    await window.keyboard.press('ControlOrMeta+s');
    await expect(window.getByLabel('Unsaved changes')).toHaveCount(0, { timeout: 60_000 });
    await window.getByRole('tab', { name: 'Deployment' }).click();
    await window.getByRole('tab', { name: /Git repository/ }).click();
    // With no remote yet, the tab asks for one.
    await window.getByLabel('Remote (origin)').fill(remote);
    await window.getByRole('button', { name: 'Set', exact: true }).click();
    await expect(window.getByLabel('Remote (origin)')).toBeHidden({ timeout: 30_000 });
    await window.getByRole('button', { name: /^(Commit & push|Push)$/ }).click();
    const ship = window.getByRole('dialog');
    const message = ship.getByLabel('Commit message');
    if (await message.isVisible()) await message.fill('Installed tree, with a report');
    await ship.getByRole('button', { name: /^(Commit & push|Push|Ship anyway)$/ }).click();
    await expect(window.getByText(/^Pushed [0-9a-f]+ to /)).toBeVisible({ timeout: 120_000 });
    await window.getByRole('button', { name: 'Run pre-flight' }).click();
    await expect(window.getByText('Checks out', { exact: true })).toBeVisible({ timeout: 300_000 });
    await shot(window, 'deployment-view');
  });
  // The test host goes too: Purge all removes the environment's containers and network.
  await window.getByRole('tab', { name: 'Test Results & Logs' }).click();
  await window.getByRole('button', { name: 'Purge all' }).click();
  await expect(window.getByText('Not set up', { exact: true })).toBeVisible({ timeout: 120_000 });
  for (const path of [FIRST_PROJECT, `${FIRST_PROJECT}.git`]) rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
});
