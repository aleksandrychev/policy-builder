import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent, OpenDialogOptions, WebFrameMain } from 'electron';
import { constants, promises as fs } from 'fs';
import { dirname, isAbsolute, join, normalize } from 'path';

import type { CreateProjectRequest, MasterfilesVersions, OperationResult, ProjectContent, TargetCheck } from '../preload/api';
import { initCfbsProject } from './backend';

/**
 * The project:* IPC channels: creating a cfbs project on disk (via the Python
 * sidecar) and saving the builder's state into its cfbs.json.
 */

// The builder's key under cfbs.json's top-level `meta`.
const META_KEY = 'policy-builder';
const VERSIONS_URL = 'https://raw.githubusercontent.com/cfengine/build-index/master/versions.json';
const VERSIONS_TIMEOUT_MS = 5000;
const FALLBACK_VERSIONS: MasterfilesVersions = { latest: '3.27.1', lts: '3.24.4' };
const FOLDER_NAME = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const MASTERFILES = /^(\d+\.\d+\.\d+(-\d+)?|master|no)$/;
const MAX_PATH_LENGTH = 4096;
const MAX_CONTENT_BYTES = 50_000_000;

// Project folders this session created; saves may only write into these.
const knownProjects = new Set<string>();

let versionsRequest: Promise<MasterfilesVersions> | null = null;

class InvalidRequest extends Error {}

interface AppSettings {
  lastProjectParent?: string;
}

const settingsPath = () => join(app.getPath('userData'), 'app-settings.json');

async function readSettings(): Promise<AppSettings> {
  try {
    const parsed = JSON.parse(await fs.readFile(settingsPath(), 'utf-8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSettings(patch: AppSettings): Promise<void> {
  await writeFileAtomic(settingsPath(), JSON.stringify({ ...(await readSettings()), ...patch }, null, 2));
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${Date.now()}-${process.pid}.tmp`);
  await fs.writeFile(temp, content);
  try {
    await fs.rename(temp, path);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function checkedString(value: unknown, what: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new InvalidRequest(`Invalid ${what}`);
  return value.trim();
}

function checkedAbsolutePath(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length > MAX_PATH_LENGTH || !isAbsolute(value) || value.includes('\0')) throw new InvalidRequest(`Invalid ${what}`);
  return normalize(value);
}

function checkedFolderName(value: unknown): string {
  if (typeof value !== 'string' || !FOLDER_NAME.test(value)) throw new InvalidRequest('Invalid project folder name');
  return value;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The module paths the builder's meta says are its own.
function builderPaths(meta: unknown): string[] {
  const files = isRecord(meta) && isRecord(meta[META_KEY]) ? meta[META_KEY].files : undefined;
  return Array.isArray(files) ? files.flatMap(file => (isRecord(file) && typeof file.path === 'string' ? [file.path] : [])) : [];
}

function checkedContent(value: unknown): ProjectContent {
  const content = value as Partial<ProjectContent> | null;
  if (!isRecord(content) || !isRecord(content.meta) || !isRecord(content.meta[META_KEY]) || !Array.isArray(content.modules)) {
    throw new InvalidRequest('Invalid project content');
  }
  const paths = builderPaths(content.meta);
  if (paths.length !== content.modules.length) throw new InvalidRequest('Invalid project content');
  for (const [index, module] of content.modules.entries()) {
    const name = isRecord(module) ? module.name : undefined;
    const ok =
      name === paths[index] &&
      typeof name === 'string' &&
      name.startsWith('./policy/') &&
      name.endsWith('.cf') &&
      !name.split('/').includes('..') &&
      Array.isArray((module as Record<string, unknown>).steps);
    if (!ok) throw new InvalidRequest('Invalid policy module');
  }
  if (JSON.stringify(content).length > MAX_CONTENT_BYTES) throw new InvalidRequest('Project is too large');
  return content as ProjectContent;
}

// The app's version, into the builder's project meta.
const stamped = (content: ProjectContent): ProjectContent => ({
  ...content,
  meta: { ...content.meta, [META_KEY]: { ...content.meta[META_KEY], tool_version: app.getVersion() } }
});

async function checkTarget(parent: string, folderName: string): Promise<TargetCheck> {
  let parentWritable = await isDirectory(parent);
  if (parentWritable)
    parentWritable = await fs.access(parent, constants.W_OK).then(
      () => true,
      () => false
    );
  const target = join(parent, folderName);
  let targetState: TargetCheck['targetState'] = 'new';
  try {
    const stats = await fs.stat(target);
    targetState = stats.isDirectory() && (await fs.readdir(target)).length === 0 ? 'empty' : 'nonEmpty';
  } catch {
    targetState = 'new';
  }
  return { parentWritable, targetState };
}

// Highest `major.minor.*` masterfiles release in the build index, e.g. "3.27" → "3.27.1".
function highestRelease(versions: string[], minor: string): string | undefined {
  const parts = (version: string) => version.split(/[.-]/).map(Number);
  return versions
    .filter(version => version.startsWith(`${minor}.`) && /^\d+\.\d+\.\d+(-\d+)?$/.test(version))
    .sort((a, b) => {
      const [pa, pb] = [parts(a), parts(b)];
      for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
        if ((pa[index] ?? 0) !== (pb[index] ?? 0)) return (pa[index] ?? 0) - (pb[index] ?? 0);
      }
      return 0;
    })
    .at(-1);
}

async function fetchMasterfilesVersions(): Promise<MasterfilesVersions> {
  try {
    const response = await fetch(VERSIONS_URL, { signal: AbortSignal.timeout(VERSIONS_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const index = (await response.json()) as { masterfiles?: Record<string, unknown> };
    const versions = Object.keys(index.masterfiles ?? {});
    return { latest: highestRelease(versions, '3.27') ?? FALLBACK_VERSIONS.latest, lts: highestRelease(versions, '3.24') ?? FALLBACK_VERSIONS.lts };
  } catch (error) {
    console.error(`[project] masterfiles versions unavailable, using built-in ones: ${error}`);
    versionsRequest = null; // retry next time
    return FALLBACK_VERSIONS;
  }
}

/**
 * Merges builder state into an existing cfbs.json: our `meta` entry replaced,
 * our modules (the paths it lists, before and after) replaced after everything
 * else, other tools' meta and all other keys and entries kept. .cf files
 * aren't written yet — no compiler.
 */
export function mergeCfbsJson(existing: Record<string, unknown>, content: ProjectContent): Record<string, unknown> {
  const build = Array.isArray(existing.build) ? existing.build : [];
  const ours = new Set([...builderPaths(existing.meta), ...builderPaths(content.meta)]);
  const meta = { ...(isRecord(existing.meta) ? existing.meta : {}), ...content.meta };
  return { ...existing, meta, build: [...build.filter(entry => !(isRecord(entry) && ours.has(entry.name as string))), ...content.modules] };
}

async function writeProjectContent(projectPath: string, content: ProjectContent): Promise<void> {
  const cfbsPath = join(projectPath, 'cfbs.json');
  const existing = JSON.parse(await fs.readFile(cfbsPath, 'utf-8'));
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) throw new Error('cfbs.json is not a JSON object');
  await writeFileAtomic(cfbsPath, `${JSON.stringify(mergeCfbsJson(existing, stamped(content)), null, 2)}\n`);
}

const failure = (error: unknown): OperationResult<never> => ({
  ok: false,
  message: error instanceof Error ? error.message : String(error),
  details: typeof (error as { details?: unknown })?.details === 'string' ? (error as { details: string }).details : ''
});

async function createProject(request: CreateProjectRequest) {
  const parent = checkedAbsolutePath(request?.parent, 'location');
  const folderName = checkedFolderName(request.folderName);
  const name = checkedString(request.name, 'project name', 100);
  const description = checkedString(request.description, 'description', 500);
  if (typeof request.git !== 'boolean') throw new InvalidRequest('Invalid git option');
  if (typeof request.masterfiles !== 'string' || !MASTERFILES.test(request.masterfiles)) throw new InvalidRequest('Invalid masterfiles version');
  const content = stamped(checkedContent({ meta: request.meta, modules: request.modules }));
  const check = await checkTarget(parent, folderName);
  if (!check.parentWritable) throw new InvalidRequest(`Can't write to ${parent}`);
  if (check.targetState === 'nonEmpty') throw new InvalidRequest(`A folder named '${folderName}' already exists and isn't empty.`);

  // The content goes in before the initial commit, so a git project starts clean.
  const result = await initCfbsProject({ content, description, directory: join(parent, folderName), git: request.git, masterfiles: request.masterfiles, name });
  knownProjects.add(result.path);
  await writeSettings({ lastProjectParent: parent }).catch(error => console.error(`[project] settings not saved: ${error}`));
  const version = result.masterfiles?.version;
  const masterfiles = request.masterfiles === 'no' ? null : typeof version === 'string' ? version : request.masterfiles;
  return { ok: true as const, masterfiles, path: result.path };
}

export function registerProjectHandlers(isTrustedFrame: (frame: WebFrameMain | null) => boolean): void {
  const trusted =
    <A extends unknown[], R>(handler: (event: IpcMainInvokeEvent, ...args: A) => R) =>
    (event: IpcMainInvokeEvent, ...args: A) => {
      if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
      return handler(event, ...args);
    };

  ipcMain.handle(
    'project:default-parent',
    trusted(async () => {
      const { lastProjectParent } = await readSettings();
      if (typeof lastProjectParent === 'string' && isAbsolute(lastProjectParent) && (await isDirectory(lastProjectParent))) return lastProjectParent;
      return app.getPath('documents');
    })
  );

  ipcMain.handle(
    'project:pick-directory',
    trusted(async (event, defaultPath: unknown) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options: OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: typeof defaultPath === 'string' && isAbsolute(defaultPath) ? defaultPath : undefined
      };
      const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
      return result.canceled ? null : (result.filePaths[0] ?? null);
    })
  );

  ipcMain.handle(
    'project:masterfiles-versions',
    trusted(() => (versionsRequest ??= fetchMasterfilesVersions()))
  );

  ipcMain.handle(
    'project:check-target',
    trusted((_event, request: { folderName?: unknown; parent?: unknown }) =>
      checkTarget(checkedAbsolutePath(request?.parent, 'location'), checkedFolderName(request.folderName))
    )
  );

  ipcMain.handle(
    'project:create',
    trusted((_event, request: CreateProjectRequest) => createProject(request).catch(failure))
  );

  ipcMain.handle(
    'project:save',
    trusted(async (_event, request: { meta?: unknown; modules?: unknown; path?: unknown }) => {
      try {
        const path = checkedAbsolutePath(request?.path, 'project path');
        if (!knownProjects.has(path)) throw new InvalidRequest('Not a project opened in this session');
        await writeProjectContent(path, checkedContent({ meta: request.meta, modules: request.modules }));
        return { ok: true as const };
      } catch (error) {
        return failure(error);
      }
    })
  );

  ipcMain.handle(
    'project:reveal',
    trusted((_event, path: unknown) => {
      const checked = checkedAbsolutePath(path, 'project path');
      if (knownProjects.has(checked)) shell.showItemInFolder(join(checked, 'cfbs.json'));
    })
  );
}
