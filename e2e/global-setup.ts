import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { launch, shownWindow } from './fixtures';

// The machine's first app launch can stall the page for a while (on CI runners: ~30 s, likely
// one-time font and GPU setup), long enough to time out the first test's first click. Launch once
// here and wait until the start screen takes clicks, so every test starts warm.
const WARM_UP_TIMEOUT_MS = 120_000;

export default async function globalSetup() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cfpb-e2e-warm-up-'));
  const started = Date.now();
  const app = await launch(userDataDir);
  try {
    const window = await shownWindow(app);
    // A trial click runs the visible/enabled/stable checks without clicking.
    await window.getByRole('button', { name: 'New Project' }).click({ trial: true, timeout: WARM_UP_TIMEOUT_MS });
    console.log(`e2e warm-up: the app took clicks after ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
  }
}
