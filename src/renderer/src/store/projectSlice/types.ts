import type { BlockInstance } from '../canvasSlice/types';
import type { BlockEdge } from '../edgesSlice/types';
import type { PolicyFile, PolicyFolder } from '../filesSlice/types';
import type { BlockGroup } from '../groupsSlice/types';
import type { TestEnvironment } from '../testEnvironmentsSlice/types';

// How the project is stored: a policy set (masterfiles plus this project, built with
// `cfbs build`), or a module other policy sets add with `cfbs add` (cfbs.json `type`).
export type ProjectType = 'module' | 'policy-set';

export interface Project {
  description: string;
  // New per created project; remounts the project view.
  id: string;
  // The masterfiles version in the cfbs project, null for none (or not saved yet).
  masterfiles: string | null;
  // The module's name when stored as one ("nginx-web-server-demo"): derived once and kept, since
  // policy sets that add it refer to it by name.
  moduleName: string;
  name: string;
  // The cfbs project folder; null while the project only lives in memory (the demo).
  path: string | null;
  type: ProjectType;
}

// A whole project's content, as read from cfbs.json (spelled out: RootState would be circular here).
export interface ProjectContentState {
  canvas: BlockInstance[];
  derivedNodes: Record<string, { x: number; y: number }>;
  edges: BlockEdge[];
  files: { currentFileId: string | null; files: PolicyFile[]; folders: PolicyFolder[] };
  groups: BlockGroup[];
  testEnvironments: TestEnvironment[];
}
