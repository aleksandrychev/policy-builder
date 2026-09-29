import { blockDescriptorsById } from '../blocks/loadBlocks';
import { executionOrder } from '../canvas/executionOrder';
import type { RootState } from '../store';
import type { BlockInstance, Condition } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';
import filesReducer, { projectFilesInitialized } from '../store/filesSlice';
import type { PolicyFile, PolicyFolder } from '../store/filesSlice/types';
import type { BlockGroup } from '../store/groupsSlice/types';
import type { UndoableKey } from '../store/history';

/**
 * The builder's state as it's stored in cfbs.json: a normal cfbs project with
 * one plain local file module per policy file (what `cfbs add ./policy/x.cf`
 * writes), and all of the builder's own data — folders and every file's
 * canvas — in the top-level `meta["policy-builder"]`. Folders are only path
 * prefixes. The .cf files themselves aren't generated yet.
 */

export const SCHEMA_VERSION = 1;
export const META_KEY = 'policy-builder';
const POLICY_DIR = './policy/';
const OUTPUT_DIR = 'services/cfbs/policy/';

export type ProjectData = Pick<RootState, UndoableKey>;
type Position = { x: number; y: number };

export interface ProjectMeta {
  current_file_id: string | null;
  // In build order; each file's `path` is its module's name.
  files: FileMeta[];
  // `path` is the folder's directory, e.g. "./policy/services/".
  folders: (PolicyFolder & { path: string })[];
  schema_version: number;
  // Stamped by the main process on save (the app's version).
  tool_version?: string;
}

export interface FileMeta {
  blocks: Omit<BlockInstance, 'fileId' | 'position'>[];
  condition?: Condition;
  edges: Omit<BlockEdge, 'fileId'>[];
  id: string;
  // Editor-only: nothing here changes the compiled policy.
  layout: {
    // derivedNodes positions, keyed without the `${fileId}|` prefix.
    derived_positions: Record<string, Position>;
    groups: Omit<BlockGroup, 'fileId'>[];
    positions: Record<string, Position>;
  };
  // The display name; the path is a slug.
  name: string;
  namespace: string;
  // The methods: call order, resolved here so a compiler needs no canvas.
  order: string[];
  // The file's module in `build`, e.g. "./policy/services/cron_jobs.cf".
  path: string;
}

export interface PolicyModule {
  added_by: 'cfbs add';
  description: string;
  name: string;
  steps: string[];
  tags: string[];
}

export interface CfbsProjectContent {
  meta: { [META_KEY]: ProjectMeta };
  modules: PolicyModule[];
}

const withoutFileId = <T extends { fileId: string }>({ fileId: _fileId, ...rest }: T): Omit<T, 'fileId'> => rest;

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'folder';

// Folder id → its directory; sibling folders whose slugs clash get -2, -3….
function folderPaths(folders: PolicyFolder[]): Map<string, string> {
  const paths = new Map<string, string>();
  const resolve = (folder: PolicyFolder): string => {
    const known = paths.get(folder.id);
    if (known) return known;
    const parent = folders.find(item => item.id === folder.parentId);
    const base = parent ? resolve(parent) : POLICY_DIR;
    const taken = new Set([...paths.values()]);
    let path = `${base}${slug(folder.name)}/`;
    for (let suffix = 2; taken.has(path); suffix += 1) path = `${base}${slug(folder.name)}-${suffix}/`;
    paths.set(folder.id, path);
    return path;
  };
  folders.forEach(resolve);
  return paths;
}

// cfbs wants a module's file name to start with a lowercase letter.
const fileNameOf = (namespace: string) => `${/^[a-z]/.test(namespace) ? '' : 'file_'}${namespace}.cf`;

function toFileMeta(file: PolicyFile, path: string, data: ProjectData): FileMeta {
  const prefix = `${file.id}|`;
  const instances = data.canvas.filter(block => block.fileId === file.id);
  const edges = data.edges.filter(edge => edge.fileId === file.id);
  const derivedPositions = Object.entries(data.derivedNodes)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, position]) => [key.slice(prefix.length), position]);
  return {
    id: file.id,
    name: file.name,
    namespace: file.namespace,
    path,
    ...(file.condition ? { condition: file.condition } : {}),
    blocks: instances.map(({ fileId: _fileId, position: _position, ...rest }) => rest),
    edges: edges.map(withoutFileId),
    order: executionOrder(instances, edges, blockDescriptorsById),
    layout: {
      positions: Object.fromEntries(instances.flatMap(block => (block.position ? [[block.instanceId, block.position]] : []))),
      groups: data.groups.filter(group => group.fileId === file.id).map(withoutFileId),
      derived_positions: Object.fromEntries(derivedPositions)
    }
  };
}

// Exactly what `cfbs add` writes, except the namespaced bundle (it would write `bundles main`).
function toModule(file: PolicyFile, path: string): PolicyModule {
  const output = `${OUTPUT_DIR}${path.slice(POLICY_DIR.length)}`;
  return {
    name: path,
    description: 'Local policy file added using cfbs command line',
    tags: ['local'],
    added_by: 'cfbs add',
    steps: [`copy ${path} ${output}`, `policy_files ${output}`, `bundles ${file.namespace}:main`]
  };
}

export function toCfbsProject(data: ProjectData): CfbsProjectContent {
  const paths = folderPaths(data.files.folders);
  const pathOf = (file: PolicyFile) => `${(file.parentId && paths.get(file.parentId)) || POLICY_DIR}${fileNameOf(file.namespace)}`;
  return {
    meta: {
      [META_KEY]: {
        schema_version: SCHEMA_VERSION,
        folders: data.files.folders.map(folder => ({ ...folder, path: paths.get(folder.id)! })),
        files: data.files.files.map(file => toFileMeta(file, pathOf(file), data)),
        current_file_id: data.files.currentFileId
      }
    },
    modules: data.files.files.map(file => toModule(file, pathOf(file)))
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The builder's part of cfbs.json's `meta`, if any.
const builderMetaOf = (entry: unknown): Record<string, unknown> | undefined => {
  const meta = isObject(entry) && isObject(entry.meta) ? entry.meta[META_KEY] : undefined;
  return isObject(meta) ? meta : undefined;
};

const listOf = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);

function checkSchemaVersion(version: unknown) {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('The project’s builder data is corrupt (no valid schema version)');
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `This project was made with a newer version of CFEngine Policy Builder (schema version ${version}; this app supports up to ${SCHEMA_VERSION}). Update the app to open it.`
    );
  }
}

/** Rebuilds the builder's in-memory state from a parsed cfbs.json. */
export function fromCfbsProject(json: unknown): ProjectData {
  const project = builderMetaOf(json) as unknown as ProjectMeta | undefined;
  if (!project) throw new Error(`Not a CFEngine Policy Builder project (no "meta"."${META_KEY}" in cfbs.json)`);
  checkSchemaVersion(project.schema_version);
  const folders = listOf(project.folders);
  const modules = listOf(project.files)
    .filter(file => isObject(file) && typeof file.id === 'string')
    .map(file => ({ file, path: typeof file.path === 'string' ? file.path : '' }));

  // A file's folder is the one whose directory holds it.
  const folderOf = (path: string) => folders.find(folder => typeof folder.path === 'string' && path === `${folder.path}${path.split('/').pop()}`);
  const files: PolicyFile[] = modules.map(({ file: { condition, id, name, namespace }, path }) => ({
    ...(condition ? { condition } : {}),
    id,
    name: typeof name === 'string' ? name : id,
    namespace: typeof namespace === 'string' ? namespace : id,
    parentId: folderOf(path)?.id ?? null
  }));
  const perFile = <T>(pick: (file: FileMeta) => T[] | undefined) =>
    modules.flatMap(({ file }) => listOf(pick(file)).map(item => ({ ...item, fileId: file.id })));
  const canvas = modules.flatMap(({ file }) => {
    const positions = isObject(file.layout?.positions) ? file.layout.positions : {};
    return listOf(file.blocks).map(block => {
      const position = positions[block.instanceId];
      return { ...block, fileId: file.id, ...(position ? { position } : {}) } as BlockInstance;
    });
  });
  const derivedNodes = Object.fromEntries(
    modules.flatMap(({ file }) =>
      Object.entries(isObject(file.layout?.derived_positions) ? file.layout.derived_positions : {}).map(([key, position]) => [`${file.id}|${key}`, position])
    )
  );
  const currentFileId = files.some(file => file.id === project.current_file_id) ? project.current_file_id : (files[0]?.id ?? null);

  return {
    canvas,
    derivedNodes,
    edges: perFile(file => file.edges),
    files: { currentFileId, files, folders: folders.map(({ id, name, parentId }) => ({ id, name, parentId })) },
    groups: perFile(file => (isObject(file.layout) ? file.layout.groups : undefined))
  };
}

export interface LoadedProject {
  data: ProjectData;
  description: string;
  masterfiles: string | null;
  name: string;
}

// The masterfiles build entry's release, "master" for a branch/URL one, null without.
function masterfilesOf(build: unknown[]): string | null {
  const entry = build.find(item => isObject(item) && typeof item.name === 'string' && /(^|\/)masterfiles$/.test(item.name)) as
    Record<string, unknown> | undefined;
  if (!entry) return null;
  if (typeof entry.version === 'string' && /^\d+\.\d+\.\d+(-\d+)?$/.test(entry.version)) return entry.version;
  return typeof entry.url === 'string' || typeof entry.branch === 'string' ? 'master' : typeof entry.version === 'string' ? entry.version : null;
}

/**
 * An opened project's cfbs.json → what goes into the store. A cfbs project
 * without builder data opens with one empty policy file named after it.
 */
export function loadCfbsProject(json: unknown, folderName: string): LoadedProject {
  if (!isObject(json)) throw new Error('cfbs.json is not a JSON object');
  const name = (typeof json.name === 'string' && json.name.trim()) || folderName;
  const description = typeof json.description === 'string' ? json.description : '';
  const masterfiles = masterfilesOf(Array.isArray(json.build) ? json.build : []);
  if (isObject(json.meta) && json.meta[META_KEY] !== undefined && !isObject(json.meta[META_KEY])) {
    throw new Error(`The project’s builder data is corrupt ("meta"."${META_KEY}" is not an object)`);
  }
  const data = builderMetaOf(json) ? fromCfbsProject(json) : null;
  if (data && data.files.files.length > 0) return { data, description, masterfiles, name };
  const files = filesReducer(undefined, projectFilesInitialized(name));
  return { data: { canvas: [], derivedNodes: {}, edges: [], files, groups: [] }, description, masterfiles, name };
}

/** The project folder's name for a project name: "Web Server Hardening" → "web-server-hardening". */
export function projectFolderName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/, '');
}
