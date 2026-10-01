import type { Condition } from '../canvasSlice/types';

export interface PolicyFile {
  // The file's entry bundle name, and the prefix of its other bundles:
  // `<bundle>_vars` (its variables and classes) and `<bundle>_<block>`.
  // Policy is in the default namespace, so it's unique project-wide.
  // Derived from name at creation time and never changed afterward, even if
  // the file is renamed (references like `$(<bundle>_vars.x)` depend on it).
  bundle: string;
  // Gates the whole file — every block, variables and classes included. It
  // compiles to a class guard over the file's calls and definitions.
  condition?: Condition;
  id: string;
  name: string;
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
