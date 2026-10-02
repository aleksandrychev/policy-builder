import { type IpcMainInvokeEvent, type WebFrameMain, app, ipcMain } from 'electron';

import { type SidecarStream, startSidecarStream, testEnvQuery } from './backend';

/**
 * Test environments (the Test Results & Logs tab): Docker hosts managed by the
 * sidecar. One-shot queries answer directly; long actions stream their events
 * to the window that started them ('testenv:event') and can be cancelled.
 */

const BASE_IMAGES = new Set(['ubuntu:22.04', 'ubuntu:24.04', 'debian:12']);
const runs = new Map<string, SidecarStream>();

export function registerTestEnvHandlers(isTrustedFrame: (frame: WebFrameMain | null) => boolean): void {
  const trusted =
    <A extends unknown[], R>(handler: (event: IpcMainInvokeEvent, ...args: A) => R) =>
    (event: IpcMainInvokeEvent, ...args: A) => {
      if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
      return handler(event, ...args);
    };

  ipcMain.handle(
    'testenv:doctor',
    trusted(() => testEnvQuery('doctor'))
  );
  ipcMain.handle(
    'testenv:images',
    trusted(() => testEnvQuery('images'))
  );
  ipcMain.handle(
    'testenv:pull',
    trusted((event, image: unknown) => {
      if (typeof image !== 'string' || !BASE_IMAGES.has(image)) throw new Error('Not a supported base image');
      const runId = crypto.randomUUID();
      const sender = event.sender;
      const send = (payload: Record<string, unknown>) => {
        if (!sender.isDestroyed()) sender.send('testenv:event', runId, payload);
      };
      const stream = startSidecarStream(['testenv', 'pull'], JSON.stringify({ image }), send);
      runs.set(runId, stream);
      void stream.done.then(result => {
        runs.delete(runId);
        // The sidecar's own done/error event may be missing if it was killed or crashed.
        send(result.ok ? { t: 'exit', ok: true } : { t: 'exit', ok: false, message: result.message });
      });
      return runId;
    })
  );
  ipcMain.handle(
    'testenv:cancel',
    trusted((_event, runId: unknown) => {
      if (typeof runId === 'string') runs.get(runId)?.cancel();
    })
  );

  // Nothing outlives the app: streaming runs are child processes.
  app.on('will-quit', () => {
    for (const run of runs.values()) run.cancel();
  });
}
