import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // Built-in block descriptors live at repo root (blocks/), shared with the
        // Python sidecar — see blocks/README.md.
        '@blocks': resolve('blocks')
      }
    },
    // blocks/ sits outside the renderer's own root (src/renderer), so the dev
    // server needs to be told it's allowed to serve files from there too.
    // Setting fs.allow replaces Vite's own default (which normally covers the
    // whole repo root via searchForWorkspaceRoot) rather than extending it, so
    // the repo root has to be listed explicitly — otherwise node_modules
    // (fonts, etc.) falls outside the allow list.
    server: {
      fs: {
        allow: [resolve('.')]
      }
    },
    plugins: [react()]
  }
});
