import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

// Standalone Vitest config, deliberately kept separate from electron.vite.config.ts
// (which builds the packaged app) so the test runner does not pull in Electron build steps.
// Projects by speed: `renderer` and `main` are fast logic tests (npm run test:fast),
// `components` renders React (slow), `integration` runs the real sidecar, git and a fake hub.

const rendererProject = (name: string, include: string, testTimeout?: number) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      // Built-in block descriptors live at repo root (blocks/) — see blocks/README.md.
      '@blocks': resolve('blocks')
    }
  },
  test: { name, globals: true, environment: 'jsdom', setupFiles: ['./src/renderer/src/test/setup.ts'], include: [include], css: true, testTimeout }
});

// Main-process modules import Electron at load; tests get inert stand-ins.
const electron = { alias: { electron: resolve('src/main/test/electron.ts') } };

export default defineConfig({
  test: {
    projects: [
      // Logic: *.test.ts.
      rendererProject('renderer', 'src/renderer/**/*.test.ts'),
      // React components: *.test.tsx. Large MUI trees are slow on CI runners and under load.
      rendererProject('components', 'src/renderer/**/*.test.tsx', 15_000),
      {
        resolve: electron,
        test: { name: 'main', environment: 'node', include: ['src/main/**/*.test.ts'], exclude: ['src/main/**/*.integration.test.ts'] }
      },
      {
        resolve: electron,
        test: { name: 'integration', environment: 'node', include: ['src/main/**/*.integration.test.ts'], testTimeout: 60_000 }
      }
    ]
  }
});
