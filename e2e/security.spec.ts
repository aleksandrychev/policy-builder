import { expect, test } from './fixtures';

// The Electron security checklist at runtime (SECURITY-CHECKLIST.md): what the real window does.
// Navigation and popup attempts use file: URLs, which the app never hands to the OS browser.

test('the window runs isolated, sandboxed and without Node', async ({ app, window: page }) => {
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    // Not in Electron's type declarations, but on every WebContents.
    const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences: () => Record<string, unknown> | null };
    const prefs = contents.getLastWebPreferences();
    return {
      contextIsolation: prefs?.contextIsolation,
      sandbox: prefs?.sandbox,
      nodeIntegration: prefs?.nodeIntegration,
      nodeIntegrationInSubFrames: prefs?.nodeIntegrationInSubFrames,
      webSecurity: prefs?.webSecurity,
      allowRunningInsecureContent: prefs?.allowRunningInsecureContent,
      experimentalFeatures: prefs?.experimentalFeatures,
      webviewTag: prefs?.webviewTag
    };
  });
  expect(preferences).toEqual({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false
  });
  // The page itself sees no Node and no Electron; only window.api's functions.
  expect(await page.evaluate(() => [typeof (globalThis as Record<string, unknown>).require, typeof (globalThis as Record<string, unknown>).process])).toEqual([
    'undefined',
    'undefined'
  ]);
  const api = await page.evaluate(() => Object.entries(window.api ?? {}).map(([key, value]) => `${key}:${typeof value}`));
  expect(api.length).toBeGreaterThan(0);
  expect(api.every(entry => entry.endsWith(':function'))).toBe(true);
});

test('the page has a strict Content Security Policy', async ({ window: page }) => {
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain(`default-src 'self'`);
  expect(csp).toContain(`script-src 'self'`);
  expect(csp).not.toContain('unsafe-eval');
  // An inline script is refused.
  expect(
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.__inlineRan = true';
      document.head.append(script);
      return (window as unknown as { __inlineRan?: boolean }).__inlineRan ?? false;
    })
  ).toBe(false);
});

test('web permissions are denied', async ({ window: page }) => {
  expect(await page.evaluate(() => Notification.requestPermission())).toBe('denied');
  expect(
    await page.evaluate(() =>
      navigator.mediaDevices.getUserMedia({ video: true }).then(
        () => 'granted',
        () => 'denied'
      )
    )
  ).toBe('denied');
});

test('the page can neither navigate away nor open windows', async ({ app, window: page }) => {
  const url = page.url();
  await page.evaluate(() => {
    window.location.href = 'file:///etc/hosts';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => window.open('file:///etc/hosts') === null)).toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});
