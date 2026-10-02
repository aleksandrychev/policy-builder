import { type IpcMainInvokeEvent, type WebFrameMain, app, ipcMain } from 'electron';
import { isAbsolute, join } from 'path';

import { type SidecarStream, startSidecarStream, testEnvQuery } from './backend';

/**
 * Test environments (the Test Results & Logs tab): Docker hosts managed by the
 * sidecar. One-shot queries answer directly; long actions stream their events
 * to the window that started them ('testenv:event') and can be cancelled.
 */

const BASE_IMAGES = new Set(['ubuntu:22.04', 'ubuntu:24.04', 'debian:12']);
// The streaming actions: pulling a base image, and an environment's Start / Run / Stop / Destroy.
const STREAMING = new Set(['pull', 'up', 'run', 'test', 'exec', 'stop', 'destroy']);
const runs = new Map<string, SidecarStream>();

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// What the sidecar gets: the renderer's request, checked, plus where builds and masterfiles are cached.
function sidecarRequest(action: string, request: unknown): Record<string, unknown> {
  if (!isRecord(request)) throw new Error('The request must be an object');
  if (action === 'pull') {
    if (typeof request.image !== 'string' || !BASE_IMAGES.has(request.image)) throw new Error('Not a supported base image');
    return { image: request.image };
  }
  if (!isRecord(request.environment)) throw new Error('The request needs an environment');
  if (request.envFile !== undefined && request.envFile !== null && (typeof request.envFile !== 'string' || !isAbsolute(request.envFile))) {
    throw new Error('envFile must be an absolute path');
  }
  return { ...request, cacheDir: join(app.getPath('userData'), 'testenv') };
}

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
    'testenv:platforms',
    trusted((_event, query: unknown) => {
      if (!isRecord(query) || ![query.arch, query.edition, query.version].every(value => typeof value === 'string')) throw new Error('Invalid platforms query');
      const { arch, edition, version } = query;
      return testEnvQuery('platforms', { arch, edition, version, cacheDir: join(app.getPath('userData'), 'testenv') });
    })
  );
  ipcMain.handle(
    'testenv:status',
    trusted((_event, request: unknown) => testEnvQuery('status', sidecarRequest('status', request)))
  );
  ipcMain.handle(
    'testenv:start',
    trusted((event, action: unknown, request: unknown) => {
      if (typeof action !== 'string' || !STREAMING.has(action)) throw new Error('Unknown test environment action');
      const payload = sidecarRequest(action, request);
      const runId = crypto.randomUUID();
      const sender = event.sender;
      const send = (payload: Record<string, unknown>) => {
        if (!sender.isDestroyed()) sender.send('testenv:event', runId, payload);
      };
      const stream = startSidecarStream(['testenv', action], JSON.stringify(payload), send);
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
