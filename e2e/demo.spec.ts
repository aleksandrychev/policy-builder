import { expect, test } from './fixtures';

test('demo project: switch files, delete + undo, add and rename a block', async ({ app, window, consoleErrors }) => {
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
