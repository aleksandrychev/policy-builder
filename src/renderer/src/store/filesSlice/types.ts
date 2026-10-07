import type { Condition } from '../canvasSlice/types';

export interface PolicyFile {
  // Gates the whole file — every block, variables and classes included. It
  // compiles to a class guard over the file's calls and definitions.
  condition?: Condition;
  // What the file is for: shown on hovering its name.
  description?: string;
  id: string;
  name: string;
  // The file's CFEngine namespace (`bundle common vars`, `bundle agent main`, its blocks), unique
  // project-wide. Derived from name once, never changed on rename: `<ns>:vars.x` references depend on it.
  namespace: string;
  // Organizational, and the file's path: a top-level folder is one cfbs
  // directory module. null means the project's root.
  parentId: string | null;
}

// A folder groups files (and other folders) in the sidebar. It has no
// compiled-policy meaning of its own — see PolicyFile.parentId.
export interface PolicyFolder {
  id: string;
  name: string;
  parentId: string | null;
}
