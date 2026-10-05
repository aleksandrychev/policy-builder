import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type {
  BaseImage,
  BuildResult,
  CompiledPolicy,
  CreateProjectRequest,
  DockerStatus,
  GitStatus,
  ImageSearch,
  MasterfilesVersions,
  OpenedProject,
  OperationResult,
  ProjectContent,
  ProjectStorage,
  RecentProject,
  TargetCheck,
  TestEnvEvent,
  TestEnvRequest
} from './api';

// Everything the renderer can ask the main process to do goes through this
// typed bridge (see api.d.ts — the filename is load-bearing, see the note
// there). Keep it minimal and explicit.

// ipcRenderer.invoke wraps rejections as "Error invoking remote method 'x':
// Error: <message>". The renderer shows these messages to the user, so strip
// the plumbing prefix here rather than in every consumer.
function invoke<T>(channel: string, ...invokeArgs: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...invokeArgs).catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ''));
  });
}

interface LayoutSettings {
  leftSidebarFraction: number;
  paletteHeightFraction: number;
  rightSidebarFraction: number;
}

export type MenuAction = 'close-requested' | 'new-project' | 'open-project' | 'open-recent' | 'project-settings' | 'recents-changed' | 'save' | 'try-demo';

const MENU_CHANNELS: Record<string, MenuAction> = {
  'menu:new-project': 'new-project',
  'menu:open-project': 'open-project',
  // Carries the project path.
  'menu:open-recent': 'open-recent',
  'menu:save': 'save',
  'menu:project-settings': 'project-settings',
  'menu:try-demo': 'try-demo',
  // Not a menu item: main asking whether a window with unsaved changes may close.
  'window:close-requested': 'close-requested',
  'window:recents-changed': 'recents-changed'
};

// Menu clicks fire in the main process (see main/index.ts's
// buildApplicationMenu), so the renderer hears about them as events rather
// than a request/response — unlike everything else in `api`, which the
// renderer calls to ask main to do something.
function onMenuAction(callback: (action: MenuAction, path?: string) => void): () => void {
  const listeners = Object.entries(MENU_CHANNELS).map(([channel, action]) => {
    const listener = (_event: unknown, path?: unknown) => callback(action, typeof path === 'string' ? path : undefined);
    ipcRenderer.on(channel, listener);
    return { channel, listener };
  });
  return () => {
    for (const { channel, listener } of listeners) ipcRenderer.removeListener(channel, listener);
  };
}

// Events of streaming test-environment runs (image pulls, later container setup and agent runs).
function onTestEnvEvent(callback: (runId: string, event: TestEnvEvent) => void): () => void {
  const listener = (_event: unknown, runId: string, payload: TestEnvEvent) => callback(runId, payload);
  ipcRenderer.on('testenv:event', listener);
  return () => ipcRenderer.removeListener('testenv:event', listener);
}

function onDeployProgress(callback: (stage: string) => void): () => void {
  const listener = (_event: unknown, stage: string) => callback(stage);
  ipcRenderer.on('deploy:progress', listener);
  return () => ipcRenderer.removeListener('deploy:progress', listener);
}

const api = {
  /** Returns whether the OS currently prefers a dark color scheme. */
  shouldUseDarkColors: (): Promise<boolean> => invoke('theme:should-use-dark'),

  /** Subscribes to native menu clicks, window-close requests and recent-project changes; call the returned function to unsubscribe. */
  onMenuAction,
  onTestEnvEvent,
  /** Each step of a running Build or SSH deploy as it starts: build, lint, promises, copy, validate, install, update, policy. */
  onDeployProgress,
  testEnvDoctor: (): Promise<DockerStatus> => invoke('testenv:doctor'),
  testEnvImages: (): Promise<{ platforms: BaseImage[] }> => invoke('testenv:images'),
  testEnvStart: (
    action: 'destroy' | 'exec' | 'inspect' | 'pull' | 'run' | 'start' | 'stop' | 'test' | 'up',
    request: TestEnvRequest | { arch?: string; image: string }
  ): Promise<string> => invoke('testenv:start', action, request),
  testEnvPlatforms: (query: {
    arch: string;
    edition: string;
    version: string;
  }): Promise<{ platforms: { client: boolean; hub: boolean; id: string; label: string }[] }> => invoke('testenv:platforms', query),
  testEnvSearch: (query: { hub: boolean; term: string }): Promise<ImageSearch> => invoke('testenv:search', query),
  testEnvStatus: (request: TestEnvRequest): Promise<{ hosts: Record<string, { container?: string; ip?: string | null; state: string }> }> =>
    invoke('testenv:status', request),
  cancelTestEnvRun: (runId: string): Promise<void> => invoke('testenv:cancel', runId),

  /** Deployment: build a saved project's policy set and check it. */
  buildPolicySet: (path: string): Promise<OperationResult<{ build: BuildResult }>> => invoke('deploy:build', path),
  /** Deployment over SSH: build and check the saved project, then make it the hub's masterfiles. */
  deployOverSsh: (
    path: string,
    target: { host: string; key: string | null; port: number | null }
  ): Promise<OperationResult<{ build: BuildResult; deployed: boolean; log: string }>> => invoke('deploy:ssh', path, target),
  /** A file picker in ~/.ssh for the hub's private key; null if cancelled. */
  pickSshKey: (): Promise<string | null> => invoke('deploy:pick-key'),
  /** Shows a file of the project in the OS file manager. */
  revealInProject: (path: string, file: string): Promise<void> => invoke('deploy:reveal', path, file),
  gitStatus: (path: string): Promise<OperationResult<{ status: GitStatus }>> => invoke('git:status', path),
  gitInit: (path: string): Promise<OperationResult<{ status: GitStatus }>> => invoke('git:init', path),
  gitCommit: (path: string, message: string): Promise<OperationResult<{ status: GitStatus }>> => invoke('git:commit', path, message),
  gitSetRemote: (path: string, url: string): Promise<OperationResult<{ status: GitStatus }>> => invoke('git:set-remote', path, url),
  gitPush: (path: string): Promise<OperationResult<{ status: GitStatus }>> => invoke('git:push', path),

  /** Sets the window title (null: no project) and the unsaved-changes state. */
  setDocument: (document: { edited: boolean; title: string | null }): Promise<void> => invoke('window:set-document', document),

  /** Tells main the user agreed to close the window despite unsaved changes. */
  confirmWindowClose: (): Promise<void> => invoke('window:close-confirmed'),

  /** The folder new projects go in by default: the last one used, else ~/Documents. */
  getDefaultProjectParent: (): Promise<string> => invoke('project:default-parent'),

  /** Opens a native folder picker, or null if cancelled. */
  pickDirectory: (defaultPath?: string): Promise<string | null> => invoke('project:pick-directory', defaultPath),

  /** Newest 3.27.x masterfiles release (built-in fallback when offline). */
  getMasterfilesVersions: (): Promise<MasterfilesVersions> => invoke('project:masterfiles-versions'),

  /** Checks whether a project folder can be created at parent/folderName. */
  checkProjectTarget: (parent: string, folderName: string): Promise<TargetCheck> => invoke('project:check-target', { parent, folderName }),

  /** Runs `cfbs init` into parent/folderName, then writes the builder's content into its cfbs.json. */
  createProject: (request: CreateProjectRequest): Promise<OperationResult<{ masterfiles: string | null; path: string }>> => invoke('project:create', request),

  /** Reads a project's cfbs.json: `path` is its folder or the cfbs.json; without one, a native picker asks (null: cancelled). */
  openProject: (request: { path?: string } = {}): Promise<OperationResult<OpenedProject> | null> => invoke('project:open', request),

  /** The last few opened/created projects, most recent first. */
  getRecentProjects: (): Promise<RecentProject[]> => invoke('project:recents'),

  /** Removes a project from the recent-projects list. */
  forgetRecentProject: (path: string): Promise<void> => invoke('project:forget-recent', { path }),

  /** The file-system path of a File dropped onto the window. */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  /** Merges the builder's content into the project's cfbs.json. */
  saveProject: (path: string, content: ProjectContent, storage: ProjectStorage): Promise<OperationResult<{ masterfiles: string | null }>> =>
    invoke('project:save', { path, ...content, storage }),

  /** Shows the project's cfbs.json in the OS file manager. */
  revealProject: (path: string): Promise<void> => invoke('project:reveal', path),

  /** Formats CFEngine policy text with the bundled `cfengine format` engine. */
  formatPolicy: (source: string): Promise<string> => invoke('policy:format', source),
  compilePolicy: (project: object): Promise<CompiledPolicy> => invoke('policy:compile', project),

  /** Opens a native file picker and reads the chosen file as text, or null if cancelled. */
  importTextFile: (): Promise<{ content: string; fileName: string } | null> => invoke('file:import-text'),

  /** Returns the last-saved sidebar/palette sizes, or null if none were saved yet. */
  getLayoutSettings: (): Promise<LayoutSettings | null> => invoke('layout:get'),

  /** Persists sidebar/palette sizes so they survive an app restart. */
  setLayoutSettings: (settings: LayoutSettings): Promise<void> => invoke('layout:set', settings)
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // contextIsolation is enabled in this app, so this branch is a fallback only.
  window.api = api;
}
