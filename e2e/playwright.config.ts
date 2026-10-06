import { defineConfig } from '@playwright/test';

// Drives the built app (out/) — `npm run test:e2e` builds first. The `use`
// screenshot/trace options don't reach Electron windows, so the spec
// captures its own screenshot on failure.
export default defineConfig({
  testDir: '.',
  // One warm-up launch before the tests (see global-setup.ts).
  globalSetup: './global-setup.ts',
  outputDir: '../test-results/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Each test launches a whole app; run them one at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]] : 'list'
});
