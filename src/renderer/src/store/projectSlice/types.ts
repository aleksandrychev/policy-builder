import type { BlockInstance } from '../canvasSlice/types';
import type { BlockEdge } from '../edgesSlice/types';
import type { PolicyFile, PolicyFolder } from '../filesSlice/types';
import type { BlockGroup } from '../groupsSlice/types';

export interface Project {
  description: string;
  // New per created project; remounts the project view.
  id: string;
  // The masterfiles version in the cfbs project, null for none (or not saved yet).
  masterfiles: string | null;
  name: string;
  // The cfbs project folder; null while the project only lives in memory (the demo).
  path: string | null;
}

// A whole project's content, as read from cfbs.json (spelled out: RootState would be circular here).
export interface ProjectContentState {
  canvas: BlockInstance[];
  derivedNodes: Record<string, { x: number; y: number }>;
  edges: BlockEdge[];
  files: { currentFileId: string | null; files: PolicyFile[]; folders: PolicyFolder[] };
  groups: BlockGroup[];
}
