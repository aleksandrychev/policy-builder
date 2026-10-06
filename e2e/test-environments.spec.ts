import { type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { expect, openFromMenu, test } from './fixtures';

// The Test Results & Logs tab. Running the demo on a Docker host is opt-in (CFPB_DOCKER_TESTS=1).
const DOCKER = process.env.CFPB_DOCKER_TESTS === '1';
// The demo environment's fixed id: Docker labels its containers and network with it.
const DEMO_ENV = 'demo-web-server';

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const dockerUp = () => {
  try {
    docker('info');
    return true;
  } catch {
    return false;
  }
};
const demoContainers = () => docker('ps', '-aq', '--filter', `label=cfpb.env=${DEMO_ENV}`).split('\n').filter(Boolean);

// A host card: the outlined paper around the host's name.
const hostCard = (window: Page, name: string): Locator =>
  window
    .getByRole('main')
    .locator('.MuiPaper-outlined')
    .filter({ has: window.getByText(name, { exact: true }) });

test('a project without environments creates one with a hub host', async ({ app, window, scratchDir, consoleErrors }) => {
  const path = join(scratchDir, 'empty');
  mkdirSync(path);
  writeFileSync(join(path, 'cfbs.json'), JSON.stringify({ name: 'No Tests', type: 'policy-set', description: '', build: [] }));
  await expect(window.getByText(/^Try Demo:/)).toBeVisible();
  await openFromMenu(app, path);
  await expect(window.locator('footer').getByText('Project: No Tests')).toBeVisible();

  await window.getByRole('tab', { name: 'Test Results & Logs' }).click();
  await expect(window.getByText(/^Run this project.s policy on Docker containers\.$/)).toBeVisible();
  // Creating only adds it to the project: nothing starts.
  await window.getByRole('button', { name: 'Create test environment' }).click();
  const card = hostCard(window, 'hub');
  await expect(card.getByText('HUB', { exact: true })).toBeVisible();
  await expect(card.getByText('Not set up', { exact: true })).toBeVisible();
  await expect(window.getByText('1 host', { exact: true })).toBeVisible();
  await expect(window.getByLabel('Unsaved changes')).toBeVisible();
  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test.describe('with Docker', () => {
  test.skip(!DOCKER, 'runs Docker containers: set CFPB_DOCKER_TESTS=1 to run');
  test.skip(() => DOCKER && !dockerUp(), 'docker info failed: Docker isn’t running');
  // The first run pulls the base image and installs CFEngine; later ones reuse the cached image.
  test.setTimeout(900_000);

  test.beforeAll(() => {
    // The demo's containers have fixed labels: don't take over (and then destroy) someone's own.
    test.skip(demoContainers().length > 0, `the demo's containers (label cfpb.env=${DEMO_ENV}) already exist`);
  });

  test.afterAll(() => {
    // Even after a failure: no container or network left behind.
    if (!dockerUp()) return;
    const containers = demoContainers();
    if (containers.length) docker('rm', '-f', ...containers);
    const networks = docker('network', 'ls', '-q', '--filter', `label=cfpb.env=${DEMO_ENV}`).split('\n').filter(Boolean);
    if (networks.length) docker('network', 'rm', ...networks);
  });

  test('the demo deploys and runs on its web host', async ({ window }) => {
    const card = hostCard(window, 'web');
    const deployAndRun = window.getByRole('button', { name: 'Deploy & run', exact: true });

    await test.step('open the demo on Test Results & Logs', async () => {
      await window.getByText(/^Try Demo:/).click();
      await window.getByRole('tab', { name: 'Test Results & Logs' }).click();
      await expect(card.getByText('Not set up', { exact: true })).toBeVisible();
      await expect(card.getByRole('link', { name: 'localhost:8080' })).toBeVisible();
    });

    await test.step('Deploy & run sets the host up and runs the policy', async () => {
      await deployAndRun.click();
      await expect(window.getByRole('button', { name: 'Cancel' })).toBeVisible();
      // Generous: pulling the image and installing CFEngine can take minutes on a cold cache.
      await expect(deployAndRun).toBeVisible({ timeout: 600_000 });
      await expect(card.getByText(/^\d+% kept · \d+% repaired · \d+% not kept/)).toBeVisible();
      await expect(window.getByRole('button', { name: 'Copy the log' })).toBeEnabled();
      await expect(window.getByText(/^Nothing yet: Deploy & run/)).toHaveCount(0);
    });

    await test.step('the host serves the landing page', async () => {
      const response = await fetch('http://localhost:8080/');
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('CFEngine Policy Builder demo project');
    });

    await test.step('Stop, then Destroy containers', async () => {
      await window.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(card.getByText('Stopped', { exact: true })).toBeVisible({ timeout: 120_000 });
      await window.getByRole('button', { name: 'Test environment settings' }).click();
      await window.getByRole('dialog').getByRole('button', { name: 'Destroy containers' }).click();
      await expect(card.getByText('Not set up', { exact: true })).toBeVisible({ timeout: 120_000 });
      expect(demoContainers()).toEqual([]);
    });
  });
});
