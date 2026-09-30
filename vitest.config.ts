import { resolve } from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Standalone Vitest config for the React renderer. It is deliberately kept
// separate from electron.vite.config.ts (which builds the packaged app) so the
// test runner does not pull in Electron main/preload build steps.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      // Built-in block descriptors live at repo root (blocks/) — see blocks/README.md.
      '@blocks': resolve('blocks')
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/renderer/src/test/setup.ts'],
    include: ['src/renderer/**/*.{test,spec}.{ts,tsx}'],
    css: true
  }
});
