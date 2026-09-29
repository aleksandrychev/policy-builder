import type { RootState } from '../store';
import type { BlockInstance, Condition } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';
import type { PolicyFile, PolicyFolder } from '../store/filesSlice/types';
import type { BlockGroup } from '../store/groupsSlice/types';
import type { UndoableKey } from '../store/history';

/**
 * The builder's state as it's stored in cfbs.json (architecture-plan.md,
 * "cfbs.json as the IR"): project-level state under `builder`, and one build
 * module per policy file carrying that file's canvas in `representation`.
 */

export const SCHEMA_VERSION = 1;
export const ADDED_BY = 'policy builder';
const POLICY_DIR = './policy/';

export type ProjectData = Pick<RootState, UndoableKey>;
type Position = { x: number; y: number };

export interface BuilderState {
  current_file_id: string | null;
  // Policy file ids, in the order the files were created.
  files: string[];
  folders: PolicyFolder[];
  schema_version: number;
  // Stamped by the main process on save (the app's version).
  tool_version?: string;
}

export interface FileRepresentation {
  blocks: Omit<BlockInstance, 'fileId'>[];
  condition?: Condition;
  // derivedNodes positions, keyed without the `${fileId}|` prefix.
  derived_positions: Record<string, Position>;
  edges: Omit<BlockEdge, 'fileId'>[];
  groups: Omit<BlockGroup, 'fileId'>[];
  id: string;
  // The display name; the module path uses the namespace (cfbs splits steps on whitespace).
  name: string;
  namespace: string;
  parentId: string | null;
}

export interface PolicyModule {
  added_by: typeof ADDED_BY;
  description: string;
  name: string;
  representation: FileRepresentation;
  steps: string[];
  tags: string[];
}

export interface CfbsProjectContent {
  builder: BuilderState;
  modules: PolicyModule[];
}

// "Folder/Sub/File" for a file nested in folders.
const withoutFileId = <T extends { fileId: string }>({ fileId: _fileId, ...rest }: T): Omit<T, 'fileId'> => rest;

function toModule(file: PolicyFile, data: ProjectData): PolicyModule {
  const path = file.namespace;
  const prefix = `${file.id}|`;
  const derivedPositions = Object.entries(data.derivedNodes)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, position]) => [key.slice(prefix.length), position]);
  return {
    name: `${POLICY_DIR}${path}.cf`,
    description: 'Policy file edited with CFEngine Policy Builder',
    tags: ['local'],
    added_by: ADDED_BY,
    steps: [`copy ${POLICY_DIR}${path}.cf services/cfbs/policy/${path}.cf`, `policy_files services/cfbs/policy/${path}.cf`, `bundles ${file.namespace}:main`],
    representation: {
      id: file.id,
      name: file.name,
      namespace: file.namespace,
      parentId: file.parentId,
      ...(file.condition ? { condition: file.condition } : {}),
      blocks: data.canvas.filter(block => block.fileId === file.id).map(withoutFileId),
      edges: data.edges.filter(edge => edge.fileId === file.id).map(withoutFileId),
      groups: data.groups.filter(group => group.fileId === file.id).map(withoutFileId),
      derived_positions: Object.fromEntries(derivedPositions)
    }
  };
}

export function toCfbsProject(data: ProjectData): CfbsProjectContent {
  return {
    builder: {
      schema_version: SCHEMA_VERSION,
      folders: data.files.folders,
      files: data.files.files.map(file => file.id),
      current_file_id: data.files.currentFileId
    },
    modules: data.files.files.map(file => toModule(file, data))
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function isPolicyModule(entry: unknown): entry is PolicyModule {
  return isObject(entry) && entry.added_by === ADDED_BY && typeof entry.name === 'string' && isObject(entry.representation);
}

/** Rebuilds the builder's in-memory state from a parsed cfbs.json. */
export function fromCfbsProject(json: unknown): ProjectData {
  if (!isObject(json) || !isObject(json.builder)) throw new Error('Not a CFEngine Policy Builder project (no "builder" key in cfbs.json)');
  const builder = json.builder as unknown as BuilderState;
  if (typeof builder.schema_version !== 'number' || builder.schema_version > SCHEMA_VERSION) {
    throw new Error(`Unsupported project schema version ${builder.schema_version}; this app supports up to ${SCHEMA_VERSION}`);
  }
  const modules = (Array.isArray(json.build) ? json.build : []).filter(isPolicyModule);
  const order = Array.isArray(builder.files) ? builder.files : [];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  modules.sort((a, b) => rank(a.representation.id) - rank(b.representation.id));

  const files: PolicyFile[] = modules.map(({ representation: { condition, id, name, namespace, parentId } }) => ({
    ...(condition ? { condition } : {}),
    id,
    name,
    namespace,
    parentId
  }));
  const perFile = <T>(pick: (representation: FileRepresentation) => T[]) =>
    modules.flatMap(({ representation }) => pick(representation).map(item => ({ ...item, fileId: representation.id })));
  const derivedNodes = Object.fromEntries(
    modules.flatMap(({ representation }) =>
      Object.entries(representation.derived_positions ?? {}).map(([key, position]) => [`${representation.id}|${key}`, position])
    )
  );
  const currentFileId = files.some(file => file.id === builder.current_file_id) ? builder.current_file_id : (files[0]?.id ?? null);

  return {
    canvas: perFile(representation => representation.blocks ?? []),
    derivedNodes,
    edges: perFile(representation => representation.edges ?? []),
    files: { currentFileId, files, folders: Array.isArray(builder.folders) ? builder.folders : [] },
    groups: perFile(representation => representation.groups ?? [])
  };
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
