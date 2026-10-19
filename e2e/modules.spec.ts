import { type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { SAVE_TIMEOUT_MS, expect, test } from './fixtures';

// CFEngine Build modules: offline on the index and details in e2e/modules/; installing one with cfbs
// on save downloads it (and masterfiles), so that journey is opt-in with CFPB_NETWORK_TESTS=1.
const NETWORK = process.env.CFPB_NETWORK_TESTS === '1';

const activityBar = (window: Page) => window.getByRole('navigation', { name: 'Side bar views' });
const searchModules = (window: Page) => window.getByPlaceholder('Search modules, promise types…');

async function openModule(window: Page, name: string) {
  // Clicking the open view's icon would close it.
  if (!(await searchModules(window).isVisible())) await activityBar(window).getByRole('button', { name: 'Modules' }).click();
  await searchModules(window).fill(name);
  await window.getByText(name, { exact: true }).first().click();
  await expect(window.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('browse modules, open their pages, add one and answer its input', async ({ window, consoleErrors }) => {
  await window.getByText(/^Try Demo:/).click();
  await expect(window.locator('footer').getByText('Project: Nginx Web Server Demo')).toBeVisible();

  await test.step('a block search that finds nothing points at matching modules', async () => {
    await window.getByPlaceholder('Search blocks…').fill('clamav');
    await window.getByRole('button', { name: 'Browse modules…' }).click();
    await expect(searchModules(window)).toHaveValue('clamav');
    await expect(window.getByText('clamav', { exact: true }).first()).toBeVisible();
  });

  await test.step('a module’s page shows its README and links, as build.cfengine.com does', async () => {
    await window.getByText('clamav', { exact: true }).first().click();
    await expect(window.getByRole('heading', { name: 'clamav', exact: true })).toBeVisible();
    await expect(window.getByRole('heading', { name: 'cfengine-clamav' })).toBeVisible();
    await expect(window.getByRole('link', { name: /^Repository/ })).toHaveAttribute('href', /github\.com\/aleksandrychev\/cfengine-clamav/);
    await expect(window.getByText(/^Total downloads:/)).toBeVisible();
  });

  await test.step('adding a module with input asks for it, and answering clears the badge', async () => {
    await openModule(window, 'delete-files');
    await window.getByRole('button', { name: 'Add to project' }).click();
    await expect(activityBar(window).getByText('1')).toBeVisible();
    await window.getByRole('tab', { name: 'Input' }).click();
    await window.getByRole('button', { name: 'Add', exact: true }).last().click();
    await window.getByRole('textbox', { name: 'Path' }).fill('/etc/hosts.equiv');
    await expect(activityBar(window).getByText('1')).toBeHidden();
  });

  await test.step('undo takes the answer back', async () => {
    await window.getByRole('button', { name: /Back to Canvas/ }).click();
    await window.keyboard.press('ControlOrMeta+z');
    await expect(activityBar(window).getByText('1')).toBeVisible();
  });

  await test.step('a Git Checkout block brings its module, which stays while the block is there', async () => {
    await activityBar(window).getByRole('button', { name: 'Blocks and files' }).click();
    await window.getByPlaceholder('Search blocks…').fill('git');
    await window.getByRole('button', { name: /^Git Checkout/ }).click();
    await openModule(window, 'promise-type-git');
    await expect(window.getByText(/^Used by Git Checkout/)).toBeVisible();
    await expect(window.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });

  await test.step('Blocks and files leaves the module’s page for the canvas', async () => {
    await activityBar(window).getByRole('button', { name: 'Blocks and files' }).click();
    await expect(window.getByRole('heading', { name: 'promise-type-git', exact: true })).toBeHidden();
    await expect(window.getByPlaceholder('Search blocks…')).toBeVisible();
  });

  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test.describe('with network', () => {
  test.skip(!NETWORK, 'downloads masterfiles and modules: set CFPB_NETWORK_TESTS=1 to run');
  test.setTimeout(600_000);

  test('saving installs a module with cfbs, with its answers', async ({ window, scratchDir, consoleErrors }) => {
    await window.getByRole('button', { name: 'New Project' }).click();
    const dialog = window.getByRole('dialog', { name: 'New Project' });
    await dialog.getByLabel('Project name').fill('Modules');
    await dialog.getByLabel('Initialize a git repository').uncheck();
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden({ timeout: 300_000 });

    await openModule(window, 'delete-files');
    await window.getByRole('button', { name: 'Add to project' }).click();
    await window.getByRole('tab', { name: 'Input' }).click();
    await window.getByRole('button', { name: 'Add', exact: true }).last().click();
    await window.getByRole('textbox', { name: 'Path' }).fill('/etc/hosts.equiv');
    await window.keyboard.press('ControlOrMeta+s');
    await expect(window.getByLabel('Unsaved changes')).toHaveCount(0, { timeout: SAVE_TIMEOUT_MS * 5 });

    const folder = join(scratchDir, 'projects', readdirSync(join(scratchDir, 'projects'))[0]);
    const build = JSON.parse(readFileSync(join(folder, 'cfbs.json'), 'utf-8')).build as { name: string }[];
    expect(build.map(entry => entry.name)).toContain('delete-files');
    const input = JSON.parse(readFileSync(join(folder, 'delete-files', 'input.json'), 'utf-8'));
    expect(input[0].response).toEqual([{ path: '/etc/hosts.equiv', why: 'Unknown' }]);
    expect(consoleErrors, 'console errors during the run').toEqual([]);
  });
});
