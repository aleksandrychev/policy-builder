// Shape of the bridge exposed by preload/index.ts on `window.api`. Kept inline
// (rather than importing the value module) so the renderer's strict type check
// does not pull preload runtime code into the web program.
interface LayoutSettings {
  leftSidebarFraction: number;
  paletteHeightFraction: number;
  rightSidebarFraction: number;
}

type MenuAction = 'close-requested' | 'new-project' | 'open-project' | 'open-recent' | 'recents-changed' | 'save' | 'try-demo';

// What the builder writes into cfbs.json: its `builder` key and its own build entries.
export interface ProjectContent {
  builder: object;
  modules: object[];
}

export interface CreateProjectRequest extends ProjectContent {
  description: string;
  folderName: string;
  git: boolean;
  // An exact version ("3.27.1"), "master", or "no".
  masterfiles: string;
  name: string;
  parent: string;
}

// Errors come back as data: Electron drops custom Error properties like `details`.
export type OperationResult<T> = ({ ok: true } & T) | { details: string; message: string; ok: false };

export interface MasterfilesVersions {
  latest: string;
  lts: string;
}

export interface OpenedProject {
  // The parsed cfbs.json.
  cfbs: Record<string, unknown>;
  path: string;
}

export interface RecentProject {
  // False once the folder or its cfbs.json is gone.
  exists: boolean;
  name: string;
  path: string;
}

export interface TargetCheck {
  parentWritable: boolean;
  targetState: 'empty' | 'new' | 'nonEmpty';
}

declare global {
  interface Window {
    // Optional on purpose: the bridge only exists inside Electron. Renderer
    // code runs without it under vitest/jsdom (and any future browser mode),
    api?: {
      /** Checks whether a project folder can be created at parent/folderName. */
      checkProjectTarget: (parent: string, folderName: string) => Promise<TargetCheck>;
      /** Tells main the user agreed to close the window despite unsaved changes. */
      confirmWindowClose: () => Promise<void>;
      /** Runs `cfbs init` into parent/folderName, then writes the builder's content into its cfbs.json. */
      createProject: (request: CreateProjectRequest) => Promise<OperationResult<{ masterfiles: string | null; path: string }>>;
      /** Removes a project from the recent-projects list. */
      forgetRecentProject: (path: string) => Promise<void>;
      /** Formats CFEngine policy, rejecting with a message if it cannot. */
      formatPolicy: (source: string) => Promise<string>;
      /** The folder new projects go in by default: the last one used, else ~/Documents. */
      getDefaultProjectParent: () => Promise<string>;
      /** Returns the last-saved sidebar/palette sizes, or null if none were saved yet. */
      getLayoutSettings: () => Promise<LayoutSettings | null>;
      /** Newest 3.27.x and 3.24.x masterfiles releases (built-in fallback when offline). */
      getMasterfilesVersions: () => Promise<MasterfilesVersions>;
      /** The file-system path of a File dropped onto the window. */
      getPathForFile: (file: File) => string;
      /** The last few opened/created projects, most recent first. */
      getRecentProjects: () => Promise<RecentProject[]>;
      /** Opens a native file picker and reads the chosen file as text, or null if cancelled. */
      importTextFile: () => Promise<{ content: string; fileName: string } | null>;
      /** Subscribes to native menu clicks, window-close requests and recent-project changes; call the returned function to unsubscribe. */
      onMenuAction: (callback: (action: MenuAction, path?: string) => void) => () => void;
      /** Reads a project's cfbs.json: `path` is its folder or the cfbs.json; without one, a native picker asks (null: cancelled). */
      openProject: (request?: { path?: string }) => Promise<OperationResult<OpenedProject> | null>;
      /** Opens a native folder picker, or null if cancelled. */
      pickDirectory: (defaultPath?: string) => Promise<string | null>;
      /** Shows the project's cfbs.json in the OS file manager. */
      revealProject: (path: string) => Promise<void>;
      /** Merges the builder's content into the project's cfbs.json. */
      saveProject: (path: string, content: ProjectContent) => Promise<OperationResult<object>>;
      /** Sets the window title (null: no project) and the unsaved-changes state. */
      setDocument: (document: { edited: boolean; title: string | null }) => Promise<void>;
      /** Persists sidebar/palette sizes so they survive an app restart. */
      setLayoutSettings: (settings: LayoutSettings) => Promise<void>;
      shouldUseDarkColors: () => Promise<boolean>;
    };
  }
}

export {};
