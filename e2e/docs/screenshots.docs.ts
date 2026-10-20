import { type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join, resolve } from 'path';

import { expect, test } from '../fixtures';

// Where the docs pages are: ../documentation/content/policy-builder unless DOCS_SCREENSHOTS says.
const OUT = resolve(process.env.DOCS_SCREENSHOTS ?? join(__dirname, '../../../documentation/content/policy-builder'));
const SIZE = { width: 1440, height: 900 };

async function prepare(app: ElectronApplication, window: Page) {
  await app.evaluate(({ BrowserWindow, nativeTheme }, size) => {
    nativeTheme.themeSource = 'light';
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
  }, SIZE);
  await window.emulateMedia({ colorScheme: 'light' });
}

// After the UI settles: no hover, nothing animating. Prefixed: image names are unique across the docs.
async function shot(window: Page, name: string) {
  await window.mouse.move(0, 0);
  await window.waitForTimeout(500);
  await window.screenshot({ path: join(OUT, `policy-builder-${name}.png`), animations: 'disabled' });
}

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

test('the demo project', async ({ app, window }) => {
  await prepare(app, window);
  await window.getByText(/^Try Demo:/).click();
  await expect(window.locator('footer').getByText('Project: Nginx Web Server Demo')).toBeVisible();
  await shot(window, 'window');

  await window.getByText('Install web server package', { exact: true }).first().click();
  await expect(window.getByText('Package name').first()).toBeVisible();
  await shot(window, 'block-properties');

  await window.getByRole('tab', { name: 'Generated Policy (.cf)' }).click();
  await expect(window.getByText('Generating the policy…')).toBeHidden({ timeout: 30_000 });
  await expect(window.getByText(/bundle agent/).first()).toBeVisible();
  await shot(window, 'generated-policy-view');

  await window.getByRole('tab', { name: 'Test Results & Logs' }).click();
  await expect(window.getByText('Checking Docker…')).toBeHidden({ timeout: 30_000 });
  await shot(window, 'tests-and-logs-view');

  await window.getByRole('tab', { name: 'Deployment' }).click();
  await shot(window, 'deployment-view');

  await window.getByRole('tab', { name: 'Canvas' }).click();
  await window.getByRole('navigation', { name: 'Side bar views' }).getByRole('button', { name: 'Modules' }).click();
  await expect(window.getByPlaceholder('Search modules, promise types…')).toBeVisible();
  await shot(window, 'modules-view');

  await window.getByText('clamav', { exact: true }).first().click();
  await expect(window.getByRole('heading', { name: 'clamav', exact: true })).toBeVisible();
  await shot(window, 'module-page');
});

test('a new project', async ({ app, window }) => {
  await prepare(app, window);
  await window.getByRole('button', { name: 'New Project' }).click();
  await expect(window.getByRole('dialog', { name: 'New Project' })).toBeVisible();
  await shot(window, 'new-project-dialog');
});
