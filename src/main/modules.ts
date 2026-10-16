import { type WebFrameMain, app, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';

import type { ModuleDetailsResult, ModuleIndexResult } from '../preload/api';

// The CFEngine Build index (build.cfengine.com): every module cfbs can add.
const INDEX_URL = 'https://raw.githubusercontent.com/cfengine/build-index/master/cfbs.json';
const INDEX_TIMEOUT_MS = 15_000;

const cachePath = () => join(app.getPath('userData'), 'module-index.json');

// End-to-end tests (development builds only): the index and details from a folder, not the internet.
const fixtures = () => (!app.isPackaged && process.env.CFPB_MODULE_DATA) || null;
const fixture = async (file: string): Promise<unknown> => JSON.parse(await fs.readFile(join(fixtures()!, file), 'utf-8'));

interface CachedIndex {
  fetchedAt: string;
  index: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

async function readCache(): Promise<CachedIndex | null> {
  try {
    const cached: unknown = JSON.parse(await fs.readFile(cachePath(), 'utf8'));
    return isRecord(cached) && typeof cached.fetchedAt === 'string' && isRecord(cached.index) ? (cached as unknown as CachedIndex) : null;
  } catch {
    return null;
  }
}

async function download(): Promise<CachedIndex> {
  if (fixtures()) return { fetchedAt: new Date().toISOString(), index: ((await fixture('index.json')) as { index: Record<string, unknown> }).index };
  const response = await fetch(INDEX_URL, { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.index)) throw new Error('not a cfbs index');
  const fresh = { fetchedAt: new Date().toISOString(), index: body.index };
  await fs.writeFile(cachePath(), JSON.stringify(fresh));
  return fresh;
}

/** The index, downloaded once per app session (or on refresh); offline, the last copy downloaded. */
let request: Promise<ModuleIndexResult> | null = null;

async function moduleIndex(): Promise<ModuleIndexResult> {
  try {
    return { ...(await download()), offline: false };
  } catch (error) {
    request = null; // try again next time
    const message = error instanceof Error ? error.message : String(error);
    const cached = await readCache();
    return cached ? { ...cached, offline: true, error: message } : { fetchedAt: null, index: null, offline: true, error: message };
  }
}

// The website's data (what build.cfengine.com and Mission Portal show): per module and version, its
// README as HTML, author, downloads, dates and links. Downloaded once per session, cached.
const DETAILS_URL = 'https://build.cfengine.com/js/modules.json';
const MODULE_NAME = /^[a-z0-9][a-z0-9._-]{0,100}$/i;
const detailsPath = () => join(app.getPath('userData'), 'module-details.json');

let detailsRequest: Promise<{ error?: string; modules: Record<string, unknown> | null; offline: boolean }> | null = null;

async function allDetails() {
  try {
    if (fixtures()) return { modules: (await fixture('details.json')) as Record<string, unknown>, offline: false };
    const response = await fetch(DETAILS_URL, { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS * 2) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const modules: unknown = await response.json();
    if (!isRecord(modules)) throw new Error('not the module list');
    await fs.writeFile(detailsPath(), JSON.stringify(modules));
    return { modules, offline: false };
  } catch (error) {
    detailsRequest = null;
    const message = error instanceof Error ? error.message : String(error);
    const cached = await fs
      .readFile(detailsPath(), 'utf8')
      .then(text => JSON.parse(text) as unknown)
      .catch(() => null);
    return { modules: isRecord(cached) ? cached : null, offline: true, error: message };
  }
}

/** One module's latest version, as the website has it (each version is an entry, the latest flagged). */
async function moduleDetails(name: string): Promise<ModuleDetailsResult> {
  const { error, modules, offline } = await (detailsRequest ??= allDetails());
  const versions = modules?.[name];
  if (!isRecord(versions)) return { details: null, offline, error: error ?? 'build.cfengine.com doesn’t list it' };
  const isLatest = ([version, entry]: [string, unknown]) =>
    isRecord(entry) && isRecord(entry.versions) && isRecord(entry.versions[version]) && entry.versions[version].latest === true;
  const [, latest] = Object.entries(versions).find(isLatest) ?? Object.entries(versions).at(-1) ?? [];
  return { details: isRecord(latest) ? latest : null, offline, error };
}

export function registerModuleHandlers(isTrustedFrame: (frame: WebFrameMain | null) => boolean): void {
  ipcMain.handle('modules:index', (event, refresh: unknown) => {
    if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
    if (refresh === true) request = null;
    return (request ??= moduleIndex());
  });
  ipcMain.handle('modules:details', (event, name: unknown) => {
    if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
    if (typeof name !== 'string' || !MODULE_NAME.test(name)) throw new Error('invalid module name');
    return moduleDetails(name);
  });
}
