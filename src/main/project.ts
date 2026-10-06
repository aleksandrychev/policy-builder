import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent, OpenDialogOptions, WebFrameMain } from 'electron';
import { constants, promises as fs } from 'fs';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'path';

import type {
  CreateProjectRequest,
  MasterfilesVersions,
  OperationResult,
  ProjectContent,
  ProjectStorage,
  ProjectType,
  RecentProject,
  TargetCheck
} from '../preload/api';
import { compilePolicy, initCfbsProject, masterfilesEntry } from './backend';

/**
 * The project:* IPC channels: creating a cfbs project on disk (via the Python
 * sidecar), opening one, saving the builder's state into its cfbs.json, and
 * the recent-projects list.
 */

// The builder's own data, next to cfbs.json (which stays plain cfbs).
const BUILDER_FILE = '.policy-builder/project.json';
const TEST_ENVIRONMENTS_FILE = '.policy-builder/test-environments.json';
// Where projects saved before .policy-builder/ kept it: cfbs.json's meta["policy-builder"].
const LEGACY_META_KEY = 'policy-builder';
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

/** Whether `path` is a project folder this session created or opened (deployment acts only on those). */
export const isKnownProject = (path: string) => knownProjects.has(path);

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
function generatedPaths(project: unknown): string[] {
  const generated = isRecord(project) ? project.generated : undefined;
  return Array.isArray(generated) ? generated.filter(isGeneratedPath) : builderPaths(project).filter(isPolicyPath);
}

// The policy file paths the builder's project data lists.
function builderPaths(project: unknown): string[] {
  const files = isRecord(project) ? project.files : undefined;
  return Array.isArray(files) ? files.flatMap(file => (isRecord(file) && typeof file.path === 'string' ? [file.path] : [])) : [];
}

// The modules those files make up: a top-level file is its own, a top-level folder ("./services/") one.
const moduleNameOf = (path: string) => {
  const parts = path.slice(2).split('/');
  return parts.length === 1 ? path : `./${parts[0]}/`;
};
// Plus ./templates/, once a save has generated templates into it.
const builderModules = (project: unknown) => {
  const modules = new Set(builderPaths(project).map(moduleNameOf));
  if (generatedPaths(project).some(path => path.startsWith(TEMPLATES_DIR))) modules.add(TEMPLATES_DIR);
  return modules;
};

function checkedContent(value: unknown): ProjectContent {
  const content = value as Partial<ProjectContent> | null;
  if (!isRecord(content) || !isRecord(content.project) || !Array.isArray(content.modules) || !isRecord(content.provided)) {
    throw new InvalidRequest('Invalid project content');
  }
  if (typeof content.project.module_name !== 'string' || !MODULE_NAME.test(content.project.module_name)) {
    throw new InvalidRequest('Invalid module name');
  }
  const provided = content.provided;
  if (!Array.isArray(provided.steps) || !provided.steps.every(step => typeof step === 'string')) throw new InvalidRequest('Invalid provided module');
  const paths = builderPaths(content.project);
  if (!paths.every(isPolicyPath) || new Set(paths).size !== paths.length) throw new InvalidRequest('Invalid policy file path');
  const modules = builderModules(content.project);
  const names = content.modules.map(module => (isRecord(module) ? module.name : undefined));
  const ok =
    names.length === modules.size &&
    names.every(name => typeof name === 'string' && modules.has(name)) &&
    content.modules.every(module => isRecord(module) && Array.isArray(module.steps));
  if (!ok) throw new InvalidRequest('Invalid policy module');
  if (content.testEnvironments !== undefined && !(Array.isArray(content.testEnvironments) && content.testEnvironments.every(isRecord))) {
    throw new InvalidRequest('Invalid test environments');
  }
  if (JSON.stringify(content).length > MAX_CONTENT_BYTES) throw new InvalidRequest('Project is too large');
  return content as ProjectContent;
}

// A cfbs module name (cfbs validates a module project's name this way).
const MODULE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PROJECT_TYPES: ProjectType[] = ['module', 'policy-set'];

function checkedStorage(value: unknown): ProjectStorage {
  const storage = value as Partial<ProjectStorage> | null;
  const masterfiles = storage?.masterfiles ?? null;
  if (!isRecord(storage) || !PROJECT_TYPES.includes(storage.type as ProjectType)) throw new InvalidRequest('Invalid project type');
  if (masterfiles !== null && (typeof masterfiles !== 'string' || !MASTERFILES.test(masterfiles))) throw new InvalidRequest('Invalid masterfiles version');
  return { masterfiles, type: storage.type as ProjectType };
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

// What a save generated, into the builder's data (so the next save can remove what it no longer
// does), and — for a policy set — the ./templates/ module when there are templates to ship (an
// empty one fails the build). A module ships them with a copy step instead.
function withGenerated(content: ProjectContent, generated: string[], type: ProjectType = 'policy-set'): ProjectContent {
  const templates = type === 'policy-set' && generated.some(path => path.startsWith(TEMPLATES_DIR));
  return {
    ...content,
    project: { ...content.project, generated },
    modules: [...content.modules, ...(templates ? [TEMPLATES_MODULE] : [])]
  };
}

// The app's version, into the builder's data.
const stamped = (content: ProjectContent): ProjectContent => ({ ...content, project: { ...content.project, tool_version: app.getVersion() } });

// A project's builder data: .policy-builder/project.json, else (saved before it existed)
// cfbs.json's meta["policy-builder"], else null for a plain cfbs project.
async function readBuilderProject(folder: string, cfbs: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const path = join(folder, BUILDER_FILE);
  const stats = await fs.stat(path).catch(() => null);
  if (stats) {
    if (!stats.isFile() || stats.size > MAX_CFBS_JSON_BYTES) throw new InvalidRequest(`${BUILDER_FILE} isn't a readable project file.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(path, 'utf-8'));
    } catch (error) {
      throw new InvalidRequest(`${BUILDER_FILE} isn't valid JSON: ${error instanceof Error ? error.message : error}`);
    }
    if (!isRecord(parsed)) throw new InvalidRequest(`${BUILDER_FILE} is not a JSON object.`);
    return parsed;
  }
  const legacy = isRecord(cfbs.meta) ? cfbs.meta[LEGACY_META_KEY] : undefined;
  return isRecord(legacy) ? legacy : null;
}

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

// The module a module project provides, plus the copy that ships its templates.
function providedWithTemplates(content: ProjectContent, moduleName: string, generated: string[]): Record<string, unknown> {
  const provided = content.provided as { steps: string[] };
  if (!generated.some(path => path.startsWith(TEMPLATES_DIR))) return provided;
  const copy = `copy ${TEMPLATES_DIR} services/cfbs/${moduleName}/templates/`;
  const at = provided.steps.findIndex(step => step.startsWith('policy_files '));
  return { ...provided, steps: [...provided.steps.slice(0, at), copy, ...provided.steps.slice(at)] };
}

const isOurProvided = (module: unknown) => isRecord(module) && Array.isArray(module.tags) && module.tags.includes('policy-builder');

/**
 * Merges the builder's content into an existing cfbs.json, shaped as `type` asks (converting
 * it when that changed). Our own entries are replaced — the `build` modules the project's
 * files make up (before and after), and the `provides` entry we wrote — and everything else is
 * kept: other modules, masterfiles, other keys. A policy set's `build` gets our modules; a
 * module's `provides` gets the project, under its module name. Builder data an older save left
 * in `meta` goes (it now lives in .policy-builder/project.json).
 */
export function mergeCfbsJson(
  existing: Record<string, unknown>,
  content: ProjectContent,
  previous: unknown,
  type: ProjectType,
  generated: string[],
  masterfiles: Record<string, unknown> | null = null
): Record<string, unknown> {
  const build = Array.isArray(existing.build) ? existing.build : [];
  const ours = new Set([...builderModules(previous), ...builderModules(content.project)]);
  const others = build.filter(entry => !(isRecord(entry) && ours.has(entry.name as string)));
  const provides = Object.fromEntries(Object.entries(isRecord(existing.provides) ? existing.provides : {}).filter(([, module]) => !isOurProvided(module)));
  const project = content.project as { module_name: string; name: string };
  const merged: Record<string, unknown> = { ...existing, type };
  if (type === 'module') {
    merged.name = project.module_name;
    merged.provides = { ...provides, [project.module_name]: providedWithTemplates(content, project.module_name, generated) };
    if (others.length) merged.build = others;
    else delete merged.build;
  } else {
    merged.name = project.name;
    if (Object.keys(provides).length) merged.provides = provides;
    else delete merged.provides;
    const hasMasterfiles = others.some(entry => isRecord(entry) && entry.name === 'masterfiles');
    merged.build = [...(masterfiles && !hasMasterfiles ? [masterfiles] : []), ...others, ...content.modules];
  }
  return withoutLegacyMeta(merged);
}

// Builder data an older save kept in cfbs.json's `meta` goes; other tools' entries stay.
function withoutLegacyMeta(cfbs: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(cfbs.meta) || !(LEGACY_META_KEY in cfbs.meta)) return cfbs;
  const { [LEGACY_META_KEY]: _legacy, ...otherMeta } = cfbs.meta;
  const { meta: _meta, ...rest } = cfbs;
  return Object.keys(otherMeta).length ? { ...rest, meta: otherMeta } : rest;
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
 * Saves the project: its generated files first, then .policy-builder/project.json,
 * then cfbs.json. Files the previous save generated and this one doesn't are removed.
 */
async function writeProjectContent(projectPath: string, content: ProjectContent, storage: ProjectStorage): Promise<{ masterfiles: string | null }> {
  const cfbsPath = join(projectPath, 'cfbs.json');
  const existing = JSON.parse(await fs.readFile(cfbsPath, 'utf-8'));
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) throw new Error('cfbs.json is not a JSON object');
  // A module becoming a policy set without masterfiles: fetch the entry before writing anything.
  const build: unknown[] = Array.isArray(existing.build) ? existing.build : [];
  const hasMasterfiles = build.some(entry => isRecord(entry) && entry.name === 'masterfiles');
  const masterfiles = storage.type === 'policy-set' && !hasMasterfiles && storage.masterfiles ? await masterfilesEntry(storage.masterfiles) : null;
  const previous = await readBuilderProject(projectPath, existing);
  const { files } = await compilePolicy(content.project);
  const generated = Object.keys(files);
  const missing = builderPaths(content.project).find(path => typeof files[path] !== 'string');
  if (missing) throw new Error(`No policy was generated for ${missing}`);
  const outside = generated.find(path => !isGeneratedPath(path));
  if (outside) throw new Error(`Refusing to write generated policy outside the project: ${outside}`);
  for (const path of generated) {
    const target = join(projectPath, path);
    await fs.mkdir(dirname(target), { recursive: true });
    await writeFileAtomic(target, files[path]);
  }
  for (const stale of generatedPaths(previous).filter(path => !generated.includes(path))) {
    await fs.rm(join(projectPath, stale), { force: true });
    await removeEmptyFolders(projectPath, dirname(stale));
  }
  const saved = withGenerated(stamped(content), generated, storage.type);
  await fs.mkdir(dirname(join(projectPath, BUILDER_FILE)), { recursive: true });
  await writeFileAtomic(join(projectPath, BUILDER_FILE), `${JSON.stringify(saved.project, null, 2)}\n`);
  await writeTestEnvironments(projectPath, content.testEnvironments);
  const merged = mergeCfbsJson(existing, saved, previous, storage.type, generated, masterfiles);
  await writeFileAtomic(cfbsPath, `${JSON.stringify(merged, null, 2)}\n`);
  const entry = (Array.isArray(merged.build) ? merged.build : []).find(item => isRecord(item) && item.name === 'masterfiles') as
    Record<string, unknown> | undefined;
  const version = entry ? (typeof entry.version === 'string' ? entry.version : 'master') : null;
  return { masterfiles: version };
}

// The project's test environments (the Test Results & Logs tab); no file when there are none.
async function writeTestEnvironments(projectPath: string, environments: object[] | undefined): Promise<void> {
  const path = join(projectPath, TEST_ENVIRONMENTS_FILE);
  if (!environments?.length) return fs.rm(path, { force: true });
  await fs.mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify({ environments }, null, 2)}\n`);
}

async function readTestEnvironments(folder: string): Promise<unknown[] | null> {
  const parsed: unknown = await fs
    .readFile(join(folder, TEST_ENVIRONMENTS_FILE), 'utf-8')
    .then(text => JSON.parse(text))
    .catch(() => null);
  return isRecord(parsed) && Array.isArray(parsed.environments) ? parsed.environments : null;
}

/** The test environments' secrets (.env) files, relative to the project ("./.env" → ".env"); none outside it. */
export async function testEnvironmentSecretFiles(folder: string): Promise<string[]> {
  const files = ((await readTestEnvironments(folder)) ?? []).flatMap(environment =>
    isRecord(environment) && typeof environment.envFile === 'string' && environment.envFile.trim() ? [normalize(environment.envFile.trim())] : []
  );
  return [...new Set(files.filter(file => !isAbsolute(file) && file !== '.' && !file.startsWith('..')))];
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
  const builder = await readBuilderProject(path, cfbs);
  const testEnvironments = await readTestEnvironments(path);
  knownProjects.add(path);
  await rememberRecent(path, typeof cfbs.name === 'string' && cfbs.name.trim() ? cfbs.name.trim() : basename(path));
  return { ok: true as const, builder, cfbs, path, testEnvironments };
}

async function createProject(request: CreateProjectRequest) {
  const parent = checkedAbsolutePath(request?.parent, 'location');
  const folderName = checkedFolderName(request.folderName);
  const name = checkedString(request.name, 'project name', 100);
  const description = checkedString(request.description, 'description', 500);
  if (typeof request.git !== 'boolean') throw new InvalidRequest('Invalid git option');
  if (typeof request.masterfiles !== 'string' || !MASTERFILES.test(request.masterfiles)) throw new InvalidRequest('Invalid masterfiles version');
  const content = stamped(
    checkedContent({ project: request.project, modules: request.modules, provided: request.provided, testEnvironments: request.testEnvironments })
  );
  const type = checkedStorage({ type: request.type, masterfiles: null }).type;
  const check = await checkTarget(parent, folderName);
  if (!check.parentWritable) throw new InvalidRequest(`Can't write to ${parent}`);
  if (check.targetState === 'nonEmpty') throw new InvalidRequest(`A folder named '${folderName}' already exists and isn't empty.`);

  // The content goes in before the initial commit, so a git project starts clean.
  const result = await initCfbsProject({
    content,
    description,
    directory: join(parent, folderName),
    git: request.git,
    masterfiles: request.masterfiles,
    name,
    type
  });
  await writeTestEnvironments(result.path, content.testEnvironments);
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
    trusted(async (_event, request: { modules?: unknown; path?: unknown; project?: unknown; provided?: unknown; storage?: unknown }) => {
      try {
        const path = checkedAbsolutePath(request?.path, 'project path');
        if (!knownProjects.has(path)) throw new InvalidRequest('Not a project opened in this session');
        const content = checkedContent({ project: request.project, modules: request.modules, provided: request.provided });
        const { masterfiles } = await writeProjectContent(path, content, checkedStorage(request.storage));
        return { ok: true as const, masterfiles };
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
