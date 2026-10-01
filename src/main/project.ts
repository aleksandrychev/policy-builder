import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent, OpenDialogOptions, WebFrameMain } from 'electron';
import { constants, promises as fs } from 'fs';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'path';

import type { CreateProjectRequest, MasterfilesVersions, OperationResult, ProjectContent, RecentProject, TargetCheck } from '../preload/api';
import { compilePolicy, initCfbsProject } from './backend';

/**
 * The project:* IPC channels: creating a cfbs project on disk (via the Python
 * sidecar), opening one, saving the builder's state into its cfbs.json, and
 * the recent-projects list.
 */

// The builder's key under cfbs.json's top-level `meta`.
const META_KEY = 'policy-builder';
const VERSIONS_URL = 'https://raw.githubusercontent.com/cfengine/build-index/master/versions.json';
const VERSIONS_TIMEOUT_MS = 5000;
const FALLBACK_VERSIONS: MasterfilesVersions = { latest: '3.27.1' };
const FOLDER_NAME = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const MASTERFILES = /^(\d+\.\d+\.\d+(-\d+)?|master|no)$/;
const MAX_PATH_LENGTH = 4096;
const MAX_CONTENT_BYTES = 50_000_000;
const MAX_CFBS_JSON_BYTES = 10_000_000;
const MAX_RECENTS = 5;

// Project folders this session created or opened; saves may only write into these.
const knownProjects = new Set<string>();

let versionsRequest: Promise<MasterfilesVersions> | null = null;

class InvalidRequest extends Error {}

interface AppSettings {
  lastProjectParent?: string;
  recentProjects?: { name: string; path: string }[];
}

let recentsListener: (() => void) | null = null;

const settingsPath = () => join(app.getPath('userData'), 'app-settings.json');

async function readSettings(): Promise<AppSettings> {
  try {
    const parsed = JSON.parse(await fs.readFile(settingsPath(), 'utf-8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

// Queued, so concurrent read-modify-writes can't drop each other's changes.
let settingsWrite: Promise<void> = Promise.resolve();

function writeSettings(patch: AppSettings): Promise<void> {
  const write = settingsWrite.then(async () => writeFileAtomic(settingsPath(), JSON.stringify({ ...(await readSettings()), ...patch }, null, 2)));
  settingsWrite = write.catch(() => {});
  return write;
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

// A policy file's path in the project: slugged folders, a .cf, never in cfbs's out/.
const POLICY_PATH = /^\.\/([a-z][a-z0-9_-]*\/)*[a-z][a-z0-9_]*\.cf$/;
const isPolicyPath = (path: unknown): path is string => typeof path === 'string' && POLICY_PATH.test(path) && !path.startsWith('./out/');
// Anything a save generates: a policy file, or a template next to one.
const GENERATED_PATH = /^\.\/([a-z][a-z0-9_-]*\/)*[a-z][a-z0-9_]*\.(cf|mustache)$/;
const isGeneratedPath = (path: unknown): path is string => typeof path === 'string' && GENERATED_PATH.test(path) && !path.startsWith('./out/');

// What the previous save generated (older projects list only their policy files).
function generatedPaths(meta: unknown): string[] {
  const generated = isRecord(meta) && isRecord(meta[META_KEY]) ? meta[META_KEY].generated : undefined;
  return Array.isArray(generated) ? generated.filter(isGeneratedPath) : builderPaths(meta).filter(isPolicyPath);
}

// The policy file paths the builder's meta lists.
function builderPaths(meta: unknown): string[] {
  const files = isRecord(meta) && isRecord(meta[META_KEY]) ? meta[META_KEY].files : undefined;
  return Array.isArray(files) ? files.flatMap(file => (isRecord(file) && typeof file.path === 'string' ? [file.path] : [])) : [];
}

// The modules those files make up: a top-level file is its own, a top-level folder ("./services/") one.
const moduleNameOf = (path: string) => {
  const parts = path.slice(2).split('/');
  return parts.length === 1 ? path : `./${parts[0]}/`;
};
// Plus ./templates/, once a save has generated templates into it.
const builderModules = (meta: unknown) => {
  const modules = new Set(builderPaths(meta).map(moduleNameOf));
  if (generatedPaths(meta).some(path => path.startsWith(TEMPLATES_DIR))) modules.add(TEMPLATES_DIR);
  return modules;
};

function checkedContent(value: unknown): ProjectContent {
  const content = value as Partial<ProjectContent> | null;
  if (!isRecord(content) || !isRecord(content.meta) || !isRecord(content.meta[META_KEY]) || !Array.isArray(content.modules)) {
    throw new InvalidRequest('Invalid project content');
  }
  const paths = builderPaths(content.meta);
  if (!paths.every(isPolicyPath) || new Set(paths).size !== paths.length) throw new InvalidRequest('Invalid policy file path');
  const modules = builderModules(content.meta);
  const names = content.modules.map(module => (isRecord(module) ? module.name : undefined));
  const ok =
    names.length === modules.size &&
    names.every(name => typeof name === 'string' && modules.has(name)) &&
    content.modules.every(module => isRecord(module) && Array.isArray(module.steps));
  if (!ok) throw new InvalidRequest('Invalid policy module');
  if (JSON.stringify(content).length > MAX_CONTENT_BYTES) throw new InvalidRequest('Project is too large');
  return content as ProjectContent;
}

// Templates' directory module, as `cfbs add ./templates/` writes it.
const TEMPLATES_DIR = './templates/';
const TEMPLATES_MODULE = {
  name: TEMPLATES_DIR,
  description: 'Local subdirectory added using cfbs command line',
  tags: ['local'],
  added_by: 'cfbs add',
  steps: ['directory ./ services/cfbs/templates/']
};

// What a save generated, into the meta (so the next save can remove what it no longer
// does), and the ./templates/ module when there are templates to ship (an empty one fails the build).
function withGenerated(content: ProjectContent, generated: string[]): ProjectContent {
  const templates = generated.some(path => path.startsWith(TEMPLATES_DIR));
  return {
    meta: { ...content.meta, [META_KEY]: { ...content.meta[META_KEY], generated } },
    modules: [...content.modules, ...(templates ? [TEMPLATES_MODULE] : [])]
  };
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
    return { latest: highestRelease(versions, '3.27') ?? FALLBACK_VERSIONS.latest };
  } catch (error) {
    console.error(`[project] masterfiles versions unavailable, using built-in ones: ${error}`);
    versionsRequest = null; // retry next time
    return FALLBACK_VERSIONS;
  }
}

/**
 * Merges builder state into an existing cfbs.json: our `meta` entry replaced,
 * our modules (the ones its files make up, before and after) replaced after
 * everything else, other tools' meta and all other keys and entries kept.
 */
export function mergeCfbsJson(existing: Record<string, unknown>, content: ProjectContent): Record<string, unknown> {
  const build = Array.isArray(existing.build) ? existing.build : [];
  const ours = new Set([...builderModules(existing.meta), ...builderModules(content.meta)]);
  const meta = { ...(isRecord(existing.meta) ? existing.meta : {}), ...content.meta };
  return { ...existing, meta, build: [...build.filter(entry => !(isRecord(entry) && ours.has(entry.name as string))), ...content.modules] };
}

// A moved or deleted file's folders, once nothing is left in them (git doesn't keep empty ones).
async function removeEmptyFolders(projectPath: string, folder: string): Promise<void> {
  for (let current = folder; current !== '.' && current !== './' && current !== ''; current = dirname(current)) {
    const removed = await fs.rmdir(join(projectPath, current)).then(
      () => true,
      () => false
    );
    if (!removed) return;
  }
}

/**
 * Saves the project: its generated .cf files first, then cfbs.json. Policy
 * files the previous save generated and this one doesn't are removed.
 */
async function writeProjectContent(projectPath: string, content: ProjectContent): Promise<void> {
  const cfbsPath = join(projectPath, 'cfbs.json');
  const existing = JSON.parse(await fs.readFile(cfbsPath, 'utf-8'));
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) throw new Error('cfbs.json is not a JSON object');
  const files = await compilePolicy(content.meta[META_KEY]);
  const generated = Object.keys(files);
  const missing = builderPaths(content.meta).find(path => typeof files[path] !== 'string');
  if (missing) throw new Error(`No policy was generated for ${missing}`);
  const outside = generated.find(path => !isGeneratedPath(path));
  if (outside) throw new Error(`Refusing to write generated policy outside the project: ${outside}`);
  for (const path of generated) {
    const target = join(projectPath, path);
    await fs.mkdir(dirname(target), { recursive: true });
    await writeFileAtomic(target, files[path]);
  }
  for (const stale of generatedPaths(existing.meta).filter(path => !generated.includes(path))) {
    await fs.rm(join(projectPath, stale), { force: true });
    await removeEmptyFolders(projectPath, dirname(stale));
  }
  const saved = withGenerated(stamped(content), generated);
  await writeFileAtomic(cfbsPath, `${JSON.stringify(mergeCfbsJson(existing, saved), null, 2)}\n`);
}

const failure = (error: unknown): OperationResult<never> => ({
  ok: false,
  message: error instanceof Error ? error.message : String(error),
  details: typeof (error as { details?: unknown })?.details === 'string' ? (error as { details: string }).details : ''
});

async function defaultParent(): Promise<string> {
  const { lastProjectParent } = await readSettings();
  if (typeof lastProjectParent === 'string' && isAbsolute(lastProjectParent) && (await isDirectory(lastProjectParent))) return lastProjectParent;
  return app.getPath('documents');
}

async function readRecents(): Promise<{ name: string; path: string }[]> {
  const { recentProjects } = await readSettings();
  if (!Array.isArray(recentProjects)) return [];
  return recentProjects.filter(entry => typeof entry?.name === 'string' && typeof entry.path === 'string' && isAbsolute(entry.path)).slice(0, MAX_RECENTS);
}

async function updateRecents(update: (recents: { name: string; path: string }[]) => { name: string; path: string }[]): Promise<void> {
  try {
    await writeSettings({ recentProjects: update(await readRecents()).slice(0, MAX_RECENTS) });
    recentsListener?.();
  } catch (error) {
    console.error(`[project] recent projects not saved: ${error}`);
  }
}

async function rememberRecent(path: string, name: string): Promise<void> {
  if (process.platform === 'darwin') app.addRecentDocument(path);
  await updateRecents(recents => [{ name, path }, ...recents.filter(entry => entry.path !== path)]);
}

/** The recent projects, most recent first; `exists` is false once the folder or its cfbs.json is gone. */
export async function getRecentProjects(): Promise<RecentProject[]> {
  const exists = (path: string) =>
    fs.stat(join(path, 'cfbs.json')).then(
      stats => stats.isFile(),
      () => false
    );
  return Promise.all((await readRecents()).map(async entry => ({ ...entry, exists: await exists(entry.path) })));
}

export const forgetRecentProject = (path: string) => updateRecents(recents => recents.filter(entry => entry.path !== path));

export function clearRecentProjects(): Promise<void> {
  if (process.platform === 'darwin') app.clearRecentDocuments();
  return updateRecents(() => []);
}

/** Called whenever the recent-projects list changes (the File menu rebuilds). */
export function onRecentsChanged(listener: () => void): void {
  recentsListener = listener;
}

// A picked/dropped path → the project folder: the folder itself, or a cfbs.json's.
async function projectFolderOf(picked: string): Promise<string> {
  const stats = await fs.stat(picked).catch(() => null);
  if (!stats) throw new InvalidRequest(`${picked} doesn't exist`);
  if (stats.isDirectory()) return picked;
  if (stats.isFile() && basename(picked) === 'cfbs.json') return dirname(picked);
  throw new InvalidRequest('Choose a project folder or its cfbs.json file.');
}

async function readCfbsJson(folder: string): Promise<Record<string, unknown>> {
  const cfbsPath = join(folder, 'cfbs.json');
  const stats = await fs.stat(cfbsPath).catch(() => null);
  if (!stats?.isFile()) throw new InvalidRequest(`${folder} isn't a cfbs project: it has no cfbs.json.`);
  if (stats.size > MAX_CFBS_JSON_BYTES) throw new InvalidRequest(`cfbs.json is too large (max ${MAX_CFBS_JSON_BYTES / 1_000_000} MB).`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(cfbsPath, 'utf-8'));
  } catch (error) {
    throw new InvalidRequest(`cfbs.json isn't valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new InvalidRequest('cfbs.json is not a JSON object.');
  const json = parsed as Record<string, unknown>;
  if (json.type !== undefined && json.type !== 'policy-set')
    throw new InvalidRequest(`This cfbs.json is a cfbs ${String(json.type)}, not a policy set project.`);
  if (json.type === undefined && typeof json.name !== 'string' && !Array.isArray(json.build)) throw new InvalidRequest('This doesn’t look like a cfbs.json.');
  return json;
}

async function pickProject(event: IpcMainInvokeEvent): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(event.sender);
  // Only macOS can pick a file or a folder in one dialog; elsewhere a cfbs.json can be dropped instead.
  const options: OpenDialogOptions = {
    title: 'Open Project',
    buttonLabel: 'Open',
    message: 'Choose a cfbs project folder or its cfbs.json',
    properties: process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openDirectory'],
    defaultPath: await defaultParent()
  };
  const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function openProject(event: IpcMainInvokeEvent, request: { path?: unknown }) {
  const picked = request?.path === undefined ? await pickProject(event) : checkedAbsolutePath(request.path, 'project path');
  if (picked === null) return null;
  const path = await projectFolderOf(resolve(picked));
  const cfbs = await readCfbsJson(path);
  knownProjects.add(path);
  await rememberRecent(path, typeof cfbs.name === 'string' && cfbs.name.trim() ? cfbs.name.trim() : basename(path));
  return { ok: true as const, cfbs, path };
}

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
  await rememberRecent(result.path, name);
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
    trusted(() => defaultParent())
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
    'project:open',
    trusted((event, request: { path?: unknown }) => openProject(event, request).catch(failure))
  );

  ipcMain.handle('project:recents', trusted(getRecentProjects));

  ipcMain.handle(
    'project:forget-recent',
    trusted((_event, request: { path?: unknown }) => forgetRecentProject(checkedAbsolutePath(request?.path, 'project path')))
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
