# Electron security checklist

[![Electron security](https://github.com/cfengine/policy-builder/actions/workflows/electron-security.yml/badge.svg?branch=main)](https://github.com/cfengine/policy-builder/actions/workflows/electron-security.yml)

How CFEngine Policy Builder follows Electron's
[security recommendations](https://www.electronjs.org/docs/latest/tutorial/security#checklist-security-recommendations),
item by item, with the code that shows it. The
[Electron security](.github/workflows/electron-security.yml) workflow checks every item marked ✅
on each push and pull request, and weekly:

- **Source checks:** [`scripts/security-checks.mjs`](scripts/security-checks.mjs) reads the code and config each item depends on.
- **Running window:** [`e2e/security.spec.ts`](e2e/security.spec.ts) inspects the real app's window: its web preferences, CSP, permissions, navigation and popups.
- **Packaged app:** [`scripts/fuses-check.mjs`](scripts/fuses-check.mjs) reads the fuses from a packaged binary.
- **Electron version:** [`scripts/electron-support-check.mjs`](scripts/electron-support-check.mjs) checks the Electron major is still supported and `npm audit` has no advisory for it.

| # | Recommendation | Status | Evidence |
| --- | --- | --- | --- |
| 1 | [Only load secure content](https://www.electronjs.org/docs/latest/tutorial/security#1-only-load-secure-content) | ✅ | The packaged app loads its own files only, from `app://bundle/` (item 18). Everything it fetches is https: the Enterprise hub (`checkedUrl` in [`src/main/hub.ts`](src/main/hub.ts) refuses anything else), the masterfiles versions index (`VERSIONS_URL` in [`src/main/project.ts`](src/main/project.ts)). `http://` appears only for the development server on localhost. |
| 2 | [Do not enable Node.js integration for remote content](https://www.electronjs.org/docs/latest/tutorial/security#2-do-not-enable-nodejs-integration-for-remote-content) | ✅ | `nodeIntegration` is never enabled (`createWindow` in [`src/main/index.ts`](src/main/index.ts)); the running page has no `require` or `process`. |
| 3 | [Enable context isolation](https://www.electronjs.org/docs/latest/tutorial/security#3-enable-context-isolation) | ✅ | `contextIsolation: true` in `createWindow` ([`src/main/index.ts`](src/main/index.ts)). |
| 4 | [Enable process sandboxing](https://www.electronjs.org/docs/latest/tutorial/security#4-enable-process-sandboxing) | ✅ | `sandbox: true` in `createWindow` ([`src/main/index.ts`](src/main/index.ts)); no `--no-sandbox`. |
| 5 | [Handle session permission requests from remote content](https://www.electronjs.org/docs/latest/tutorial/security#5-handle-session-permission-requests-from-remote-content) | ✅ | `setPermissionRequestHandler` in [`src/main/index.ts`](src/main/index.ts) grants only `clipboard-sanitized-write` (Copy in Generated Policy) and denies the rest. |
| 6 | [Do not disable `webSecurity`](https://www.electronjs.org/docs/latest/tutorial/security#6-do-not-disable-websecurity) | ✅ | Never set; the running window reports `webSecurity: true`. |
| 7 | [Define a Content Security Policy](https://www.electronjs.org/docs/latest/tutorial/security#7-define-a-content-security-policy) | ✅ | The `<meta http-equiv="Content-Security-Policy">` in [`src/renderer/index.html`](src/renderer/index.html): `default-src 'self'`, `script-src 'self'` (no inline scripts, no `eval`). `style-src` allows `'unsafe-inline'`, which Emotion/MUI need for their injected styles. |
| 8 | [Do not enable `allowRunningInsecureContent`](https://www.electronjs.org/docs/latest/tutorial/security#8-do-not-enable-allowrunninginsecurecontent) | ✅ | Never set; the running window reports `false`. |
| 9 | [Do not enable experimental features](https://www.electronjs.org/docs/latest/tutorial/security#9-do-not-enable-experimental-features) | ✅ | Never set; the running window reports `false`. |
| 10 | [Do not use `enableBlinkFeatures`](https://www.electronjs.org/docs/latest/tutorial/security#10-do-not-use-enableblinkfeatures) | ✅ | Never set. |
| 11 | [Do not use `allowpopups` for WebViews](https://www.electronjs.org/docs/latest/tutorial/security#11-do-not-use-allowpopups-for-webviews) | ✅ | The app has no `<webview>`. |
| 12 | [Verify WebView options before creation](https://www.electronjs.org/docs/latest/tutorial/security#12-verify-webview-options-before-creation) | ✅ | `webviewTag` stays off (the running window reports `false`), so no webview can be attached. |
| 13 | [Disable or limit navigation](https://www.electronjs.org/docs/latest/tutorial/security#13-disable-or-limit-navigation) | ✅ | The `will-navigate` handler in [`src/main/index.ts`](src/main/index.ts) prevents any navigation away from the loaded page; http(s) links go to the system browser instead. |
| 14 | [Disable or limit creation of new windows](https://www.electronjs.org/docs/latest/tutorial/security#14-disable-or-limit-creation-of-new-windows) | ✅ | `setWindowOpenHandler` in [`src/main/index.ts`](src/main/index.ts) always returns `{ action: 'deny' }`; http(s) links open in the system browser. |
| 15 | [Do not use `shell.openExternal` with untrusted content](https://www.electronjs.org/docs/latest/tutorial/security#15-do-not-use-shellopenexternal-with-untrusted-content) | ✅ | The only `shell.openExternal` call is in `openExternalIfSafe` ([`src/main/index.ts`](src/main/index.ts)), which passes only `http:` and `https:` URLs. |
| 16 | [Use a current version of Electron](https://www.electronjs.org/docs/latest/tutorial/security#16-use-a-current-version-of-electron) | ✅ | Electron 44 ([`package.json`](package.json)), checked weekly against Electron's supported majors and `npm audit`. |
| 17 | [Validate the sender of all IPC messages](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages) | ✅ | Every `ipcMain.handle` checks `isTrustedFrame` ([`src/main/index.ts`](src/main/index.ts)): the top frame of our own page only. Feature modules wrap their handlers in `trusted(…)` ([`project.ts`](src/main/project.ts), [`deploy.ts`](src/main/deploy.ts), [`hub.ts`](src/main/hub.ts), [`testenv.ts`](src/main/testenv.ts)). Unit tests check untrusted senders are refused ([`project.test.ts`](src/main/project.test.ts), [`deploy.test.ts`](src/main/deploy.test.ts)). |
| 18 | [Avoid usage of the `file` protocol and prefer usage of custom protocols](https://www.electronjs.org/docs/latest/tutorial/security#18-avoid-usage-of-the-file-protocol-and-prefer-usage-of-custom-protocols) | ✅ | The packaged app's page is served from `app://bundle/` (`serveRenderer` in [`src/main/index.ts`](src/main/index.ts)), which maps to the built renderer folder and returns 404 for anything outside it, encoded `..` included. Nothing calls `loadFile`, and the `GrantFileProtocolExtraPrivileges` fuse is off ([`electron-builder.yml`](electron-builder.yml)). |
| 19 | [Check which fuses you can change](https://www.electronjs.org/docs/latest/tutorial/security#19-check-which-fuses-you-can-change) | ✅ | `electronFuses` in [`electron-builder.yml`](electron-builder.yml): `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments` and `GrantFileProtocolExtraPrivileges` off; `EnableCookieEncryption`, `OnlyLoadAppFromAsar` and `EnableEmbeddedAsarIntegrityValidation` on. Read back from the packaged binary. |
| 20 | [Do not expose Electron APIs to untrusted web content](https://www.electronjs.org/docs/latest/tutorial/security#20-do-not-expose-electron-apis-to-untrusted-web-content) | ✅ | The preload ([`src/preload/index.ts`](src/preload/index.ts)) exposes one object, `window.api`, of functions over fixed channels; never `ipcRenderer` itself, and event listeners get only the payload, not the `IpcRendererEvent`. |

## Running the checks locally

```sh
node scripts/security-checks.mjs          # source checks
node scripts/electron-support-check.mjs   # supported Electron, npm audit
npx electron-vite build && npx playwright test -c e2e/playwright.config.ts e2e/security.spec.ts
npx electron-builder --dir && node scripts/fuses-check.mjs "release/mac/CFEngine Policy Builder.app"
```
