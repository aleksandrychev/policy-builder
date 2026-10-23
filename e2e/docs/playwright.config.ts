import { defineConfig } from '@playwright/test';

// The documentation's screenshots (npm run docs:screenshots), apart from the e2e tests: the built
// app in light theme, at a fixed size, written next to the docs pages (DOCS_SCREENSHOTS).
export default defineConfig({
  testDir: '.',
  testMatch: '*.docs.ts',
  outputDir: '../../test-results/docs',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // A missing element fails within half a minute, not at the test's own long timeout.
  use: { actionTimeout: 30_000 },
  workers: 1,
  reporter: 'list'
});
