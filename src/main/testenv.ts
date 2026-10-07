import { type IpcMainInvokeEvent, type WebFrameMain, app, ipcMain } from 'electron';
import { isAbsolute, join } from 'path';

import { type SidecarStream, startSidecarStream, testEnvQuery } from './backend';
import { isInKnownProject } from './project';

/**
 * Test environments (the Test Results & Logs tab): Docker hosts managed by the
 * sidecar. One-shot queries answer directly; long actions stream their events
 * to the window that started them ('testenv:event') and can be cancelled.
 */

const BASE_IMAGES = new Set(['ubuntu:22.04', 'ubuntu:24.04', 'debian:12']);
// The streaming actions: pulling a base image, checking a custom one, and an environment's Start / Run / Stop / Destroy.
const STREAMING = new Set(['pull', 'inspect', 'up', 'run', 'test', 'exec', 'start', 'stop', 'destroy', 'reset']);
// [registry[:port]/]name[:tag][@digest], as the sidecar checks it.
const IMAGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/;
// The actions that build the project's policy set, against these masterfiles.
const BUILDING = new Set(['up', 'run', 'test', 'reset']);
const MASTERFILES = /^(\d+\.\d+\.\d+(-\d+)?|master)$/;
// The step kinds the builder emits: `cfbs build` would run any other (`run` executes a command).
const BUILDER_STEP = /^(copy|directory|policy_files|bundles) /;
const runs = new Map<string, SidecarStream>();

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// Local modules ("./…", nothing to fetch) whose steps are all the builder's own.
const isBuilderContent = (content: unknown) =>
  isRecord(content) &&
  isRecord(content.project) &&
  Array.isArray(content.modules) &&
  content.modules.every(
    module =>
      isRecord(module) &&
      typeof module.name === 'string' &&
      module.name.startsWith('./') &&
      Array.isArray(module.steps) &&
      module.steps.every(step => typeof step === 'string' && BUILDER_STEP.test(step))
  );

// What the sidecar gets: the renderer's request, checked, plus where builds and masterfiles are cached.
async function sidecarRequest(action: string, request: unknown): Promise<Record<string, unknown>> {
  if (!isRecord(request)) throw new Error('The request must be an object');
  if (action === 'pull') {
    if (typeof request.image !== 'string' || !BASE_IMAGES.has(request.image)) throw new Error('Not a supported base image');
    return { image: request.image };
  }
  if (action === 'inspect') {
    if (typeof request.image !== 'string' || !IMAGE_REFERENCE.test(request.image)) throw new Error('Not an image reference');
    if (request.arch !== 'x86_64' && request.arch !== 'aarch64') throw new Error('Unknown architecture');
    return { image: request.image, arch: request.arch };
  }
  if (!isRecord(request.environment)) throw new Error('The request needs an environment');
  if (request.envFile !== undefined && request.envFile !== null && (typeof request.envFile !== 'string' || !isAbsolute(request.envFile))) {
    throw new Error('envFile must be an absolute path');
  }
  // It comes from the project's settings: a shared project mustn't hand the hosts files from elsewhere.
  if (typeof request.envFile === 'string' && !(await isInKnownProject(request.envFile))) throw new Error('The .env file must be in the project folder');
  // The version names a folder in the cache: only builds need it.
  const { masterfiles, ...rest } = request;
  const cacheDir = join(app.getPath('userData'), 'testenv');
  return BUILDING.has(action) ? { ...rest, ...checkedBuild(masterfiles, rest.content), cacheDir } : { ...rest, cacheDir };
}

function checkedBuild(masterfiles: unknown, content: unknown): Record<string, unknown> {
  if (typeof masterfiles !== 'string' || !MASTERFILES.test(masterfiles)) throw new Error('Invalid masterfiles version');
  if (!isBuilderContent(content)) throw new Error('Invalid project content');
  return { masterfiles, content };
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
    'testenv:search',
    trusted((_event, query: unknown) => {
      if (!isRecord(query) || typeof query.term !== 'string' || query.term.length > 100) throw new Error('Invalid image search');
      return testEnvQuery('search', { term: query.term, hub: query.hub === true });
    })
  );
  ipcMain.handle(
    'testenv:status',
    trusted(async (_event, request: unknown) => testEnvQuery('status', await sidecarRequest('status', request)))
  );
  ipcMain.handle(
    'testenv:start',
    trusted(async (event, action: unknown, request: unknown) => {
      if (typeof action !== 'string' || !STREAMING.has(action)) throw new Error('Unknown test environment action');
      const payload = await sidecarRequest(action, request);
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
