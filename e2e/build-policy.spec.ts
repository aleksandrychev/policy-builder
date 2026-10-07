import { type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { SAVE_TIMEOUT_MS, expect, test } from './fixtures';

// Building policy on the canvas, offline: projects are modules without git (no masterfiles download),
// created in the fixture's scratch folder.

const footer = (window: Page) => window.locator('footer');
const canvas = (window: Page) => window.locator('.react-flow');
const cardOf = (window: Page, label: string) => canvas(window).locator('.react-flow__node').filter({ hasText: label });
const paletteRow = (window: Page, name: string) => window.getByRole('button', { name: new RegExp(`^${name}\\b`) });

async function newProject(window: Page, name: string) {
  await window.getByRole('button', { name: 'New Project' }).click();
  const dialog = window.getByRole('dialog', { name: 'New Project' });
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByRole('radio', { name: /^Module/ }).check();
  await dialog.getByLabel('Initialize a git repository').uncheck();
  await expect(dialog.getByText(/^Will be created at:/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden({ timeout: SAVE_TIMEOUT_MS });
  await expect(footer(window).getByText(`Project: ${name}`)).toBeVisible();
}

// A real pointer drag: dnd-kit starts after 8 px of movement.
async function dragFromPalette(window: Page, blockName: string, to: { x: number; y: number }) {
  const row = paletteRow(window, blockName);
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 4 });
  await window.mouse.move(to.x, to.y, { steps: 10 });
  await window.mouse.up();
}

async function canvasPoint(window: Page, fx: number, fy: number) {
  const box = (await canvas(window).boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

// The Generated Policy tab's text, once it is up to date.
async function generatedPolicy(window: Page): Promise<string> {
  await window.getByRole('tab', { name: 'Generated Policy (.cf)' }).click();
  await expect(window.getByText('Up to date')).toBeVisible({ timeout: SAVE_TIMEOUT_MS });
  return window.locator('.cm-content').innerText();
}

const showCanvas = (window: Page) => window.getByRole('tab', { name: 'Canvas' }).click();

async function save(window: Page) {
  await window.keyboard.press('ControlOrMeta+s');
  await expect(window.getByLabel('Unsaved changes')).toHaveCount(0, { timeout: SAVE_TIMEOUT_MS });
}

const UNDO = 'ControlOrMeta+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';

// Adds a block by clicking its palette row (it gets selected), then names it.
async function addBlock(window: Page, blockName: string, label: string) {
  const row = paletteRow(window, blockName);
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await window.getByLabel('Label').fill(label);
  await expect(cardOf(window, label)).toBeVisible();
}

// Adding a block pans the canvas (animated): wait until the element stops moving.
async function settledBox(locator: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const box = JSON.stringify(await locator.boundingBox());
      const settled = box === last;
      last = box;
      return settled;
    })
    .toBe(true);
  return JSON.parse(last) as { height: number; width: number; x: number; y: number };
}

const clickPane = (window: Page) =>
  canvas(window)
    .locator('.react-flow__pane')
    .click({ position: { x: 5, y: 5 } });

test('drag a block in, edit it, save and reopen', async ({ window, scratchDir, consoleErrors }) => {
  await newProject(window, 'Build E2E');

  await test.step('drag Manage Service from the palette onto the canvas', async () => {
    await dragFromPalette(window, 'Manage Service', await canvasPoint(window, 0.5, 0.4));
    await expect(footer(window).getByText('Blocks: 1', { exact: true })).toBeVisible();
    await expect(cardOf(window, 'Manage Service')).toBeVisible();
  });

  await test.step('edit its label and service name in Properties', async () => {
    await cardOf(window, 'Manage Service').click();
    await window.getByLabel('Label').fill('Keep sshd running');
    await window.getByLabel('Service name').fill('sshd');
    await expect(cardOf(window, 'Keep sshd running')).toBeVisible();
  });

  await test.step('Generated Policy shows it; clicking its code selects the block', async () => {
    await clickPane(window);
    const policy = await generatedPolicy(window);
    expect(policy).toContain('"sshd"');
    expect(policy).toContain('# Keep sshd running');
    await expect(window.locator('.cm-selected-block')).toHaveCount(0);
    await expect(window.locator('.cm-block-bar[title="Keep sshd running · Manage Service"]').first()).toBeAttached();
    await window.locator('.cm-line').filter({ hasText: '"sshd"' }).first().click();
    await expect(window.locator('.cm-selected-block').first()).toBeVisible();
    await showCanvas(window);
    await expect(window.getByLabel('Label')).toHaveValue('Keep sshd running');
  });

  await test.step('save, reload and reopen from Recent projects', async () => {
    await save(window);
    await window.reload();
    await window.getByRole('button', { name: /^Build E2E/ }).click();
    await expect(footer(window).getByText('Blocks: 1', { exact: true })).toBeVisible();
    await cardOf(window, 'Keep sshd running').click();
    await expect(window.getByLabel('Service name')).toHaveValue('sshd');
  });

  // The policy file is named after the file's namespace.
  expect(readFileSync(join(scratchDir, 'projects/build-e2e/build_e2e.cf'), 'utf-8')).toContain('"sshd"');
  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test('conditions, arrows and undo/redo', async ({ window, consoleErrors }) => {
  await newProject(window, 'Flow E2E');
  await addBlock(window, 'Manage Service', 'Start web');
  await window.getByLabel('Service name').fill('nginx');
  await addBlock(window, 'Manage Service', 'Start db');
  await window.getByLabel('Service name').fill('postgresql');

  await test.step('the second block runs only on linux', async () => {
    await window.getByRole('button', { name: 'Condition (0)' }).click();
    await window.getByRole('button', { name: 'Add condition' }).click();
    await window.getByPlaceholder('Search class names…').fill('linux');
    await window.getByRole('option', { name: /^linux Linux kernel/ }).click();
  });

  // An arrow's outcome chip (the condition's dashed link is an edge too).
  const chip = canvas(window).getByTitle('Change or remove this arrow');
  await test.step('an arrow from the first block to the second', async () => {
    const from = await settledBox(cardOf(window, 'Start web').locator('.react-flow__handle[data-handleid="out"]'));
    const to = await settledBox(cardOf(window, 'Start db').locator('.react-flow__handle[data-handleid="in"]'));
    await window.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await window.mouse.down();
    await window.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await window.mouse.up();
    await expect(chip).toHaveCount(1);
  });

  const before = await chip.innerText();
  await test.step('the arrow also fires when the first block fails', async () => {
    await chip.click();
    await window.getByRole('menuitem', { name: /not kept/ }).click();
    await window.keyboard.press('Escape');
    await expect(chip).not.toHaveText(before);
  });
  const after = await chip.innerText();

  const policy = await generatedPolicy(window);
  expect(policy).toContain('classes => default:results("bundle", "start_web")');
  expect(policy).toContain('if => "default:linux.(start_web_kept|start_web_not_kept)"');
  await showCanvas(window);

  await test.step('undo takes back the outcome, then the arrow; redo re-applies both', async () => {
    await clickPane(window);
    await window.keyboard.press(UNDO);
    await expect(chip).toHaveText(before);
    await window.keyboard.press(UNDO);
    await expect(chip).toHaveCount(0);
    await window.keyboard.press(REDO);
    await expect(chip).toHaveText(before);
    await window.keyboard.press(REDO);
    await expect(chip).toHaveText(after);
  });

  expect(await generatedPolicy(window)).toBe(policy);
  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test('files: description, copy and paste between files, delete and undo', async ({ window, consoleErrors }) => {
  await newProject(window, 'Files E2E');
  await addBlock(window, 'Manage Service', 'Start web');
  await window.getByLabel('Service name').fill('nginx');

  await test.step('add a second file and describe it', async () => {
    await window.getByTitle('New file').click();
    await window.keyboard.type('Extras');
    await window.keyboard.press('Enter');
    await window.getByText('Extras.cf', { exact: true }).click();
    await expect(footer(window).getByText('File: Extras.cf')).toBeVisible();
    await window.getByLabel('Description').fill('Extra checks for E2E');
  });

  await test.step('hovering the file name shows the description', async () => {
    await window.getByText('Extras.cf', { exact: true }).hover();
    await expect(window.getByRole('tooltip')).toHaveText('Extra checks for E2E');
  });

  await test.step('the generated file starts with it', async () => {
    expect(await generatedPolicy(window)).toContain('# Extra checks for E2E');
    await showCanvas(window);
  });

  await test.step('copy a block, switch file, paste', async () => {
    await window.getByText('Files E2E.cf', { exact: true }).click();
    await cardOf(window, 'Start web').click();
    await window.keyboard.press('ControlOrMeta+c');
    await window.getByText('Extras.cf', { exact: true }).click();
    await expect(footer(window).getByText('Blocks: 0', { exact: true })).toBeVisible();
    await clickPane(window);
    await window.keyboard.press('ControlOrMeta+v');
    await expect(cardOf(window, 'Start web')).toBeVisible();
    await expect(footer(window).getByText('Blocks: 1', { exact: true })).toBeVisible();
  });

  await test.step('delete the file after confirming, undo brings it back', async () => {
    await window.getByText('Extras.cf', { exact: true }).hover();
    await window.getByRole('button', { name: /^Delete Extras/ }).click();
    const confirm = window.getByRole('dialog', { name: 'Delete policy file' });
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(confirm).toBeHidden();
    await expect(window.getByText('Extras.cf', { exact: true })).toHaveCount(0);
    await clickPane(window);
    await window.keyboard.press(UNDO);
    await window.getByText('Extras.cf', { exact: true }).click();
    await expect(footer(window).getByText('Blocks: 1', { exact: true })).toBeVisible();
  });

  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test('groups: group two blocks and name the group', async ({ window, consoleErrors }) => {
  await newProject(window, 'Groups E2E');
  await addBlock(window, 'Manage Service', 'Start web');
  await window.getByLabel('Service name').fill('nginx');
  await addBlock(window, 'Manage Service', 'Start db');
  await window.getByLabel('Service name').fill('postgresql');

  await cardOf(window, 'Start web').click();
  await cardOf(window, 'Start db').click({ modifiers: ['Shift'] });
  await expect(window.getByText('2 blocks selected')).toBeVisible();
  await window.getByRole('button', { name: /^Group them/ }).click();
  await window.getByLabel('Group name').fill('Web stack');

  const policy = await generatedPolicy(window);
  expect(policy).toContain('usebundle => web_stack');
  expect(policy).toContain('bundle agent web_stack');
  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test('Define Variable: a literal value and a computed one', async ({ window, consoleErrors }) => {
  await newProject(window, 'Vars E2E');
  await addBlock(window, 'Define Variable', 'Settings');

  await test.step('a literal value, typed in the value editor', async () => {
    await window.getByLabel('Variable name').fill('greeting');
    await window.getByLabel('Value', { exact: true }).click();
    const editor = window.getByRole('dialog', { name: 'Value' });
    await editor.locator('.cm-content').click();
    await window.keyboard.type('hello e2e');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();
  });

  await test.step('a second variable from the environment, uppercased', async () => {
    await window.getByRole('button', { name: 'Add another variable' }).click();
    await window.getByLabel('Variable name').fill('home_upper');
    await window.getByLabel('Value source').click();
    await window.getByRole('option', { name: 'Environment variable' }).click();
    await window.getByLabel('Environment variable name').fill('HOME');
    await window.getByRole('button', { name: /^Data transformation/ }).click();
    // The canvas's data-chain node has one too; Properties comes after it.
    await window.getByRole('button', { name: 'Add transform' }).last().click();
    await window.getByRole('menuitem', { name: 'Uppercase' }).click();
  });

  const policy = await generatedPolicy(window);
  expect(policy).toContain('"greeting" string => "hello e2e";');
  expect(policy).toContain('"home_upper" string => string_upcase(getenv("HOME", "1024"));');
  expect(consoleErrors, 'console errors during the run').toEqual([]);
});
