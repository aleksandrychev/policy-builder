import { type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { test as base, expect, openFromMenu } from './fixtures';

// The Deployment tab against local git repositories. Pre-flight and shipping run `cfbs build`,
// which downloads masterfiles: those tests are opt-in with CFPB_NETWORK_TESTS=1.
const NETWORK = process.env.CFPB_NETWORK_TESTS === '1';
const IDENTITY = { GIT_AUTHOR_NAME: 'E2E Test', GIT_AUTHOR_EMAIL: 'e2e@example.com', GIT_COMMITTER_NAME: 'E2E Test', GIT_COMMITTER_EMAIL: 'e2e@example.com' };

// Git (ours and the app's, which inherits the env) reads only the scratch folder's config, and
// commits as the E2E identity.
const test = base.extend({
  scratchDir: async ({ scratchDir }, provide) => {
    const config = join(scratchDir, 'gitconfig');
    writeFileSync(config, '[init]\n\tdefaultBranch = main\n[user]\n\tname = E2E Test\n\temail = e2e@example.com\n');
    const env: Record<string, string> = { ...IDENTITY, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
    const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    await provide(scratchDir);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

// A builder project with one local policy file and no masterfiles, so building needs no download.
function writeProject(scratchDir: string, folder: string, withGit: boolean): string {
  const path = join(scratchDir, folder);
  mkdirSync(join(path, '.policy-builder'), { recursive: true });
  const cfbs = {
    name: 'Deploy Me',
    description: 'Deployed by the E2E test',
    type: 'policy-set',
    build: [
      {
        name: './web.cf',
        description: 'Local policy file added using cfbs command line',
        tags: ['local'],
        added_by: 'cfbs add',
        steps: ['copy ./web.cf services/cfbs/web.cf', 'policy_files services/cfbs/web.cf', 'bundles web']
      }
    ]
  };
  const builder = {
    schema_version: 2,
    folders: [],
    files: [
      {
        id: 'file-1',
        name: 'Web',
        bundle: 'web',
        path: './web.cf',
        blocks: [],
        edges: [],
        order: [],
        layout: { positions: {}, groups: [], derived_positions: {} }
      }
    ],
    current_file_id: 'file-1'
  };
  writeFileSync(join(path, 'cfbs.json'), JSON.stringify(cfbs, null, 2));
  writeFileSync(join(path, '.policy-builder/project.json'), JSON.stringify(builder, null, 2));
  writeFileSync(join(path, 'web.cf'), 'bundle agent web\n{\n  reports:\n      "hello";\n}\n');
  writeFileSync(join(path, '.gitignore'), 'out/\n');
  if (withGit) {
    git(path, 'init', '--quiet');
    git(path, 'add', '--all');
    git(path, 'commit', '--quiet', '-m', 'Initial');
  }
  return path;
}

function bareRepo(scratchDir: string): string {
  const path = join(scratchDir, 'remote.git');
  execFileSync('git', ['init', '--quiet', '--bare', path]);
  return path;
}

async function openDeployment(app: ElectronApplication, window: Page, path: string) {
  await expect(window.getByText(/^Try Demo:/)).toBeVisible();
  await openFromMenu(app, path);
  await expect(window.locator('footer').getByText('Project: Deploy Me')).toBeVisible();
  await window.getByRole('tab', { name: 'Deployment' }).click();
  await expect(window.getByText('Deploy to', { exact: true })).toBeVisible();
}

test('git remote, SSH hub and Enterprise hub setup forms', async ({ app, window, scratchDir, consoleErrors }) => {
  const path = writeProject(scratchDir, 'project', true);
  const remote = bareRepo(scratchDir);
  await openDeployment(app, window, path);

  await test.step('the Git repository tab sets a remote', async () => {
    await expect(window.getByRole('tab', { name: 'Git repository' })).toHaveAttribute('aria-selected', 'true');
    await window.getByLabel('Remote (origin)').fill(remote);
    await window.getByRole('button', { name: 'Set', exact: true }).click();
    await expect(window.getByText(`${remote} · main`)).toBeVisible();
    await expect(window.getByLabel('Remote (origin)')).toHaveCount(0);
    expect(git(path, 'remote', 'get-url', 'origin')).toBe(remote);
  });

  await test.step('a saved SSH hub shows as status, Forget brings the form back', async () => {
    await window.getByRole('tab', { name: 'Hub over SSH' }).click();
    await window.getByLabel('Hub', { exact: true }).fill('root@hub.example.com');
    await window.getByLabel('Port').fill('2222');
    await window.getByRole('main').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(window.getByText('root@hub.example.com:2222', { exact: true })).toBeVisible();
    await expect(window.getByText('Not deployed from here yet')).toBeVisible();

    await window.getByRole('main').getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = window.getByRole('dialog', { name: 'Hub over SSH' });
    await expect(dialog.getByLabel('Hub', { exact: true })).toHaveValue('root@hub.example.com');
    await dialog.getByRole('button', { name: 'Forget' }).click();
    await expect(dialog).toBeHidden();
    await expect(window.getByLabel('Hub', { exact: true })).toHaveValue('');
  });

  await test.step('the Enterprise hub tab shows the connect form', async () => {
    await window.getByRole('tab', { name: 'Enterprise hub' }).click();
    await expect(window.getByLabel('Hub (Mission Portal) URL')).toBeVisible();
    await expect(window.getByLabel('Username')).toBeVisible();
    await expect(window.getByRole('button', { name: 'Connect' })).toBeVisible();
  });

  await test.step('the chosen tab survives switching views', async () => {
    await window.getByRole('tab', { name: 'Canvas' }).click();
    await expect(window.getByText('Deploy to', { exact: true })).toHaveCount(0);
    await window.getByRole('tab', { name: 'Deployment' }).click();
    await expect(window.getByRole('tab', { name: 'Enterprise hub' })).toHaveAttribute('aria-selected', 'true');
  });
  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test('initializes git in a project folder that has none', async ({ app, window, scratchDir, consoleErrors }) => {
  const path = writeProject(scratchDir, 'project', false);
  await openDeployment(app, window, path);

  await expect(window.getByText('This project folder isn’t a git repository yet.')).toBeVisible();
  await window.getByRole('button', { name: 'Initialize git' }).click();
  await expect(window.getByRole('alert').filter({ hasText: /^Initialized git: first commit [0-9a-f]{7}/ })).toBeVisible();
  // A repository without a remote: the remote form is next.
  await expect(window.getByLabel('Remote (origin)')).toBeVisible();
  expect(git(path, 'log', '--format=%s')).toBe('Initialized the project');
  expect(git(path, 'ls-files')).toContain('cfbs.json');
  expect(consoleErrors, 'console errors during the run').toEqual([]);
});

test.describe('with network', () => {
  test.skip(!NETWORK, 'downloads masterfiles: set CFPB_NETWORK_TESTS=1 to run');
  // Saving the demo downloads masterfiles, and every build runs cfbs and cf-promises.
  test.setTimeout(600_000);

  test('pre-flight passes on the demo, then shipping commits and pushes', async ({ window, scratchDir }) => {
    const remote = bareRepo(scratchDir);
    const path = join(scratchDir, 'projects/nginx-web-server-demo');
    const toast = window.getByRole('alert').filter({ hasText: /^Pushed [0-9a-f]{7} to origin/ });
    const ship = async () => {
      await window.getByRole('button', { name: /^(Commit & push|Push)$/ }).click();
      const dialog = window.getByRole('dialog');
      // Not tested on test hosts: shipping warns, then goes ahead.
      await dialog.getByRole('button', { name: 'Ship anyway' }).click();
      await expect(toast).toBeVisible({ timeout: 300_000 });
      await window
        .getByRole('alert')
        .filter({ hasText: /^Pushed/ })
        .getByRole('button', { name: 'Close' })
        .click();
    };

    await test.step('Try Demo, then Save As into a git project', async () => {
      await window.getByText(/^Try Demo:/).click();
      await window.getByRole('button', { name: 'Save As…' }).click();
      const dialog = window.getByRole('dialog', { name: 'Save Project As' });
      await expect(dialog.getByLabel('Initialize a git repository')).toBeChecked();
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 300_000 });
      expect(git(path, 'log', '--format=%s')).not.toBe('');
    });

    await test.step('pre-flight checks out', async () => {
      await window.getByRole('tab', { name: 'Deployment' }).click();
      await window.getByRole('button', { name: 'Run pre-flight' }).click();
      await expect(window.getByTitle(/^Valid policy: (Checks out|Builds \(cf-promises skipped\))$/)).toBeVisible({ timeout: 300_000 });
    });

    await test.step('ship pushes to the remote', async () => {
      await window.getByLabel('Remote (origin)').fill(remote);
      await window.getByRole('button', { name: 'Set', exact: true }).click();
      await ship();
      expect(git(remote, 'rev-parse', 'main')).toBe(git(path, 'rev-parse', 'HEAD'));
      expect(git(remote, 'ls-tree', '--name-only', 'main')).toContain('cfbs.json');
    });

    await test.step('an edit warns on Committed, shipping again commits it', async () => {
      await window.getByRole('tab', { name: 'Canvas' }).click();
      await window.getByRole('button', { name: /^Copy File\b/ }).click();
      await window.getByRole('tab', { name: 'Deployment' }).click();
      await expect(window.getByTitle(/^Committed: \d+ changes? not committed$/)).toBeVisible();
      const before = Number(git(remote, 'rev-list', '--count', 'main'));
      await ship();
      expect(Number(git(remote, 'rev-list', '--count', 'main'))).toBe(before + 1);
      expect(git(remote, 'rev-parse', 'main')).toBe(git(path, 'rev-parse', 'HEAD'));
      expect(git(path, 'status', '--porcelain')).toBe('');
    });
  });
});
