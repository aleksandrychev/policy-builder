import { type ElectronApplication, type Locator, type Page, _electron as electron, expect, test } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// Short silent clips of the app for the cfengine.com Policy Builder page, recorded with Playwright
// and encoded with ffmpeg: CLIPS_OUT, else ../website/static/policy-builder.
const OUT = resolve(process.env.CLIPS_OUT ?? join(__dirname, '../../../website/static/policy-builder'));
const SIZE = { width: 1440, height: 900 };
const appEntry = resolve(__dirname, '../../out/main/index.js');

// A big pointer drawn over the app, as product clips show it, with a ripple on each click.
function installPointer() {
  const pointer = document.createElement('div');
  pointer.id = 'clip-pointer';
  pointer.innerHTML =
    '<svg width="44" height="44" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.6 L14.6 20.2 L11.5 13.6 L17.6 13.4 Z" fill="#0B132A" stroke="white" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  Object.assign(pointer.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-6px, -3px)' });
  document.body.appendChild(pointer);
  document.addEventListener(
    'mousemove',
    event => {
      pointer.style.left = `${event.clientX}px`;
      pointer.style.top = `${event.clientY}px`;
    },
    true
  );
  document.addEventListener(
    'mousedown',
    event => {
      const ripple = document.createElement('div');
      Object.assign(ripple.style, {
        position: 'fixed',
        left: `${event.clientX - 22}px`,
        top: `${event.clientY - 22}px`,
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        background: 'rgba(245, 130, 31, 0.45)',
        zIndex: '2147483646',
        pointerEvents: 'none',
        transition: 'transform 0.45s ease-out, opacity 0.45s ease-out'
      });
      document.body.appendChild(ripple);
      requestAnimationFrame(() => Object.assign(ripple.style, { transform: 'scale(1.8)', opacity: '0' }));
      setTimeout(() => ripple.remove(), 500);
    },
    true
  );
}

async function launch(userData: string, videos: string): Promise<{ app: ElectronApplication; window: Page }> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<
    string,
    string
  >;
  env.CFPB_E2E = '1';
  if (!process.env.CFPB_E2E_SHOW) env.CFPB_E2E_HIDDEN = '1';
  const app = await electron.launch({ args: [appEntry, `--user-data-dir=${userData}`], env, recordVideo: { dir: videos, size: SIZE } });
  const window = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, nativeTheme }, size) => {
    nativeTheme.themeSource = 'light';
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
  }, SIZE);
  await window.emulateMedia({ colorScheme: 'light' });
  return { app, window };
}

// Moves the pointer there smoothly (a person's pace, not a jump), then clicks.
async function moveTo(window: Page, target: Locator | { x: number; y: number }, steps = 16) {
  const point = 'x' in target ? target : await centerOf(target);
  await window.mouse.move(point.x, point.y, { steps });
  return point;
}

async function centerOf(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// A raw mouse click doesn't wait like locator.click(): it waits here until the target can take it.
async function clickOn(window: Page, target: Locator) {
  await expect(target).toBeEnabled({ timeout: 60_000 });
  await moveTo(window, target);
  await window.waitForTimeout(150);
  await window.mouse.down();
  await window.mouse.up();
}

async function drag(window: Page, from: Locator, to: { x: number; y: number }) {
  await moveTo(window, from);
  await window.mouse.down();
  await window.mouse.move(to.x, to.y, { steps: 40 });
  await window.mouse.up();
}

const slowly = (window: Page, text: string) => window.keyboard.type(text, { delay: 40 });

// The recording from `from` seconds on, `speed` times faster, as web video: H.264 MP4, which
// every browser plays, and a poster frame (its last frame).
function encode(raw: string, name: string, from: number, speed = 1) {
  const trim = ['-y', '-loglevel', 'error', '-ss', from.toFixed(2), '-i', raw, '-an', '-vf', `setpts=PTS/${speed},scale=1280:-2,fps=30`];
  execFileSync('ffmpeg', [
    ...trim,
    '-c:v',
    'libx264',
    '-crf',
    '24',
    '-preset',
    'slow',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    join(OUT, `${name}.mp4`)
  ]);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-sseof',
    '-0.5',
    '-i',
    join(OUT, `${name}.mp4`),
    '-frames:v',
    '1',
    '-q:v',
    '3',
    join(OUT, `${name}.jpg`)
  ]);
}

// Only when asked (npm run docs:clips): they take a while and write into the website repo.
test.skip(!process.env.CLIPS, 'set CLIPS=1 to record the website clips');
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test('hero', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cfpb-clip-'));
  const videos = join(scratch, 'videos');
  mkdirSync(join(scratch, 'user-data'), { recursive: true });
  writeFileSync(join(scratch, 'user-data/app-settings.json'), JSON.stringify({ lastProjectParent: scratch }));
  mkdirSync(OUT, { recursive: true });
  const { app, window } = await launch(join(scratch, 'user-data'), videos);
  // The recording starts with the window, about when launch() returns it.
  const recordingStarted = Date.now();
  try {
    await window.getByText(/^Try Demo:/).click();
    await expect(window.locator('footer').getByText('Project: Nginx Web Server Demo')).toBeVisible();
    await window.evaluate(installPointer);
    await window.mouse.move(SIZE.width / 2, SIZE.height / 2);
    await window.waitForTimeout(800);
    // The clip starts here: what came before is the app starting.
    const clipStart = (Date.now() - recordingStarted) / 1000;

    // A new configuration, its canvas empty and at full size.
    await clickOn(window, window.getByTitle('New file'));
    await slowly(window, 'Tools');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(600);

    const area = (await window.locator('.react-flow').boundingBox())!;
    const search = window.getByPlaceholder('Search blocks…');
    await clickOn(window, search);
    await slowly(window, 'Install Package');
    await drag(window, window.getByRole('button', { name: /^Install Package\b/ }), { x: area.x + area.width * 0.42, y: area.y + area.height * 0.28 });
    await window.waitForTimeout(500);
    await clickOn(window, window.getByLabel('Label'));
    await window.keyboard.press('ControlOrMeta+a');
    await slowly(window, 'Install curl');
    await clickOn(window, window.getByLabel('Package name', { exact: true }));
    const editor = window.getByRole('dialog', { name: 'Package name' });
    await editor.locator('.cm-content').click();
    await slowly(window, 'curl');
    await clickOn(window, editor.getByRole('button', { name: 'Save' }));
    await expect(editor).toBeHidden();

    await clickOn(window, search);
    await window.keyboard.press('ControlOrMeta+a');
    await slowly(window, 'Report Message');
    await drag(window, window.getByRole('button', { name: /^Report Message\b/ }), { x: area.x + area.width * 0.42, y: area.y + area.height * 0.62 });
    await window.waitForTimeout(500);
    await clickOn(window, window.getByLabel('Label'));
    await window.keyboard.press('ControlOrMeta+a');
    await slowly(window, 'Report curl');
    await clickOn(window, window.getByLabel('Message', { exact: true }));
    const message = window.getByRole('dialog', { name: 'Message' });
    await message.locator('.cm-content').click();
    await slowly(window, 'curl is installed');
    await clickOn(window, message.getByRole('button', { name: 'Save' }));
    await expect(message).toBeHidden();

    // The arrow: from the first block's bottom dot to the second's top dot.
    const card = (label: string) => window.locator('.react-flow__node').filter({ hasText: label }).first();
    await drag(
      window,
      card('Install curl').locator('.react-flow__handle[data-handleid="out"]'),
      await centerOf(card('Report curl').locator('.react-flow__handle[data-handleid="in"]'))
    );
    await window.waitForTimeout(900);

    await clickOn(window, window.getByRole('tab', { name: 'Generated Policy (.cf)' }));
    await expect(window.getByText('Up to date')).toBeVisible({ timeout: 30_000 });
    await moveTo(window, { x: SIZE.width * 0.55, y: SIZE.height * 0.45 }, 30);
    await window.waitForTimeout(2500);

    // The video is complete once the app has closed.
    const raw = await window.video()!.path();
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    encode(raw, 'hero', clipStart, 1.5);
  } finally {
    await app.close().catch(() => {});
    rmSync(scratch, { recursive: true, force: true });
  }
});

// Parts of the recording, in seconds, joined into one clip: the waits between them are cut out.
// A part's own speed multiplies the clip's, e.g. to fast-forward a progress bar.
type Segment = [from: number, to: number, speed?: number];

function encodeSegments(raw: string, name: string, segments: Segment[], speed = 1) {
  const parts = segments.map(([from, to, own = 1], i) => `[0:v]trim=start=${from.toFixed(2)}:end=${to.toFixed(2)},setpts=(PTS-STARTPTS)/${own}[s${i}]`);
  const joined = `${segments.map((_, i) => `[s${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[joined]`;
  const graph = [...parts, joined, `[joined]setpts=PTS/${speed},scale=1280:-2,fps=30[out]`].join(';');
  const base = ['-y', '-loglevel', 'error', '-i', raw, '-filter_complex', graph, '-map', '[out]', '-an'];
  execFileSync('ffmpeg', [
    ...base,
    '-c:v',
    'libx264',
    '-crf',
    '24',
    '-preset',
    'slow',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    join(OUT, `${name}.mp4`)
  ]);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-sseof',
    '-0.5',
    '-i',
    join(OUT, `${name}.mp4`),
    '-frames:v',
    '1',
    '-q:v',
    '3',
    join(OUT, `${name}.jpg`)
  ]);
}

// The walkthrough: one project, a clip per step, each recorded on its own. They run in order and share
// the app's settings (its recent projects) and the project folder; needs the network and Docker.
const PROJECT = '/Users/Shared/web-servers';
const REMOTE = `${PROJECT}.git`;

test.describe('walkthrough', () => {
  test.describe.configure({ mode: 'serial', timeout: 900_000 });
  let scratch = '';

  test.beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'cfpb-clip-'));
    for (const path of [PROJECT, REMOTE]) rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    mkdirSync(join(scratch, 'user-data'), { recursive: true });
    writeFileSync(join(scratch, 'user-data/app-settings.json'), JSON.stringify({ lastProjectParent: '/Users/Shared' }));
    mkdirSync(OUT, { recursive: true });
  });

  test.afterAll(() => {
    for (const path of [PROJECT, REMOTE, scratch]) if (path) rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  });

  // Launches the app, records `steps` (which return the clip's segments, in seconds), and encodes them.
  async function clip(name: string, opensProject: boolean, steps: (window: Page, now: () => number) => Promise<Segment[]>) {
    const { app, window } = await launch(join(scratch, 'user-data'), join(scratch, `videos-${name}`));
    const started = Date.now();
    const now = () => (Date.now() - started) / 1000;
    try {
      if (opensProject) {
        await window.getByRole('button', { name: /^Web servers/ }).click();
        await expect(window.locator('footer').getByText(/^Project: Web servers/)).toBeVisible();
      }
      await window.evaluate(installPointer);
      await window.mouse.move(SIZE.width / 2, SIZE.height / 2);
      await window.waitForTimeout(500);
      const segments = await steps(window, now).catch(async error => {
        // What the window showed when it failed, next to the test's other results.
        await window.screenshot({ path: test.info().outputPath('failure.png') }).catch(() => {});
        throw error;
      });
      const raw = await window.video()!.path();
      await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
      await app.close().catch(() => {});
      encodeSegments(raw, name, segments, 1.6);
    } finally {
      await app.close().catch(() => {});
    }
  }

  const card = (window: Page, label: string) => window.locator('.react-flow__node').filter({ hasText: label }).first();

  test('create a project', async () => {
    await clip('step-create', false, async (window, now) => {
      const from = now();
      await clickOn(window, window.getByRole('button', { name: 'New Project' }));
      const dialog = window.getByRole('dialog', { name: 'New Project' });
      await clickOn(window, dialog.getByLabel('Project name'));
      await slowly(window, 'Web servers');
      await clickOn(window, dialog.getByLabel('Description'));
      // It starts with a suggested description: replaced.
      await window.keyboard.press('ControlOrMeta+a');
      await slowly(window, 'Nginx web servers');
      await window.waitForTimeout(400);
      await clickOn(window, dialog.getByRole('button', { name: 'Create' }));
      const filled: Segment = [from, now() + 0.4];
      // The masterfiles download: cut.
      await expect(dialog).toBeHidden({ timeout: 300_000 });
      const opened = now();
      await window.waitForTimeout(1200);
      return [filled, [opened, now()]];
    });
  });

  test('place the blocks', async () => {
    await clip('step-blocks', true, async (window, now) => {
      const start = now();
      const area = (await window.locator('.react-flow').boundingBox())!;
      const search = window.getByPlaceholder('Search blocks…');
      await clickOn(window, search);
      await slowly(window, 'Install Package');
      await drag(window, window.getByRole('button', { name: /^Install Package\b/ }), { x: area.x + area.width * 0.42, y: area.y + area.height * 0.28 });
      await window.waitForTimeout(400);
      await clickOn(window, window.getByLabel('Label'));
      await window.keyboard.press('ControlOrMeta+a');
      await slowly(window, 'Install nginx');
      await clickOn(window, window.getByLabel('Package name', { exact: true }));
      const editor = window.getByRole('dialog', { name: 'Package name' });
      await editor.locator('.cm-content').click();
      await slowly(window, 'nginx');
      await clickOn(window, editor.getByRole('button', { name: 'Save' }));
      await expect(editor).toBeHidden();
      await clickOn(window, search);
      await window.keyboard.press('ControlOrMeta+a');
      await slowly(window, 'Manage Service');
      await drag(window, window.getByRole('button', { name: /^Manage Service\b/ }), { x: area.x + area.width * 0.42, y: area.y + area.height * 0.62 });
      await window.waitForTimeout(400);
      await clickOn(window, window.getByLabel('Label'));
      await window.keyboard.press('ControlOrMeta+a');
      await slowly(window, 'Keep nginx running');
      await clickOn(window, window.getByLabel('Service name'));
      await slowly(window, 'nginx');
      await drag(
        window,
        card(window, 'Install nginx').locator('.react-flow__handle[data-handleid="out"]'),
        await centerOf(card(window, 'Keep nginx running').locator('.react-flow__handle[data-handleid="in"]'))
      );
      await window.waitForTimeout(700);
      await window.keyboard.press('ControlOrMeta+s');
      await expect(window.getByLabel('Unsaved changes')).toHaveCount(0, { timeout: 60_000 });
      await window.waitForTimeout(1000);
      return [[start, now()]];
    });
  });

  test('test', async () => {
    await clip('step-test', true, async (window, now) => {
      const from = now();
      await clickOn(window, window.getByRole('tab', { name: 'Test Results & Logs' }));
      await window.waitForTimeout(400);
      await clickOn(window, window.getByRole('button', { name: 'Create test environment' }));
      await window.waitForTimeout(500);
      const deployAndRun = window.getByRole('button', { name: 'Deploy & run', exact: true });
      await clickOn(window, deployAndRun);
      // Started: its Cancel shows while it runs.
      await expect(window.getByRole('button', { name: 'Cancel' })).toBeVisible();
      await window.waitForTimeout(2000);
      const started: Segment = [from, now()];
      // The run itself: cut.
      await expect(deployAndRun).toBeVisible({ timeout: 300_000 });
      await expect(window.getByText('Converged', { exact: true }).first()).toBeVisible();
      const done = now();
      await moveTo(window, window.getByText('Converged', { exact: true }).first());
      await window.waitForTimeout(1500);
      const segments: Segment[] = [started, [done, now()]];
      // Saved (the environment is part of the project), and the container removed.
      await window.keyboard.press('ControlOrMeta+s');
      await expect(window.getByLabel('Unsaved changes')).toHaveCount(0, { timeout: 60_000 });
      await window.getByRole('button', { name: 'Purge all' }).click();
      await expect(window.getByText('Not set up', { exact: true })).toBeVisible({ timeout: 120_000 });
      return segments;
    });
  });

  test('deploy', async () => {
    execFileSync('git', ['init', '--quiet', '--bare', REMOTE]);
    await clip('step-deploy', true, async (window, now) => {
      let from = now();
      await clickOn(window, window.getByRole('tab', { name: 'Deployment' }));
      await window.waitForTimeout(600);
      await clickOn(window, window.getByLabel('Remote (origin)'));
      // Pasted, as a person would: typing a long path would make the clip drag.
      await window.keyboard.insertText(REMOTE);
      await clickOn(window, window.getByRole('button', { name: 'Set', exact: true }));
      await expect(window.getByLabel('Remote (origin)')).toBeHidden({ timeout: 30_000 });
      const remote: Segment = [from, now()];
      // Setting the remote starts the pre-flight, fast-forwarded in the clip.
      from = now();
      await expect(window.getByText('Checks out', { exact: true })).toBeVisible({ timeout: 300_000 });
      const preflight: Segment = [from, now(), 8];
      from = now();
      await window.waitForTimeout(800);
      await clickOn(window, window.getByRole('button', { name: /^(Commit & push|Push)$/ }));
      // The app fills in the commit message from the changes; the clip keeps it.
      const ship = window.getByRole('dialog');
      await window.waitForTimeout(1200);
      await clickOn(window, ship.getByRole('button', { name: /^(Commit & push|Push|Ship anyway)$/ }));
      await expect(window.getByText(/^Pushed [0-9a-f]+ to /)).toBeVisible({ timeout: 120_000 });
      await window.waitForTimeout(1500);
      return [remote, preflight, [from, now()]];
    });
  });
});
