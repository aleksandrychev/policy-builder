import { blockDescriptorsById } from '../blocks/loadBlocks';
import { executionOrder, isSequenced } from '../canvas/executionOrder';
import { attachToFrames } from '../canvas/groupEdges';
import type { RootState } from '../store';
import type { BlockInstance, Condition } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';
import filesReducer, { projectFilesInitialized } from '../store/filesSlice';
import { deriveBundle } from '../store/filesSlice/deriveBundle';
import type { PolicyFile, PolicyFolder } from '../store/filesSlice/types';
import type { BlockGroup } from '../store/groupsSlice/types';
import type { UndoableKey } from '../store/history';
import type { ProjectType } from '../store/projectSlice/types';
import { moduleNameFor } from './moduleName';

/**
 * The builder's state on disk: a normal cfbs project that mirrors the file
 * tree — each top-level policy file is a local file module, each top-level
 * folder one local directory module (what `cfbs add` writes for them) — and
 * all of the builder's own data, folders and every file's canvas, in
 * `.policy-builder/project.json`, so cfbs.json stays plain cfbs. Each save
 * also writes the generated .cf files (main process, via the sidecar).
 */

// 2: groups compile into bundles of their own (`groups`), arrows may end on them.
export const SCHEMA_VERSION = 2;
const ROOT = './';
const OUTPUT_DIR = 'services/cfbs/';
// Top-level names taken next to cfbs.json: cfbs's build output, and generated templates.
const RESERVED_FOLDERS = ['./out/', './templates/'];

export type ProjectData = Pick<RootState, UndoableKey>;
type Position = { x: number; y: number };

export interface ProjectMeta {
  current_file_id: string | null;
  // In file order; each file's `path` is where its policy is written.
  files: FileMeta[];
  // `path` is the folder's directory, e.g. "./services/".
  folders: (PolicyFolder & { path: string })[];
  // The name the project is provided under when stored as a cfbs module.
  module_name: string;
  // The display name (a module's cfbs.json name has to be its module name).
  name: string;
  schema_version: number;
  // Stamped by the main process on save (the app's version).
  tool_version?: string;
}

export interface FileMeta {
  blocks: Omit<BlockInstance, 'fileId' | 'position'>[];
  // The entry bundle, and the prefix of the file's other bundles.
  bundle: string;
  condition?: Condition;
  edges: Omit<BlockEdge, 'fileId'>[];
  // What a group compiles from; its look is in layout.groups.
  groups: Pick<BlockGroup, 'condition' | 'id' | 'incomingMode' | 'name'>[];
  id: string;
  // Editor-only: nothing here changes the compiled policy.
  layout: {
    // derivedNodes positions, keyed without the `${fileId}|` prefix.
    derived_positions: Record<string, Position>;
    groups: Pick<BlockGroup, 'color' | 'id' | 'rect'>[];
    positions: Record<string, Position>;
  };
  // The display name; the path is a slug.
  name: string;
  // The methods: call order, resolved here so a compiler needs no canvas.
  order: string[];
  // The generated policy file, e.g. "./services/db/postgres.cf".
  path: string;
}

export interface PolicyModule {
  added_by: 'cfbs add';
  description: string;
  name: string;
  steps: string[];
  tags: string[];
}

// The one module a project stored as a cfbs module provides: cfbs.json `provides[<module_name>]`.
export interface ProvidedModule {
  description: string;
  steps: string[];
  tags: string[];
}

export interface CfbsProjectContent {
  // cfbs.json `build` entries, when stored as a policy set.
  modules: PolicyModule[];
  // .policy-builder/project.json.
  project: ProjectMeta;
  // When stored as a module. The main process adds a templates/ copy step when there are templates.
  provided: ProvidedModule;
}

// What the project is called and provided as.
interface Identity {
  description: string;
  moduleName: string;
  name: string;
}

const withoutFileId = <T extends { fileId: string }>({ fileId: _fileId, ...rest }: T): Omit<T, 'fileId'> => rest;

// A folder's directory name. cfbs wants a module's last path part to start with a letter.
const slug = (name: string) => {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'folder';
  return /^[a-z]/.test(base) ? base : `folder-${base}`;
};

// Folder id → its directory; sibling folders whose slugs clash get -2, -3….
function folderPaths(folders: PolicyFolder[]): Map<string, string> {
  const paths = new Map<string, string>();
  const resolve = (folder: PolicyFolder): string => {
    const known = paths.get(folder.id);
    if (known) return known;
    const parent = folders.find(item => item.id === folder.parentId);
    const base = parent ? resolve(parent) : ROOT;
    const taken = new Set([...RESERVED_FOLDERS, ...paths.values()]);
    let path = `${base}${slug(folder.name)}/`;
    for (let suffix = 2; taken.has(path); suffix += 1) path = `${base}${slug(folder.name)}-${suffix}/`;
    paths.set(folder.id, path);
    return path;
  };
  folders.forEach(resolve);
  return paths;
}

function toFileMeta(file: PolicyFile, path: string, data: ProjectData): FileMeta {
  const prefix = `${file.id}|`;
  const instances = data.canvas.filter(block => block.fileId === file.id);
  const edges = attachToFrames(
    data.edges.filter(edge => edge.fileId === file.id),
    instances
  );
  const groups = data.groups.filter(group => group.fileId === file.id);
  const derivedPositions = Object.entries(data.derivedNodes)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, position]) => [key.slice(prefix.length), position]);
  return {
    id: file.id,
    name: file.name,
    bundle: file.bundle,
    path,
    ...(file.condition ? { condition: file.condition } : {}),
    blocks: instances.map(({ fileId: _fileId, position: _position, ...rest }) => rest),
    edges: edges.map(withoutFileId),
    groups: groups.map(({ condition, id, incomingMode, name }) => ({
      id,
      name,
      ...(condition ? { condition } : {}),
      ...(incomingMode ? { incomingMode } : {})
    })),
    order: executionOrder(instances, edges, blockDescriptorsById),
    layout: {
      positions: Object.fromEntries(instances.flatMap(block => (block.position ? [[block.instanceId, block.position]] : []))),
      groups: groups.map(({ color, id, rect }) => ({ id, color, ...(rect ? { rect } : {}) })),
      derived_positions: Object.fromEntries(derivedPositions)
    }
  };
}

// The module a policy file belongs to: "./nginx.cf" itself, or its top-level folder "./services/".
export const moduleNameOf = (path: string) => {
  const parts = path.slice(ROOT.length).split('/');
  return parts.length === 1 ? path : `${ROOT}${parts[0]}/`;
};

// cfbs's MAX_BUILD_STEP_LENGTH.
const MAX_STEP_LENGTH = 256;

// `bundles a b c`, split over as many steps as cfbs's step length limit needs.
function bundlesSteps(bundles: string[]): string[] {
  const steps: string[] = [];
  for (const bundle of bundles) {
    const last = steps.at(-1);
    if (last && last.length + 1 + bundle.length <= MAX_STEP_LENGTH) steps[steps.length - 1] = `${last} ${bundle}`;
    else steps.push(`bundles ${bundle}`);
  }
  return steps;
}

// Exactly what `cfbs add` writes for a file or a directory, except the `bundles`
// step: it lists every file's entry bundle (cfbs would pick one), and a file of
// only variables and classes has none to list.
function toModule(name: string, entryBundles: string[]): PolicyModule {
  const output = `${OUTPUT_DIR}${name.slice(ROOT.length)}`;
  const isDirectory = name.endsWith('/');
  return {
    name,
    description: isDirectory ? 'Local subdirectory added using cfbs command line' : 'Local policy file added using cfbs command line',
    tags: ['local'],
    added_by: 'cfbs add',
    steps: [isDirectory ? `directory ./ ${output}` : `copy ${name} ${output}`, `policy_files ${output}`, ...bundlesSteps(entryBundles)]
  };
}

// A module's steps: its files and folders copied into services/cfbs/<module>/, as the
// policy-set modules lay them out, so templates are found the same way.
function toProvided(names: Map<string, string[]>, identity: Identity): ProvidedModule {
  const output = `${OUTPUT_DIR}${identity.moduleName}/`;
  const copies = [...names.keys()].map(name => `copy ${name} ${output}${name.slice(ROOT.length)}`);
  return {
    description: identity.description || 'Policy built with CFEngine Policy Builder',
    tags: ['policy-builder'],
    steps: [...copies, `policy_files ${output}`, ...bundlesSteps([...names.values()].flat())]
  };
}

export function toCfbsProject(data: ProjectData, identity: Identity): CfbsProjectContent {
  const paths = folderPaths(data.files.folders);
  const pathOf = (file: PolicyFile) => `${(file.parentId && paths.get(file.parentId)) || ROOT}${file.bundle}.cf`;
  const callsBlocks = (file: PolicyFile) => data.canvas.some(block => block.fileId === file.id && isSequenced(blockDescriptorsById.get(block.blockId)));
  // Modules in the order their first file appears; a folder's bundles in file order.
  const modules = new Map<string, string[]>();
  for (const file of data.files.files) {
    const name = moduleNameOf(pathOf(file));
    modules.set(name, [...(modules.get(name) ?? []), ...(callsBlocks(file) ? [file.bundle] : [])]);
  }
  return {
    project: {
      schema_version: SCHEMA_VERSION,
      name: identity.name,
      module_name: identity.moduleName,
      folders: data.files.folders.map(folder => ({ ...folder, path: paths.get(folder.id)! })),
      files: data.files.files.map(file => toFileMeta(file, pathOf(file), data)),
      current_file_id: data.files.currentFileId
    },
    modules: [...modules].map(([name, bundles]) => toModule(name, bundles)),
    provided: toProvided(modules, identity)
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

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

/** Rebuilds the builder's in-memory state from a parsed .policy-builder/project.json. */
export function fromBuilderProject(json: unknown): ProjectData {
  if (!isObject(json)) throw new Error('The project’s builder data (.policy-builder/project.json) is not a JSON object');
  const project = json as unknown as ProjectMeta;
  checkSchemaVersion(project.schema_version);
  const folders = listOf(project.folders);
  const modules = listOf(project.files)
    .filter(file => isObject(file) && typeof file.id === 'string')
    .map(file => ({ file, path: typeof file.path === 'string' ? file.path : '' }));

  // A file's folder is the one whose directory holds it.
  const folderOf = (path: string) => folders.find(folder => typeof folder.path === 'string' && path === `${folder.path}${path.split('/').pop()}`);
  const files: PolicyFile[] = modules.map(({ file: { bundle, condition, id, name }, path }) => ({
    bundle: typeof bundle === 'string' && bundle ? bundle : deriveBundle(typeof name === 'string' ? name : ''),
    ...(condition ? { condition } : {}),
    id,
    name: typeof name === 'string' ? name : id,
    parentId: folderOf(path)?.id ?? null
  }));
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

  // A group's look (layout.groups; schema 1 kept all of it there) and what it compiles from (groups).
  const groups = modules.flatMap(({ file }) => {
    const looks = listOf(isObject(file.layout) ? (file.layout.groups as Partial<BlockGroup>[]) : undefined);
    const semantics = listOf(file.groups as Partial<BlockGroup>[] | undefined);
    const ids = [...new Set([...looks, ...semantics].map(group => group.id).filter((id): id is string => typeof id === 'string'))];
    return ids.map(id => ({
      color: 'primary' as const,
      name: '',
      ...looks.find(group => group.id === id),
      ...semantics.find(group => group.id === id),
      id,
      fileId: file.id
    })) as BlockGroup[];
  });
  // Schema 1 arrows could cross a group's frame; they attach to the group now.
  const edges = modules.flatMap(({ file }) =>
    attachToFrames(
      listOf(file.edges).map(edge => ({ ...edge, fileId: file.id })),
      canvas.filter(block => block.fileId === file.id)
    )
  );

  return {
    canvas,
    derivedNodes,
    edges,
    files: { currentFileId, files, folders: folders.map(({ id, name, parentId }) => ({ id, name, parentId })) },
    groups
  };
}

export interface LoadedProject {
  data: ProjectData;
  description: string;
  masterfiles: string | null;
  moduleName: string;
  name: string;
  type: ProjectType;
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
 * An opened project's cfbs.json and builder data (.policy-builder/project.json,
 * null when there is none) → what goes into the store. A cfbs project
 * without builder data opens with one empty policy file named after it.
 */
export function loadCfbsProject(json: unknown, builder: unknown, folderName: string): LoadedProject {
  if (!isObject(json)) throw new Error('cfbs.json is not a JSON object');
  const type: ProjectType = json.type === 'module' ? 'module' : 'policy-set';
  const cfbsName = (typeof json.name === 'string' && json.name.trim()) || folderName;
  const saved = isObject(builder) ? builder : {};
  // A policy set's cfbs.json name is its display name; a module's is its module name, so its display name is the builder's.
  const name = (type === 'module' && typeof saved.name === 'string' && saved.name.trim()) || cfbsName;
  const moduleName = typeof saved.module_name === 'string' && saved.module_name ? saved.module_name : type === 'module' ? cfbsName : moduleNameFor(name);
  const identity = { description: typeof json.description === 'string' ? json.description : '', moduleName, name, type };
  const masterfiles = masterfilesOf(Array.isArray(json.build) ? json.build : []);
  const data = builder === null || builder === undefined ? null : fromBuilderProject(builder);
  if (data && data.files.files.length > 0) return { ...identity, data, masterfiles };
  const files = filesReducer(undefined, projectFilesInitialized(name));
  return { ...identity, data: { canvas: [], derivedNodes: {}, edges: [], files, groups: [] }, masterfiles };
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
