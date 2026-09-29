import type { Condition } from '../canvasSlice/types';

export interface PolicyFile {
  // Gates the whole file — every block, variables and classes included. It
  // compiles to one if/unless on the call to the file's entry bundle.
  condition?: Condition;
  id: string;
  name: string;
  // Derived from name at creation time; per architecture-plan.md, never
  // changes afterward even if the file is renamed. Distinct per file, unlike
  // a project-wide namespace: each file's `body file control` declares its
  // own, and referencing another file's variable/class needs a
  // namespace-qualified name.
  namespace: string;
  // Purely organizational — folders carry no CFEngine meaning (unlike
  // namespace, which is per file regardless of nesting). null means the
  // project's root.
  parentId: string | null;
}

// A folder groups files (and other folders) in the sidebar. It has no
// compiled-policy meaning of its own — see PolicyFile.parentId.
export interface PolicyFolder {
  id: string;
  name: string;
  parentId: string | null;
}
