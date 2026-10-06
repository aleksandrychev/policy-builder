// Static checks for the Electron security checklist (SECURITY-CHECKLIST.md): each one reads
// the source or config that shows an item is followed. Run: node scripts/security-checks.mjs
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const read = path => readFileSync(path, 'utf-8');
const sources = dir =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sources(path);
    return /\.(ts|tsx|html)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

const appFiles = [...sources('src'), 'src/renderer/index.html'].map(path => ({ path, text: read(path) }));
const mainIndex = read('src/main/index.ts');
const preload = read('src/preload/index.ts');
const html = read('src/renderer/index.html');
const builderConfig = read('electron-builder.yml');

// Window options' insecure values, anywhere in the app's own code.
const nowhere = pattern => {
  const found = appFiles.filter(file => pattern.test(file.text)).map(file => file.path);
  return found.length ? `found in ${found.join(', ')}` : null;
};
const missing = (text, pattern, what) => (pattern.test(text) ? null : `missing: ${what}`);

// Every ipcMain.handle/on in main checks its sender: wrapped in trusted(…) or calling isTrustedFrame.
function unguardedIpc() {
  const unguarded = [];
  for (const file of appFiles.filter(item => item.path.startsWith('src/main/'))) {
    const calls = file.text.split(/(?=ipcMain\.(?:handle|on)\()/).slice(1);
    for (const call of calls) {
      const head = call.slice(0, 400);
      if (!/^ipcMain\.(?:handle|on)\(\s*'[^']+',\s*(?:trusted\(|[^]*?isTrustedFrame\()/.test(head)) {
        unguarded.push(`${file.path}: ${head.split('\n')[0].trim()}`);
      }
    }
  }
  return unguarded.length ? `unguarded: ${unguarded.join('; ')}` : null;
}

const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
const fuse = (name, value) => missing(builderConfig, new RegExp(`^\\s+${name}: ${value}\\b`, 'm'), `fuse ${name}: ${value}`);

const CHECKS = [
  ['1. Only load secure content', () => nowhere(/['"`]http:\/\/(?!localhost|127\.0\.0\.1)/)],
  ['2. No Node.js integration', () => nowhere(/nodeIntegration(InWorker|InSubFrames)?\s*:\s*true/)],
  ['3. Context isolation', () => nowhere(/contextIsolation\s*:\s*false/) ?? missing(mainIndex, /contextIsolation:\s*true/, 'contextIsolation: true')],
  ['4. Process sandboxing', () => nowhere(/sandbox\s*:\s*false|--no-sandbox|enableSandbox/) ?? missing(mainIndex, /sandbox:\s*true/, 'sandbox: true')],
  ['5. Permission requests handled', () => missing(mainIndex, /setPermissionRequestHandler\(/, 'setPermissionRequestHandler')],
  ['6. webSecurity not disabled', () => nowhere(/webSecurity\s*:\s*false|disable-web-security/)],
  [
    '7. Content Security Policy',
    () =>
      !csp
        ? 'no CSP meta tag'
        : /unsafe-eval|script-src[^;]*(unsafe-inline|\*)/.test(csp)
          ? `weak CSP: ${csp}`
          : missing(csp, /default-src 'self'/, `default-src 'self'`)
  ],
  ['8. No allowRunningInsecureContent', () => nowhere(/allowRunningInsecureContent\s*:\s*true/)],
  ['9. No experimental features', () => nowhere(/experimentalFeatures\s*:\s*true/)],
  ['10. No enableBlinkFeatures', () => nowhere(/enableBlinkFeatures/)],
  ['11. No allowpopups (no webviews)', () => nowhere(/allowpopups|<webview/i)],
  ['12. Webviews off', () => nowhere(/webviewTag\s*:\s*true/)],
  ['13. Navigation limited', () => missing(mainIndex, /on\('will-navigate'[^]*?preventDefault\(\)/, 'will-navigate handler that prevents navigation')],
  ['14. New windows limited', () => missing(mainIndex, /setWindowOpenHandler\([^]*?action: 'deny'/, `setWindowOpenHandler returning action: 'deny'`)],
  [
    '15. shell.openExternal only for http(s)',
    () => {
      const calls = appFiles.flatMap(file => (file.text.match(/shell\.openExternal\(/g) ?? []).map(() => file.path));
      if (calls.length !== 1 || calls[0] !== 'src/main/index.ts')
        return `shell.openExternal called from: ${calls.join(', ')} (expected only openExternalIfSafe)`;
      return missing(mainIndex, /function openExternalIfSafe[^]*?protocol === 'https:'[^]*?shell\.openExternal\(/, 'openExternalIfSafe guarding the call');
    }
  ],
  ['17. IPC senders validated', unguardedIpc],
  [
    '18. No file:// (app:// scheme)',
    () =>
      nowhere(/\.loadFile\(/) ?? missing(mainIndex, /protocol\.handle\('app'/, `protocol.handle('app', …)`) ?? fuse('grantFileProtocolExtraPrivileges', false)
  ],
  [
    '19. Fuses',
    () =>
      fuse('runAsNode', false) ??
      fuse('enableNodeOptionsEnvironmentVariable', false) ??
      fuse('enableNodeCliInspectArguments', false) ??
      fuse('enableCookieEncryption', true) ??
      fuse('onlyLoadAppFromAsar', true) ??
      fuse('enableEmbeddedAsarIntegrityValidation', true) ??
      fuse('grantFileProtocolExtraPrivileges', false)
  ],
  [
    '20. Electron APIs not exposed',
    () =>
      /exposeInMainWorld\([^)]*(ipcRenderer|require|process)/.test(preload)
        ? 'the preload exposes ipcRenderer, require or process'
        : (preload.match(/exposeInMainWorld\(/g) ?? []).length !== 1
          ? 'expected one exposeInMainWorld (window.api)'
          : /callback\(\s*_?event\b/.test(preload)
            ? 'a listener passes the IpcRendererEvent to the page'
            : null
  ]
];

let failed = 0;
for (const [name, check] of CHECKS) {
  const problem = check();
  if (problem) failed += 1;
  console.log(`${problem ? '✗' : '✓'} ${name}${problem ? ` — ${problem}` : ''}`);
}
if (failed) {
  console.error(`\n${failed} security check(s) failed. See SECURITY-CHECKLIST.md.`);
  process.exit(1);
}
