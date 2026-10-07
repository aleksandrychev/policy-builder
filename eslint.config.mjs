import ntReactConfig from '@northern.tech/eslint-config/react.js';
import globals from 'globals';

export default [
  {
    ignores: ['out/**', 'release/**', 'dist/**', 'node_modules/**', 'python/**']
  },
  ...ntReactConfig,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'electron.vite.config.ts', 'e2e/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node }
    }
  }
];
