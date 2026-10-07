import type { SizeOf } from '../canvas/layout';
import type { ProjectFormValues } from '../components/dialogs/NewProjectDialog';
import type { AppDispatch, RootState } from '../store';

/** What every MCP tool gets: the store, the project session, and the open project's canvas. */
export interface ToolEnv {
  // Null while no project is open.
  canvas: Omit<CanvasEnv, 'dispatch' | 'getState'> | null;
  dispatch: AppDispatch;
  getState: () => RootState;
  session: SessionTools;
}

// The open project's view: edits show where the user can see them.
export interface CanvasEnv {
  dispatch: AppDispatch;
  // Fits the canvas to the open file's blocks.
  fitView: () => void;
  getState: () => RootState;
  // A card's height as the canvas measured it, if it's been drawn.
  nodeHeight: (nodeId: string) => number | undefined;
  // Shows a file on the canvas (and the Canvas view).
  openFile: (fileId: string) => void;
  selectedInstanceId: string | null;
  sizeOf: SizeOf;
}

type Result = { details?: string; message?: string; ok: boolean };

// The project session (useProjectSession), without its dialogs.
export interface SessionTools {
  create: (values: ProjectFormValues) => Promise<Result>;
  dirty: boolean;
  // Why it failed, or null.
  open: (path: string) => Promise<string | null>;
  save: () => Promise<string | null>;
  saveAs: (values: ProjectFormValues) => Promise<Result>;
}

export type Input = Record<string, unknown>;
export type Tool = (env: ToolEnv, input: Input) => unknown;

/** A refusal the model reads (and can act on), as opposed to a crash. */
export class ToolError extends Error {}

export function str(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value) throw new ToolError(`${key} is required`);
  return value;
}

export const optionalStr = (input: Input, key: string): string | undefined => (typeof input[key] === 'string' ? (input[key] as string) : undefined);

export function canvasOf(env: ToolEnv): CanvasEnv {
  if (!env.canvas || !env.getState().project) throw new ToolError('No project is open in Policy Builder; open or create one first');
  return { ...env.canvas, dispatch: env.dispatch, getState: env.getState };
}
